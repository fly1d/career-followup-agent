import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: [
        "src/domain/**/*.ts",
        "src/server/auth.ts",
        "src/server/postgres-store.ts",
        "src/server/repository.ts",
        "src/server/store-records.ts",
        "src/server/store.ts",
        "src/server/http.ts",
        "src/server/password.ts",
        "src/server/rate-limit.ts",
        "src/server/schemas.ts",
      ],
      thresholds: {
        lines: 85,
        functions: 85,
        statements: 85,
        branches: 80,
      },
    },
  },
});
