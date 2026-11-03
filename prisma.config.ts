import { existsSync } from "node:fs";
import { defineConfig, env } from "prisma/config";

// Prisma 7 no longer reads .env on its own. Locally we load it with Node's built-in loader;
// on Vercel the variables come from the project settings and there is no .env file.
if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  // The CLI (migrate) needs a direct, non-pooled connection; the app uses DATABASE_URL via the adapter.
  datasource: {
    url: env("DIRECT_URL"),
  },
});
