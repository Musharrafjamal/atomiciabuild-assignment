import { MongoClient, type Db } from "mongodb";

/**
 * A single MongoClient, cached on globalThis.
 *
 * Two reasons this matters rather than being boilerplate:
 *
 * 1. On Vercel, every function invocation re-executes module scope in a warm
 *    container. Constructing a client per invocation opens a new connection pool
 *    each time and exhausts Atlas M0's 500-connection ceiling under light load.
 * 2. In development, Next's HMR re-evaluates modules on every edit, with the same
 *    effect. Caching on globalThis survives both.
 *
 * The promise (not just the client) is cached so concurrent callers during a cold
 * start await one connection rather than racing to open several.
 */

declare global {
  var __clinicMongo: {
    client: MongoClient | null;
    promise: Promise<MongoClient> | null;
  };
}

const cache = globalThis.__clinicMongo ?? { client: null, promise: null };
globalThis.__clinicMongo = cache;

function uri(): string {
  const value = process.env.MONGODB_URI;
  if (!value) {
    throw new Error(
      "MONGODB_URI is not set. Copy .env.example to .env.local, or run `docker compose up`.",
    );
  }
  return value;
}

export async function getClient(): Promise<MongoClient> {
  if (cache.client) return cache.client;

  if (!cache.promise) {
    cache.promise = new MongoClient(uri(), {
      // Fail fast with a useful message instead of hanging for the 30s default
      // when the replica set has no primary (e.g. Mongo still starting up).
      serverSelectionTimeoutMS: 10_000,
      retryWrites: true,
    }).connect();
  }

  cache.client = await cache.promise;
  return cache.client;
}

export async function getDb(): Promise<Db> {
  const client = await getClient();
  // Database name comes from the connection string path segment.
  return client.db();
}

/** Closes the pooled client. Used by scripts and test teardown, never by request code. */
export async function closeClient(): Promise<void> {
  if (cache.client) {
    await cache.client.close();
  }
  cache.client = null;
  cache.promise = null;
}
