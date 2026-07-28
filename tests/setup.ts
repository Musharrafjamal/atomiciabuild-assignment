import { config } from "dotenv";

// Load .env.local for local runs; docker compose / CI supply real env vars instead.
config({ path: ".env.local", quiet: true });

process.env.CLINIC_TZ ??= "Europe/London";
process.env.AUTH_SECRET ??= "test-secret-0123456789abcdef0123456789abcdef";

/**
 * Integration tests wipe collections between cases, so they must never touch the
 * development database. `.env.local` has already been loaded above and points at
 * `clinic`, so the database name is rewritten rather than defaulted -- a `??=`
 * here would silently leave tests pointed at real data.
 *
 * No replicaSet= parameter: the atlas-local image names its set after the
 * container id, so pinning "rs0" makes the driver reject the server.
 */
const FALLBACK = "mongodb://localhost:27017/clinic?directConnection=true";

function toTestDatabase(uri: string): string {
  const parsed = new URL(uri);
  const name = parsed.pathname.replace(/^\//, "") || "clinic";
  if (!name.endsWith("_test")) parsed.pathname = `/${name}_test`;
  return parsed.toString();
}

process.env.MONGODB_URI = toTestDatabase(
  process.env.TEST_MONGODB_URI || process.env.MONGODB_URI || FALLBACK,
);
