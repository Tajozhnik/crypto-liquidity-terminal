import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    testTimeout: 15000,
    hookTimeout: 15000,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
