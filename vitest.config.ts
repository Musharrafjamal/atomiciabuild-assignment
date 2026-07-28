import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Unit tests live beside the code they cover; integration tests (which need a
    // running replica set) live under tests/integration.
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    // Concurrency tests deliberately hammer the same documents from many promises.
    // Running suites in parallel on top of that makes failures hard to attribute,
    // so files run one at a time; parallelism inside a test is what we're testing.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
