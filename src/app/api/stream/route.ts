import type { ChangeStream, ChangeStreamDocument } from "mongodb";
import { getDb } from "@/lib/db/client";
import { COLLECTIONS, type ShiftDoc } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";

/**
 * Server-sent events for live shift updates.
 *
 * A MongoDB change stream on the `shifts` collection is the source: the database
 * already knows when a shift's staffing changed, so nothing in the write path has
 * to remember to publish an event. A claim made by any route, the seed, or even
 * mongosh shows up here.
 *
 * SSE rather than WebSockets because the data only travels one way and SSE is
 * plain HTTP -- it survives the serverless request/response model, and
 * `EventSource` reconnects on its own when a connection ends.
 *
 * That reconnection matters here: a serverless function cannot run forever, so
 * this stream deliberately closes itself shortly before the platform would kill
 * it, and the browser silently reopens. The client treats every reconnect as a
 * cue to revalidate, so nothing is missed across the gap.
 */

// Change streams need the driver, so this cannot run on the edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Close a little before the platform limit so the end is ours, not a truncation. */
const LIFETIME_MS = 240_000;
const HEARTBEAT_MS = 25_000;

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();
  let stream: ChangeStream<ShiftDoc> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let lifetime: ReturnType<typeof setTimeout> | null = null;

  const body = new ReadableStream({
    async start(controller) {
      let closed = false;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // The consumer has gone; teardown is already scheduled.
        }
      };

      const shutdown = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (lifetime) clearTimeout(lifetime);
        stream?.close().catch(() => {});
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // Tell the client it is connected, so it can revalidate immediately and
      // catch anything that changed while it was reconnecting.
      send("ready", { at: new Date().toISOString() });

      try {
        const db = await getDb();
        stream = db
          .collection<ShiftDoc>(COLLECTIONS.shifts)
          .watch([], { fullDocument: "updateLookup" });

        stream.on("change", (change: ChangeStreamDocument<ShiftDoc>) => {
          // Only the identity of what changed is sent. The client refetches the
          // week it is showing, so the payload cannot drift from the real state
          // and there is no partial-update merge logic to get wrong.
          const id =
            "documentKey" in change && change.documentKey
              ? String(change.documentKey._id)
              : null;
          send("shift", { id, operation: change.operationType });
        });

        stream.on("error", () => shutdown());
      } catch {
        // Change streams need a replica set. Rather than fail the request, say
        // so and close: the client falls back to polling.
        send("unsupported", {
          reason: "change streams unavailable on this deployment",
        });
        shutdown();
        return;
      }

      heartbeat = setInterval(() => send("ping", Date.now()), HEARTBEAT_MS);
      lifetime = setTimeout(shutdown, LIFETIME_MS);
      request.signal.addEventListener("abort", shutdown);
    },

    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      if (lifetime) clearTimeout(lifetime);
      stream?.close().catch(() => {});
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Stops nginx-style proxies buffering the stream into uselessness.
      "X-Accel-Buffering": "no",
    },
  });
}
