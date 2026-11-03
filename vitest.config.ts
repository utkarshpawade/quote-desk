import path from "node:path";
import { defineConfig } from "vitest/config";

// Business dates must not depend on the machine clock zone: Vercel runs in UTC, so tests do too.
process.env.TZ = "UTC";

const root = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      // `server-only` throws outside the React server runtime; tests import server modules directly.
      "server-only": path.resolve(root, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/domain/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
    },
  },
});
