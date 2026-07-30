import { config } from "dotenv";

// Load .env.local for local runs; CI supplies real environment variables instead.
config({ path: ".env.local", quiet: true });

process.env.AUTH_SECRET ??= "test-secret-0123456789abcdef0123456789abcdef";

/**
 * Integration tests wipe collections between cases, so they must never touch the
 * database the app is actually using. The database name in MONGODB_URI is
 * rewritten to `<name>_test` -- a rewrite rather than a default, because
 * `.env.local` has already been loaded above and a `??=` would leave the tests
 * pointed at real data.
 *
 * Everything lives in the same cluster, which is fine: MongoDB isolates
 * databases, and Atlas's free tier allows plenty of them.
 */
const FALLBACK = "mongodb://localhost:27017/clinic";

function toTestDatabase(uri: string): string {
  const [head, query] = uri.split("?");
  const withoutTrailingSlash = head.replace(/\/$/, "");
  const parts = withoutTrailingSlash.split("/");

  // scheme://host is 3 parts; a 4th is the database name.
  const name = parts.length > 3 ? parts[3] : "";
  const testName = name ? (name.endsWith("_test") ? name : `${name}_test`) : "clinic_test";

  const rebuilt =
    parts.length > 3
      ? [...parts.slice(0, 3), testName].join("/")
      : `${withoutTrailingSlash}/${testName}`;

  return query ? `${rebuilt}?${query}` : rebuilt;
}

process.env.MONGODB_URI = toTestDatabase(
  process.env.TEST_MONGODB_URI || process.env.MONGODB_URI || FALLBACK,
);
