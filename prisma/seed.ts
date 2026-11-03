/**
 * `npm run db:seed` — loads the demo data (see src/server/seed). Refuses to touch a database that
 * already has RFQs unless run with --force, so it cannot wipe real work by accident.
 */
import { createPrismaClient } from "../src/server/db-client";
import { DEFAULT_DEMO_PASSWORD } from "../src/server/demo";
import { seedDemo } from "../src/server/seed";

const db = createPrismaClient();

async function main() {
  const force = process.argv.includes("--force") || process.env.SEED_FORCE === "true";
  const existing = await db.rfq.count().catch(() => 0);
  if (existing > 0 && !force) {
    console.error(`The database already has ${existing} RFQs. Re-run with --force to replace them with demo data.`);
    process.exitCode = 1;
    return;
  }
  const started = Date.now();
  const summary = await seedDemo(db, { password: process.env.SEED_DEMO_PASSWORD || DEFAULT_DEMO_PASSWORD });
  console.log(
    `Seeded ${summary.rfqs} RFQs (${summary.frozenQuotes} submitted), ${summary.rateItems} rate items, ${summary.users} users in ${((Date.now() - started) / 1000).toFixed(1)} s.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
