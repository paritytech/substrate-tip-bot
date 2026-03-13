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
    testTimeout: 2 * 60_000,
    include: ["**/*.integration.ts"],
    globals: true,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    silent: false,
  },
});
