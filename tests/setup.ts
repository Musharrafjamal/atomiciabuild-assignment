import { config } from "dotenv";

// Load .env.local for local runs; docker compose / CI supply real env vars instead.
config({ path: ".env.local", quiet: true });

process.env.CLINIC_TZ ??= "Europe/London";
process.env.AUTH_SECRET ??= "test-secret-0123456789abcdef0123456789abcdef";
// No replicaSet= parameter: the atlas-local image names its set after the
// container ID, so pinning "rs0" makes the driver reject the server.
process.env.MONGODB_URI ??=
  "mongodb://localhost:27017/clinic_test?directConnection=true";
