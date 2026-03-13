import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "#src": path.resolve(__dirname, "src"),
    },
  },
  test: {
    root: "./src",
    testTimeout: 30_000,
    include: ["**/*.test.ts"],
    globals: true,
  },
});
