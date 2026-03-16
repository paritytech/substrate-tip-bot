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
    testTimeout: 10 * 60_000,
    include: ["**/*.e2e.ts"],
    globals: true,
    env: {
      LOCAL_NETWORKS: "true",
    },
  },
});
