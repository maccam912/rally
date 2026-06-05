import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: { alias: { "@shared": resolve(__dirname, "src/shared") } },
  test: {
    environment: "node",
    include: ["tests/**/*.omlx.test.ts"],
    testTimeout: 60000,
    hookTimeout: 60000,
    pool: "threads",
  },
});
