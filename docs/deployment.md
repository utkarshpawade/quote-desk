# Deployment and running locally

Quote Desk is one Next.js application (UI, server actions and API routes) with a PostgreSQL
database. It runs the same way on a laptop and on Vercel; only the database location and a few
environment variables differ.

- **Live demo:** _added when the app is deployed_
- **Repository:** https://github.com/utkarshpawade/quote-desk

## Demo sign-in

| Role | Email | Password |
|---|---|---|
| Estimator | `rohan.deshpande@companya.example` | `Chakan@2026` |
| Sales head | `vikram.joshi@companya.example` | `Chakan@2026` |

The sign-in page lists both accounts with one-click sign-in when `DEMO_MODE` is `true`. Five more
estimators (Kavita Shinde, Arjun Patil, Sneha Kulkarni, Imran Shaikh, Pooja Jadhav, all
`firstname.lastname@companya.example`) share the same password. All people, companies and numbers
are invented.

A good first path: sign in as the estimator → RFQ-2611-014 → part 1 (costing) → Overview →
Submit quote; then sign in as the sales head → Approvals → approve → Send to customer → Download
PDF. "New RFQ" → "Use this sample" runs the document intake on a sample RFQ pack.

## Run it locally

Prerequisites: Node.js 20.19 or newer (tested on 22 and 24), npm, and Docker Desktop for the
database. Any PostgreSQL 16+ server works instead of Docker if you point `DATABASE_URL` at it; the
`pg_trgm` extension must be available (it ships with PostgreSQL).

```bash
git clone https://github.com/utkarshpawade/quote-desk.git
cd quote-desk
npm install                 # also generates the Prisma client
cp .env.example .env        # the defaults match the Docker database below
npm run db:up               # PostgreSQL 17 in Docker, on port 5433
npm run db:deploy           # create the tables
npm run db:seed             # demo data, about 15 seconds
npm run dev                 # http://localhost:3000
```

The seed loads the rate masters with history from 2023, seven people, seven customers (Company B–H), the
1,400-row legacy quote register (through the same import as the Import screen), 23 RFQs replayed
through the real services at past dates (drafts, quotes awaiting approval, sent, won and lost), and
two RFQs waiting in intake review. Dates are relative to the day it runs. `npm run db:reset`
rebuilds everything from scratch.

**AI intake.** Put a Groq API key in `GROQ_API_KEY` (from console.groq.com) to read emails and
drawing title blocks with the AI. Without a key everything still works: intake falls back to the
rule-based reader, says so on screen, and drawing photos ask for typed values.

### Tests

```bash
npm test             # unit + integration tests (Vitest)
npm run lint
npm run typecheck
npm run eval:intake  # intake accuracy on 12 synthetic emails → docs/intake-eval.md
npm run test:e2e     # Playwright; needs `npm run build` and freshly seeded data
```

Integration tests use the database in `DATABASE_URL`. The suite that re-seeds the demo uses a
separate database so it never wipes the data you are looking at; create it once and set
`TEST_DATABASE_URL`:

```bash
docker compose exec db psql -U quotedesk -c "CREATE DATABASE quotedesk_test"
DIRECT_URL="postgresql://quotedesk:quotedesk@localhost:5433/quotedesk_test?schema=public" npx prisma migrate deploy
# .env: TEST_DATABASE_URL="postgresql://quotedesk:quotedesk@localhost:5433/quotedesk_test?schema=public"
```

Database suites skip themselves when no database is reachable. The end-to-end test submits and
sends RFQ-2611-014, so run `npm run db:reset` before running it again. GitHub Actions runs all of
this on every push (`.github/workflows/ci.yml`).

## How it is deployed

| Piece | Where | Why |
|---|---|---|
| App | Vercel (functions in `sin1`, Singapore) | Next.js host with no servers to manage; functions run next to the database, because a page makes many database round trips and that latency matters more than browser-to-server distance |
| Database | Neon serverless PostgreSQL (AWS `ap-southeast-1`) | Managed Postgres with `pg_trgm`, pooled connections for serverless functions |
| AI | Groq API | Fast open-weight models; Groq does not train on API data |
| Nightly reset | Vercel Cron → `/api/cron/reset-demo` at 03:00 IST | Keeps the shared demo fresh for every reviewer |

Steps:

1. **Database.** Create a Neon project in AWS Singapore. Copy the pooled connection string (host
   contains `-pooler`) for `DATABASE_URL` and the direct one for `DIRECT_URL`.
2. **Schema and demo data,** once, from your machine:
   ```bash
   DATABASE_URL="<pooled>" DIRECT_URL="<direct>" npm run db:deploy
   DATABASE_URL="<pooled>" DIRECT_URL="<direct>" npm run db:seed
   ```
   Later schema changes are applied the same way with `db:deploy` before the new code is promoted.
3. **App.** Import the GitHub repository in Vercel (framework: Next.js; build command from
   `package.json`: `prisma generate && next build`). Add the environment variables below for
   Production. `vercel.json` sets the region and the nightly cron.
4. **Groq.** Create an API key and turn on Zero Data Retention for the organisation, so prompts
   are not kept even for abuse monitoring.
5. Open the deployment, sign in with a demo account, and check the AI banner on "New RFQ".

### Environment variables (names only)

| Name | Needed | Purpose |
|---|---|---|
| `DATABASE_URL` | always | PostgreSQL connection used by the app (Neon: pooled) |
| `DIRECT_URL` | always | Direct connection for `prisma migrate` (Neon: non-pooled) |
| `GROQ_API_KEY` | for AI intake | Groq key; empty = rule-based reading only |
| `GROQ_TEXT_MODEL` | optional | Extraction model (default `openai/gpt-oss-120b`) |
| `GROQ_VISION_MODEL` | optional | Model that transcribes drawing photos (default `qwen/qwen3.8-27b`) |
| `GROQ_BASE_URL` | optional | Groq-compatible endpoint (default Groq's) |
| `DEMO_MODE` | demo only | `true` shows demo accounts on sign-in and lets the sales head reset the demo |
| `SEED_DEMO_PASSWORD` | optional | Password for seeded accounts (default `Chakan@2026`) |
| `CRON_SECRET` | hosted | Shared secret Vercel Cron sends to the nightly reset; without it the route refuses every call |
| `APP_ORIGIN` | optional | Public origin, if requests can arrive under another host name (same-origin checks) |
| `TEST_DATABASE_URL` | tests only | Separate database for the re-seeding integration suite |

No secrets are committed: `.env` is git-ignored and `.env.example` holds placeholders only.

### Limits of the hosted demo

- Uploads are capped at 4 MB per file (Vercel's request limit) and 60 MB per person per day; AI
  extraction at 40 calls per person per hour.
- Files are stored in PostgreSQL (`bytea`), which is fine for a demo; production would move them to
  encrypted object storage.
- "Send to customer" writes to an outbox and stores the exact PDF; no email leaves the system.
- The sales head can reset the demo from the sidebar; it also resets every night.
