import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/e2e/**/*.test.ts"],
    globalSetup: ["./test/e2e/globalSetup.ts"],
    testTimeout: 30000,
    fileParallelism: false,
    isolate: false,
  },
});
