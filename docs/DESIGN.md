# Quote Desk — design notes

Working design for Company A's RFQ-to-quote costing app (brief #1). This file is the
source of truth while building; the Technical Design Document is derived from it.
Every assumption is labelled **A-n** and collected in §12.

---

## 1. Scope

**Core slice (must work end to end)**

| Area | What ships |
|---|---|
| Sign-in & roles | Named users, email + password, roles `ESTIMATOR` and `SALES_HEAD` |
| RFQ register | List with due dates, owners, status (estimating → in approval → approved → sent → won / lost with reason, plus regretted), filters, search, KPIs |
| AI intake | RFQ email (.eml / .txt / pasted), Excel part list (.xlsx), drawing title block (PDF text layer or image) → extracted fields with source + confidence → per-field accept / edit / reject → RFQ + parts |
| Part costing | Material, weights, scrap, routing (cycle time × hour rate, setup, per-kg and per-piece processes), rejection, overhead, ICC, packing, freight, tooling, margin — priced at 1–3 volumes, live |
| Rate masters | Append-only rate versions with effective dates; quotes reference the exact versions they used |
| Approval | Submit → rule: annual value > ₹25 lakh needs sales head approval; approve / return with comment; frozen snapshot |
| PDF quote | Letterhead, part × volume prices, cost breakup, GST shown separately, rate-basis annex, mock send |

**Depth (from the brief's must-have list, built after the core)**

- Past-quote search + "similar part" lookup (the client's "what did we quote last year" ask).
- Import of past quotes from Excel (~1,400 rows) with a dry-run validation report.
- Routing suggestions from similar past parts, each showing the past part it came from.
- Activity timeline, file-access log (NDA), quote revisions (R0, R1 …), turnaround KPI.

**Out of scope (per brief):** CAD/3D analysis, ERP integration, supplier portal.

---

## 2. Roles and permissions

| Capability | Estimator | Sales head |
|---|---|---|
| View register, RFQs, parts, files, past quotes, rate masters | ✓ | ✓ |
| Run AI intake, accept/edit/reject extracted values, create RFQs | ✓ | ✓ |
| Edit costings (draft quotes) | ✓ | — (A-13) |
| Submit quote | ✓ | — |
| Approve / return quote | — | ✓ |
| Send approved quote (mock email) | owner of RFQ | ✓ |
| Mark won / lost / regretted, reassign owner | ✓ | ✓ |
| Add / remove rate versions, add rate items | — | ✓ (A-13) |
| Import past quotes | ✓ | ✓ |

Enforced server-side in every action and route handler; the UI only hides what the
server would refuse anyway.

---

## 3. Costing model (the hard part)

All cost maths is deterministic TypeScript in `src/domain/costing`. AI never computes a cost.
Arithmetic uses `decimal.js` (no binary floats). The same engine runs in the browser for
instant feedback and on the server, which is authoritative on save and submit.

### 3.1 Inputs (one costing line = one part of a quote)

- **Material** — a `MATERIAL` rate item (₹/kg) and a `SCRAP` rate item (₹/kg), each resolved
  to a version at the quote's *basis date*.
- **Weights** — gross (input/cut/forging-input) and net (finished) weight in kg. `net ≤ gross`.
- **Routing** — ordered operations, each bound to a rate item:
  - `MACHINE` (₹/hour): cycle time (min/pc) and setup time (min/batch).
  - `PROCESS` per kg (₹/kg): weight basis `GROSS` or `NET` (forging conversion, heat treatment, shot blasting).
  - `PROCESS` per piece (₹/pc): outsourced or fixed-price processes (plating, MPI, marking).
- **Commercials** — rejection % (default from master, editable per part, 0–15 %),
  overhead % and ICC % (from master, not editable), packing type (₹/pc), freight zone (₹/kg),
  tooling (₹, mode `NONE` / `SEPARATE` / `AMORTIZED` over N years), batches per year
  (default from master), margin basis (`TOTAL_COST` or `CONVERSION`, per quote, default from customer).
- **Volume tiers** — 1–3 tiers, each an annual volume (positive integer, unique) and a margin %.
  Default tiers: ⅔×, 1×, 4⁄3× the RFQ annual volume, rounded to the nearest 1,000 (A-6).
- **GST %** — from master (18 %, A-8), shown separately, never inside the unit price.

### 3.2 Formulas (per piece, for each tier with annual volume V)

Every line is rounded half-up to the paisa; lines below are computed from the *rounded*
lines above them, so the printed breakup always adds up exactly and an auditor can
recompute it with a calculator.

| # | Line | Formula |
|---|---|---|
| 1 | Raw material | `gross × rmRate` |
| 2 | Scrap credit | `(gross − net) × scrapRate` (shown negative) |
| 3 | **Net material** | `L1 − L2` |
| 4 | Process cost | `Σ op run cost`, where machine op = `cycleMin / 60 × hourRate`, per-kg op = `rate × weight(basis)`, per-pc op = `rate`; each op rounded to paisa |
| 5 | Setup (amortized) | `round( Σ_machine ops (setupMin / 60 × hourRate) / batchQty(V) )`, `batchQty(V) = ceil(V / batchesPerYear)` |
| 6 | **Conversion** | `L4 + L5` |
| 7 | Rejection allowance | `rejectionPct × (L3 + L6)` |
| 8 | Overhead | `overheadPct × L6` |
| 9 | ICC | `iccPct × L3` (inventory carrying cost on material) |
| 10 | Packing | `packingRate` |
| 11 | Freight | `freightRate × net` |
| 12 | Tooling (amortized) | `AMORTIZED`: `toolingCost / (V × amortYears)`; otherwise 0 |
| 13 | **Total cost** | `L3 + L6 + L7 + L8 + L9 + L10 + L11 + L12` |
| 14 | Margin | `marginPct(V) × base`, base = `L13` (`TOTAL_COST`) or `L6` (`CONVERSION`) |
| 15 | **Unit price (ex-GST)** | `L13 + L14` |
| 16 | GST | `gstPct × L15` (separate) |
| 17 | Price incl. GST | `L15 + L16` |
| 18 | Annual value (ex-GST) | `L15 × V` |
| 19 | Price per kg | `L15 / net` (benchmark against past quotes) |

What changes with volume: setup amortization, amortized tooling and the margin chosen
per tier. Tooling in `SEPARATE` mode is printed as a one-time charge.

### 3.3 Validation

Blocking errors (cannot save as valid, cannot submit): gross ≤ 0, net ≤ 0, net > gross, no tiers,
more than 3 tiers, non-integer / non-positive / duplicate volumes, machine op without cycle time,
negative times, any rate missing on the basis date, margin outside −20 %…60 %,
rejection outside 0…15 %, amortized tooling without years.

Warnings (shown to estimator and approver, not blocking): margin below the master's margin floor,
yield (net/gross) below 40 %, a cycle time above 120 min, price per kg more than 25 % away
from the median of the five most similar past quotes, unaccepted AI-sourced values or
unconfirmed suggested operations (these block *submit*, not save).

### 3.4 Approval rule

`quoteAnnualValue = Σ over parts of max over tiers (unitPrice × V)` — the highest exposure the
customer could place (A-1). If `quoteAnnualValue > approvalThreshold` (₹25,00,000, from the
commercial master, strictly greater) the quote needs a sales head's approval; otherwise it is
approved by rule on submit, logged as such (A-2).

### 3.5 Worked example (RFQ-2611-014, rear wheel spindle, EN8, from sample data)

Rates (illustrative, A-9): EN8 bar ₹72.50/kg, steel turnings ₹18/kg, bar-cutting saw ₹350/h,
CNC turning centre ₹850/h (sample), thread rolling ₹600/h, induction hardening ₹3.20/pc,
VCI bag + box ₹1.80/pc, freight Pune zone ₹1.20/kg, overhead 15 %, rejection 2 %, ICC 1.5 %,
margin 12 %, GST 18 %, 12 batches/year. Gross 0.61 kg (sample), net 0.47 kg (A-15).

| Line | 120,000 | **180,000** | 240,000 |
|---|---:|---:|---:|
| Raw material 0.61 × 72.50 | 44.23 | 44.23 | 44.23 |
| Scrap credit 0.14 × 18 | −2.52 | −2.52 | −2.52 |
| Net material | 41.71 | 41.71 | 41.71 |
| Process (2.04 + 45.33 + 4.00 + 3.20) | 54.57 | 54.57 | 54.57 |
| Setup (₹1,025/batch) | 0.10 | 0.07 | 0.05 |
| Conversion | 54.67 | 54.64 | 54.62 |
| Rejection 2 % | 1.93 | 1.93 | 1.93 |
| Overhead 15 % | 8.20 | 8.20 | 8.19 |
| ICC 1.5 % | 0.63 | 0.63 | 0.63 |
| Packing | 1.80 | 1.80 | 1.80 |
| Freight 0.47 × 1.20 | 0.56 | 0.56 | 0.56 |
| Total cost | 109.50 | 109.47 | 109.44 |
| Margin 12 % | 13.14 | 13.14 | 13.13 |
| **Unit price** | **122.64** | **122.61** | **122.57** |
| GST 18 % (separate) | 22.08 | 22.07 | 22.06 |
| Annual value | ₹1.47 Cr | ₹2.21 Cr | ₹2.94 Cr |

→ annual value far above ₹25 lakh, so the quote routes to the sales head. These numbers are a
unit-test fixture.

---

## 4. Rate masters and versioning

- `RateItem` — one per rate: category (`MATERIAL`, `SCRAP`, `MACHINE`, `PROCESS`, `PACKING`,
  `FREIGHT`, `COMMERCIAL`), code, name, unit (`PER_KG`, `PER_HOUR`, `PER_PIECE`, `PERCENT`,
  `RUPEES`, `COUNT`), attributes (grade, family, aliases, default scrap item, zone …).
- `RateVersion` — `(rateItemId, value, effectiveFrom, note, createdBy, createdAt)`, unique per
  item and date, **append-only**. `effectiveTo` is derived (next version's start − 1 day).
- **Resolution:** `rateAt(item, date)` = the version with the latest `effectiveFrom ≤ date`.
  None → "missing rate", a blocking costing error.
- **No back-dating (A-10):** a new version must start today or later, so the rate in force on any
  past date never changes after the fact. A future-dated version not yet used by any quote can be
  deleted (to correct a typo); a used version can never be deleted (FK `RESTRICT`).
- **Quotes remember their rates:** every costing line and operation stores the `RateVersion` id it
  priced with. On submit the full computed result (inputs, rate values, every line) is frozen as JSON
  with a SHA-256 hash; re-computing a frozen quote from its stored inputs must reproduce it exactly
  (tested).
- **Basis date:** each quote has one rate basis date (default: today). Changing it re-resolves every
  rate and shows a before/after diff. When a newer version exists than the one a draft uses, the
  costing screen offers "Re-price on today's rates" with the per-tier price change.
- Commercial parameters are rate items too (overhead %, default rejection %, ICC %, default margin %,
  margin floor %, GST %, approval threshold ₹, batches per year), so policy changes are versioned
  the same way.

---

## 5. AI intake (RFQ extraction) — and what happens when it is wrong

### 5.1 Pipeline

1. **Upload** — estimator drops the RFQ email (.eml/.txt or pasted text), Excel part list
   (.xlsx/.csv) and drawings (.pdf/.png/.jpg). Files are stored in Postgres (bytea), access-logged,
   magic-byte checked, max 4 MB each (Vercel request limit, A-19).
2. **Read each source**
   - Email → headers + plain-text body (MIME parsed); text is numbered line by line.
   - Excel → parsed deterministically: header row detected, columns mapped by a synonym table
     (`Part No / Part Number / Item Code`, `Annual Qty / EAU / Volume` …); every value keeps its
     cell address (`Sheet1!E4`). The LLM is not needed for well-formed sheets.
   - Drawing PDF → text layer extracted; the LLM reads the title block from that text.
   - Drawing image → vision model reads the title block (JSON mode).
   - Scanned PDF with no text layer → the source is marked "no readable text; upload an image of the
     title block or type values" (never silently skipped).
3. **Extract** — Groq `openai/gpt-oss-120b` with strict JSON-schema output, temperature 0. The prompt
   treats the document as data, asks for `null` when a value is absent, and for every field the
   **verbatim evidence** substring and line number.
4. **Normalize** — Indian number formats (`1,80,000`, `1.8 lakh`, `1.8 L`, `180k`), units (`610 g` →
   0.61 kg), dates (DD/MM/YYYY when ambiguous, A-12; `12-Nov-26`, `12th November 2026`), material
   grades against master aliases (`EN-8`, `080M40` → EN8), customer by sender domain.
5. **Ground** — each AI value is checked against its source: the evidence must occur in the source
   text (whitespace/case-insensitive) and the normalized value must be derivable from the evidence.
   Ungrounded values are demoted to *Low* confidence and labelled "not found in source".
6. **Merge** — candidates for the same field from different sources (email vs Excel vs drawing) are
   compared after normalization: agreement → one value listing all sources (confidence raised);
   disagreement → **conflict**, both shown, estimator chooses. Parts are matched across sources by
   normalized part number, then by description similarity.
7. **Review** — every pre-filled value shows value, source chip (click → source excerpt with the
   evidence highlighted), confidence (High / Medium / Low, in words, not just colour) and actions
   accept / edit / reject. "Accept all High" is an explicit bulk action. The RFQ cannot be created
   until the required fields (customer, due date, ≥ 1 part with description and annual volume) are
   resolved; parts cannot be submitted for approval while any of their AI values are unresolved.
8. **Provenance** — accepted values carry their source into the RFQ/part (`FieldProvenance`); the
   costing screen shows a source marker next to each pre-filled number.

### 5.2 Failure modes

| Situation | Behaviour |
|---|---|
| No API key / Groq down / timeout (25 s) / 429 | two retries with back-off, then rule-based extractor (regex) for email and title block; banner "AI unavailable — rule-based extraction, review carefully"; values capped at Medium |
| Invalid / non-schema JSON | strict mode prevents it; zod re-validates; on failure → rule-based fallback for that source |
| Hallucinated value | grounding check → Low + "not found in source" |
| Sources disagree | conflict row, never auto-resolved |
| Unknown material grade | value kept as text, flagged "not in material master", costing blocked until mapped |
| Prompt injection in an email | output is data validated against a schema; extraction cannot trigger actions; cost maths never uses AI |
| Image-only input | vision model, Medium at best (no text to ground against) |

### 5.3 Data protection (NDA)

Groq's Services Agreement §4.2: Groq "is not permitted to use Inputs or Outputs for training or
fine-tuning" unless the customer instructs it; inference data is not retained by default and Zero
Data Retention can be enabled in the Groq console (recommended for production). Only the text needed
for extraction is sent (email body, title-block text), never the whole drawing when its text layer is
readable. Files are served only to signed-in named users; every view/download is logged.

### 5.4 Routing suggestions from past parts

Deterministic, explainable retrieval (not generative), so every suggestion is a real past routing:

`score = 0.40·name + 0.25·material + 0.20·weight + 0.10·process + 0.05·recency`

- name: character-trigram Dice similarity of normalized descriptions
- material: same grade 1, same family 0.6, else 0
- weight: `1 − min(1, |w₁ − w₂| / max(w₁, w₂))`
- process: overlap of process hints extracted from the drawing notes (e.g. "induction harden")
  with the candidate's operations
- recency: 1 if quoted within 24 months, decaying to 0 at 48

Top 3 with score ≥ 0.45 are shown with the score breakdown and the source part ("from
Q/25-26/0412 Front wheel spindle, EN8, 0.58 kg, Company B, won Mar 2025"). Applying one copies its
operations as **unconfirmed** (cycle times flagged) until the estimator confirms the routing. If the
drawing mentions a process the suggestion lacks, a warning says so.

---

## 6. Data model (Prisma, PostgreSQL)

```
User(id, email, name, role, passwordHash, active)
Session(id = sha256(token), userId, expiresAt, lastSeenAt, ip, userAgent)
LoginAttempt(email, ip, success, at)                      -- rate limiting
Customer(id, code, name, segment, emailDomain, city, freightItemId, packingItemId, marginBasis, paymentTerms)
Rfq(id, number, customerId, customerRef, subject, receivedAt, dueDate, ownerId, status,
    lostReason, statusNote, createdById, createdAt, updatedAt)
RfqPart(id, rfqId, lineNo, partNo, description, drawingNo, drawingRev, materialText, materialItemId,
        grossWeightKg, netWeightKg, annualVolume, heatTreatment, surfaceTreatment, processHints[], notes)
FieldProvenance(id, entityType, entityId, fieldKey, value, sourceKind, sourceLabel, locator, evidence,
                confidence, extractedFieldId, acceptedById, acceptedAt)
RateItem(id, category, code, name, unit, attributes, active)
RateVersion(id, rateItemId, value, effectiveFrom, note, createdById, createdAt)  -- unique(item, date)
Quote(id, rfqId, revision, number, status, basisDate, validityDays, marginBasis, gstVersionId,
      thresholdVersionId, annualValue, requiresApproval, submittedById/At, decidedById/At, decisionNote,
      sentById/At, sentTo, snapshot(json), snapshotHash, lockVersion)
QuoteLine(id, quoteId, rfqPartId, materialVersionId, scrapVersionId, grossWeightKg, netWeightKg,
          rejectionPct, overheadVersionId, iccVersionId, packingVersionId, freightVersionId,
          toolingMode, toolingCost, toolingAmortYears, batchesPerYear, routingConfirmed)
QuoteOperation(id, lineId, seq, name, rateVersionId, cycleTimeMin, setupMin, weightBasis,
               suggestedFromId, confirmed)
QuoteTier(id, lineId, sortOrder, volume, marginPct)
QuoteEvent(id, quoteId, actorId, action, note, at)        -- submit / auto-approve / approve / return / send
IntakeSession(id, rfqId?, createdById, status, mode, model, error, durationMs, createdAt)
IntakeSource(id, sessionId, kind, fileId, label, status, mode, error, text)
ExtractedField(id, sessionId, partKey, fieldKey, proposedValue, candidates(json), confidence, conflict,
               status, finalValue, decidedById, decidedAt)
StoredFile(id, rfqId?, filename, mimeType, sizeBytes, sha256, data(bytea), uploadedById)
FileAccess(id, fileId, userId, action, at)
PastQuote(id, source, refNo, quoteDate, customerName, customerId?, partNo, description, materialText,
          materialItemId?, grossWeightKg, netWeightKg, annualVolume, unitPrice, outcome, lostReason,
          routingText, routingOps(json), quoteLineId?, importBatchId?, searchText)  -- pg_trgm GIN index
ImportBatch(id, filename, rowsTotal, rowsImported, rowsSkipped, rowsFailed, issues(json), createdById)
AuditEvent(id, actorId, rfqId?, entityType, entityId, action, summary, data, at)
OutboxMessage(id, quoteId, to, subject, body, pdfFileId, createdById, createdAt)   -- mock email
Counter(key, value)                                        -- RFQ-YYMM sequence, row-locked
```

Money: `numeric(14,2)`; rates `numeric(14,4)`; weights `numeric(10,3)`; minutes `numeric(8,2)`;
percentages `numeric(6,3)`. Decimals cross the server/client boundary as strings.

---

## 7. Statuses

RFQ: `ESTIMATING → IN_APPROVAL → APPROVED → SENT → WON | LOST(reason)`;
`IN_APPROVAL → ESTIMATING` (returned); `SENT → ESTIMATING` (revision R+1);
`ESTIMATING → REGRETTED(reason)` (declined to quote). Approved-by-rule skips `IN_APPROVAL`.
Lost reasons: price, lead time, technical, customer cancelled, incumbent retained, other.

Quote: `DRAFT → IN_APPROVAL → APPROVED → SENT`, `IN_APPROVAL → DRAFT` (returned),
`SENT → SUPERSEDED` when a later revision is sent. Only `DRAFT` is editable.

Transitions are a pure function with a table-driven test.

---

## 8. Screens

Desktop-first (A-18), responsive down to 360 px: sidebar becomes a top bar + drawer, tables scroll
horizontally inside their card, costing columns stack.

1. **Sign in** — email + password; in demo mode a panel lists demo accounts with one-click fill.
2. **RFQ register** (`/rfqs`) — KPI strip (open, due ≤ 2 working days, overdue, average turnaround
   last 30 days vs 4-day target, win rate); status tabs; owner/customer filters; search; table:
   RFQ no, customer, parts, owner, received, due (working days left / overdue), status, annual value.
   Banner for intakes awaiting review.
3. **New RFQ / intake** (`/rfqs/new`) — drop zone + paste box; sample RFQ packs loadable in one click;
   per-source progress; manual entry path.
4. **Intake review** (`/intake/[id]`) — RFQ-level fields + per-part field tables; source chips open a
   side panel with the source excerpt; conflicts; progress footer; "Create RFQ".
5. **RFQ detail** (`/rfqs/[id]`) — header with status actions; parts with costing status and base
   price; quote card (annual value, approval requirement, revisions, PDF); files with access log;
   activity timeline.
6. **Part costing** (`/rfqs/[id]/parts/[partId]`) — left: material & weights, routing table,
   commercials, volume tiers; right (sticky): cost breakup with one aligned column per volume,
   approval indicator, similar past quotes; routing suggestion panel; autosave with status; rate
   version chips; re-price banner.
7. **Approvals** (`/approvals`) — sales head queue sorted by due date with annual value, lowest
   margin and flags; review page with per-part, per-tier prices, margins, ₹/kg vs similar past quotes,
   rate basis and warnings; approve / return with comment.
8. **Quote** (`/quotes/[id]`) — HTML preview identical in content to the PDF; download PDF; send
   (mock email composer); revise; mark won / lost.
9. **Rate masters** (`/rates`) — category tabs; "as of" date control; table with current value,
   effective from, next scheduled change, versions, quotes using it; drawer with version timeline
   and add-version form.
10. **Past quotes** (`/past-quotes`) — search + filters; similar-part mode; results with ₹/pc and ₹/kg;
    detail drawer with routing.
11. **Import** (`/imports`) — upload → column mapping + row validation report → import → batch history.

Every data view has loading (skeleton), empty (one sentence + the next action) and error
(message + retry) states.

---

## 9. Visual design

Calm, precise, quiet — an engineering ledger, not a dashboard.

- **Type:** IBM Plex Sans for UI (an industrial face with clear tabular figures), IBM Plex Mono for
  identifiers (RFQ, part and rate codes). 14 px UI, 13 px dense tables, 12 px captions.
  All numbers `tabular-nums`, right-aligned, same decimals in a column.
- **Colour:** warm white background, white surfaces, hairline borders; ink text in three steps;
  one accent (deep steel blue) for primary actions and focus; status uses a small dot + word in
  muted hues; AI-sourced values use a single violet marker until accepted. No gradients, no
  decorative illustration.
- **Layout:** 8 px grid; generous white space in register/list views; dense but aligned in the
  costing screen; numbers never wrap; units in column headers rather than every cell.
- **Formatting:** Indian grouping (`₹1,23,456.00`), annual values in lakh/crore (`₹2.21 Cr`),
  dates `03 Nov 2026`.
- **Accessibility:** WCAG AA contrast, visible focus, labelled inputs, keyboard-operable tables and
  dialogs, status never by colour alone.

---

## 10. Architecture

- **Next.js 16 (App Router) monolith on Vercel + Neon Postgres.** One deployable, server components
  for reads, server actions for mutations, route handlers for uploads, file downloads, intake and PDFs.
  Six estimators and a sales head do not need services or queues; the 7-week budget favours one
  codebase with end-to-end types.
- **Layers**
  - `src/domain/*` — pure, framework-free logic (costing, rates, approval, statuses, calendar,
    numbering, intake normalization/grounding/merge, similarity). Fully unit tested; runs in browser
    and server.
  - `src/server/*` — `server-only`: Prisma client, auth/session, permission guards, services
    (rfq, quote, rate, intake, import, search), Groq client, PDF rendering, audit.
  - `src/app/*` — routes; `src/components/ui/*` design system; `src/components/<feature>/*`.
- **Auth:** own session implementation — random 256-bit token in an HttpOnly, SameSite=Lax, Secure
  cookie; only its SHA-256 is stored; 12 h sliding expiry; scrypt password hashes; login throttling
  (5 failures / 15 min per email+IP). `proxy.ts` redirects anonymous requests; every server action and
  route re-validates the session and role.
- **Validation:** zod at every boundary (actions, routes, AI output, Excel rows).
- **Security headers:** `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, strict referrer
  policy, permissions policy. Files served with `Content-Disposition` and their sniffed type.
- **Secrets:** only in environment variables; `.env.example` lists names.

---

## 11. Seed and sample data

Deterministic (seeded PRNG), dates relative to the day the seed runs so due dates stay meaningful;
a sales-head-only "Reset demo data" action exists in demo mode.

- Users: 4 estimators, 1 sales head (fictional names, `@companya.example`).
- Customers: Company B (two-wheelers), C (tractors), D (drivetrains) from the brief, plus E–H
  (A-14).
- Rate masters with 2–3 historical versions each and one scheduled future change.
- RFQs: the three sample RFQs (014 estimating, 019 in approval, 023 created from a completed AI
  intake) plus ~30 others across every status, 1–5 parts each.
- One intake session awaiting review (so the review screen can be seen without an API key).
- Past quotes: `sample-data/past-quotes-2023-2026.xlsx` with 1,400 rows, imported by the seed
  through the same import service the UI uses; plus a 60-row file with deliberate errors.
- Sample RFQ packs (email + Excel + drawing PDF/PNG), loadable from the New RFQ screen.

---

## 12. Assumptions

- **A-1** Annual value for the approval rule is the sum over parts of the highest (unit price ex-GST ×
  volume) across the quoted volumes; "above ₹25 lakh" means strictly greater.
- **A-2** Quotes at or below the threshold are approved by rule on submit (logged) and the estimator
  who owns the RFQ may send them.
- **A-3** Margin is a markup on cost; the base is total cost unless the customer's format allows
  margin on conversion only (customer setting, per quote).
- **A-4** Overhead applies to conversion; rejection allowance to net material + conversion; ICC to net
  material.
- **A-5** Freight is per kg of finished weight to the customer's freight zone (prices FOR destination).
- **A-6** Setup is amortized over a batch of `annual volume / batches per year` (default 12); default
  quoted volumes are ⅔×, 1× and 4⁄3× the RFQ volume.
- **A-7** Tooling is quoted either as a separate one-time charge or amortized over N years of volume.
- **A-8** GST 18 % by default (a versioned master value); HSN classification is out of scope.
- **A-9** All seeded rates, prices and past quotes are illustrative.
- **A-10** Rate versions cannot be back-dated; unused future versions may be deleted.
- **A-11** Working days exclude Sundays; no holiday calendar.
- **A-12** Ambiguous dates are read as DD/MM/YYYY.
- **A-13** Rate masters are maintained by the sales head; costings are edited by estimators only
  (segregation of duties between costing and approval).
- **A-14** Customers E–H and every person's name are invented.
- **A-15** Net weights, secondary operations and setup times for the three sample parts are not in the
  brief and are assumed; the sample cycle time and hour rate are used for each part's main operation.
- **A-16** The legacy Excel layout (columns of the past-quote register) is assumed.
- **A-17** RFQ numbers follow the sample pattern `RFQ-YYMM-NNN`, sequence resetting monthly.
- **A-18** Desktop is the primary device (per brief); phone layouts are supported for reading and light
  edits.
- **A-19** Hosted demo accepts files up to 4 MB each (Vercel request-body limit).
- **A-20** "Send" writes to an outbox and stores the exact PDF sent; no email leaves the system.
- **A-21** One quote document covers all parts of an RFQ; quotes are valid for 30 days.

---

## 13. Testing

- Unit (Vitest): costing engine (fixture above, rounding invariants, volume effects, margin basis,
  validation), approval boundary, rate resolution, status transitions, working days, numbering,
  intake normalization / grounding / merge, Excel mapping and row validation, similarity scoring,
  Groq client failure paths (mocked fetch), permission matrix.
- Integration: quote snapshot reproducibility; RFQ counter under concurrent inserts.
- End-to-end (Playwright): estimator costs and submits → sales head approves → PDF downloads.
