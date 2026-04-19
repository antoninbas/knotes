import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/e2e/**/*.test.ts"],
    globalSetup: ["./test/preload.ts"],
    testTimeout: 30000,
    fileParallelism: false,
  },
});
