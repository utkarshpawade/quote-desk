# Quote Desk — design notes

Working design for Company A's RFQ-to-quote costing app (brief #1). This file was the
source of truth while building; the Technical Design Document ([TDD.md](TDD.md)) is derived
from it and records what was finally built. Every assumption is labelled **A-n** and collected
in §12. Revision 2 folds in an internal review (domain, requirements, UX and architecture lenses).

> **Status.** Built as described here, except: review keyboard shortcuts, "simulate incoming
> RFQ", "apply margin to all parts", the approver's provenance summary line, rate bulk update with
> change-impact preview and the file-access log screen were cut (TDD §10). Similar parts open as a
> page (`/past-quotes?similar=…`) rather than a drawer; drawing processes missing from the routing
> show as a warning line rather than ghost rows; past-quote search matches every word with
> `LIKE` on the trigram index; assumptions A-28 to A-32 were added in the TDD.

---

## 1. Scope, build order and cut line

**Core (must work end to end, in this order):**

1. Costing engine with fixtures + rate masters with versioning.
2. RFQ register → RFQ workspace → part costing → submit → approval → PDF quote → send (mock).
3. AI intake: email / Excel / drawing → reviewed values → RFQ.
4. Past-quote import (~1,400 Excel rows, idempotent) + similar-part search + routing
   suggestions. Promoted to core: the brief lists the import as a constraint and the costing and
   approval screens use the data.

**Depth, in cut order (last is cut first):** extraction-accuracy eval → estimator-time KPIs →
rate bulk update and change-impact preview → quote revisions → drawing image (vision) path →
file-access log view → demo reset. Rule: anything unfinished is removed from navigation and
actions — no dead buttons.

**Out of scope (brief):** CAD/3D analysis, ERP integration, supplier portal.

**Screens (7 core + 3 supporting):** sign-in, RFQ register, intake (upload + review), RFQ
workspace (overview + one tab per part = costing), quote (document + approval rail + send),
rate masters, past quotes; supporting: import, files/activity tabs inside the workspace.

---

## 2. Roles and permissions

| Capability | Estimator | Sales head |
|---|---|---|
| View register, RFQs, parts, files, past quotes, rate masters | ✓ | ✓ |
| Run AI intake, decide extracted values, create RFQs | ✓ | ✓ |
| Edit costings (draft quotes) | ✓ | — (A-13) |
| Submit quote | ✓ | — |
| Approve / return quote | — | ✓ |
| Send quote (mock email + stored PDF) | — | ✓ (brief: "approves and sends") |
| Mark won / lost / regretted, reassign owner | ✓ | ✓ |
| Rate masters: add, void, bulk update | — | ✓ (A-13) |
| Import past quotes | ✓ | ✓ |

Quotes at or below the threshold are approved by rule on submit and land in the sales head's
"Ready to send" view, so even small quotes leave through the sales head (A-2). Enforced
server-side in every action and route; the UI hides what the server would refuse.

---

## 3. Costing model (the hard part)

All cost maths is deterministic TypeScript in `src/domain/costing`. AI never computes a cost.
Arithmetic uses `decimal.js`. The engine runs in the browser for instant feedback and on the
server, which is authoritative on save and submit.

### 3.1 Inputs (one costing line = one part of a quote)

- **Material** — `MATERIAL` rate (₹/kg) resolved at the basis date; scrap rates: `turnings`
  (always) and `flash` (forged parts only), both `SCRAP` items (₹/kg).
- **Weights (kg)** — gross (input: cut bar or forging input), optional forged (after trim),
  net (finished). `net ≤ forged ≤ gross`. Optional scale loss % (forgings; master default).
- **Bought-out parts (BOP)** — rate items in the `BOP` category (₹/pc) × quantity.
- **Routing** — ordered operations, each bound to a rate item:
  - `MACHINE` (₹/hour): cycle time (min/pc), setup time (min/batch). Always in-house.
  - `PROCESS_KG` (₹/kg) with weight basis `GROSS` / `FORGED` / `NET`.
  - `PROCESS_PC` (₹/pc).
  - Every process item is flagged **in-house** or **outside (job work)**; overhead applies only to
    in-house conversion.
- **Commercials** — rejection % (default from master; editable 0–10 %), overhead % (master),
  ICC = interest % p.a. × inventory days / 365 (master), packing item (₹/pc), freight zone
  (₹/kg of net weight), tooling (₹, `NONE` / `SEPARATE` one-time / `AMORTIZED` over N years),
  batches per year (master default 12), margin basis `MFG_COST` (default) or `CONVERSION`
  (customer setting), GST class per part (`GST_18` / `GST_5`, default from customer segment).
- **Volume tiers** — 2–3 tiers. The **base tier** equals the RFQ annual volume: read-only, cannot
  be removed, carries the RFQ value's provenance. Other tiers are free (positive, unique integers).
  Default extra tiers: ⅔× and 4⁄3× the base, rounded to 2 significant figures (to the nearest 100
  below 10,000); dropped if ≤ 0 or duplicate (A-6). Default margins come from a versioned
  **margin ladder**: base 12 %, a tier below base +2 pp, above base −1.5 pp (A-23).

### 3.2 Formulas (per piece, per tier with annual volume V)

Each line is rounded half-up to the paisa; every line is computed from the *rounded* lines it
depends on, so the printed breakup adds up exactly and can be re-checked with a calculator.

| # | Line | Formula |
|---|---|---|
| 1 | Raw material | `gross × rmRate` |
| 2 | Scrap credit (shown negative) | forged: `(gross × (1 − scale%) − forged) × flashRate + (forged − net) × turningsRate`; otherwise `(gross − net) × turningsRate` — summed, then rounded |
| 3 | **Net material** | `L1 − L2` |
| 4 | Bought-out parts | `Σ round(rate × qty)` |
| 5 | In-house process | `Σ round(op)` over in-house ops: machine `cycle/60 × ₹/h`, per-kg `₹/kg × weight(basis)`, per-pc `₹/pc` |
| 6 | Setup (amortized) | `round( Σ machine (setup/60 × ₹/h) / batchQty(V) )`, `batchQty = ceil(V / batchesPerYear)` |
| 7 | Outside processing | `Σ round(op)` over job-work ops |
| 8 | **Conversion** | `L5 + L6 + L7` |
| 9 | Rejection allowance | `rejection% × (L3 + L4 + L8)` |
| 10 | Overhead | `overhead% × (L5 + L6)` — in-house conversion only |
| 11 | ICC | `interest% × days / 365 × (L3 + L4)` |
| 12 | **Manufacturing cost** | `L3 + L4 + L8 + L9 + L10 + L11` |
| 13 | Profit | `margin%(V) × base`, base = `L12` (`MFG_COST`) or `L5 + L6` (`CONVERSION`) |
| 14 | Packing | `packing ₹/pc` (at cost) |
| 15 | Freight | `freight ₹/kg × net` (at cost) |
| 16 | Tooling (amortized) | `AMORTIZED`: `tooling / (V × years)`; otherwise 0 (at cost) |
| 17 | **Unit price (ex-GST)** | `L12 + L13 + L14 + L15 + L16` |
| 18 | Annual value | `L17 × V` |
| 19 | Price per kg | `L17 / net` |
| 20 | Conversion per kg | `(L17 − L3) / net` (benchmark that ignores steel price swings) |

GST is not a costing decision: it appears on the quote and PDF per part (`gst% × L17`, by GST
class), resolved at the document date. Profit is never charged on packing, freight or tooling
recovery, and overhead never on job work or BOP — matching OEM cost-breakup formats.

### 3.3 Validation and how it shows

- **Part-level errors** (price withheld for every tier): gross/net missing or ≤ 0, `net > gross`,
  forged outside `[net, gross]`, material or scrap rate missing on the basis date, machine op
  without a rate or cycle time, negative times, scrap rate ≥ RM rate, amortized tooling without years.
- **Tier-level errors** (that column only): volume not a positive integer, duplicate volume,
  margin outside −20…60 % (A-24).
- **Submit-only errors**: fewer than 2 tiers, unresolved AI-sourced values, unconfirmed suggested
  operations, stale rates (see §4.4).
- **Warnings** (shown next to the number they qualify, carried to the approver): margin below the
  master's floor; yield (net/gross) < 40 %; cycle time > 120 min; conversion ₹/kg more than 25 %
  from the median of the 5 most similar past quotes (RM-adjusted, §5.5); basis date ≠ today;
  a rate version newer than the one used (A-24).

When an error applies, the dependent figures render as "—" and the status line reads
"Price withheld · n errors". The engine never prints a precise-looking wrong number.

### 3.4 Approval rule

`approvalValue = Σ parts (base-tier unit price × RFQ annual volume) + Σ SEPARATE tooling`.
If `approvalValue > threshold` (₹25,00,000, versioned master, strictly greater), the quote needs a
sales head; otherwise it is approved by rule (logged). The highest-tier exposure is shown to the
approver for information. Because the base tier is pinned to the customer's volume, an estimator
cannot route around approval by choosing tiers (A-1).

### 3.5 Fixture A — RFQ-2611-014, rear wheel spindle, EN8 (bar-turned, high volume)

Inputs (A-9, A-15): gross 0.61 kg (sample), net 0.47 kg, no forging. EN8 bar ₹72.50/kg; turnings
₹26/kg. Routing: bar cutting saw ₹350/h, 0.35 min, setup 15 min · CNC turning centre ₹850/h
(sample), 3.2 min (sample), setup 45 min · thread rolling ₹600/h, 0.40 min, setup 30 min ·
induction hardening (job work) ₹3.20/pc. Setup = ₹87.50 + 637.50 + 300.00 = ₹1,025/batch.
Rejection 2 %, overhead 15 %, ICC 12 % p.a. × 45 days, VCI bag + box ₹1.80/pc, freight Pune
zone ₹1.20/kg, 12 batches/yr, margin ladder 14 / 12 / 10.5 %, margin basis MFG_COST, no tooling.

| Line | 1,20,000 | **1,80,000 (base)** | 2,40,000 |
|---|---:|---:|---:|
| Raw material 0.61 × 72.50 = 44.225 | 44.23 | 44.23 | 44.23 |
| Scrap credit 0.14 × 26 | −3.64 | −3.64 | −3.64 |
| Net material | 40.59 | 40.59 | 40.59 |
| In-house process 2.04 + 45.33 + 4.00 | 51.37 | 51.37 | 51.37 |
| Setup ₹1,025 / 10,000 · 15,000 · 20,000 | 0.10 | 0.07 | 0.05 |
| Outside processing | 3.20 | 3.20 | 3.20 |
| Conversion | 54.67 | 54.64 | 54.62 |
| Rejection 2 % | 1.91 | 1.90 | 1.90 |
| Overhead 15 % of in-house | 7.72 | 7.72 | 7.71 |
| ICC (12 % × 45/365) | 0.60 | 0.60 | 0.60 |
| Manufacturing cost | 105.49 | 105.45 | 105.42 |
| Profit 14 / 12 / 10.5 % | 14.77 | 12.65 | 11.07 |
| Packing | 1.80 | 1.80 | 1.80 |
| Freight 0.47 × 1.20 | 0.56 | 0.56 | 0.56 |
| **Unit price** | **122.62** | **120.46** | **118.85** |
| Annual value | 1,47,14,400.00 | 2,16,82,800.00 | 2,85,24,000.00 |

Approval value ₹2,16,82,800 > ₹25,00,000 → sales head. L1 is an exact half-paisa tie, so this
fixture also pins half-up (not banker's) rounding. A turned spindle at this volume is nearly flat
across volumes; the margin ladder is what moves its price.

### 3.6 Fixture B — RFQ-2611-019, hydraulic lift arm, 40Cr4 forging (volume matters)

Inputs: gross (forging input) 4.60 kg (sample), scale loss 2 %, forged 3.95 kg, net 3.40 kg.
40Cr4 bar ₹84/kg; flash/end-bits ₹34/kg; turnings ₹26/kg. Routing: bar cutting ₹350/h 0.60 min
setup 15 · hot forging (in-house) ₹36/kg × forged · hardening & tempering (job work) ₹19/kg ×
forged · shot blasting (job work) ₹4/kg × forged · HMC machining ₹1,450/h (sample) 11.5 min
(sample) setup 120 · MPI crack detection (job work) ₹4.50/pc. Setup = 87.50 + 2,900.00 =
₹2,987.50/batch. Tooling: dies, trim tool and HMC fixture ₹12,00,000 amortized over 3 years.
Wooden crate ₹9.50/pc, freight Maharashtra zone ₹2.40/kg, other parameters as fixture A.

| Line | 16,000 | **24,000 (base)** | 32,000 |
|---|---:|---:|---:|
| Raw material 4.60 × 84 | 386.40 | 386.40 | 386.40 |
| Scrap credit 0.558 × 34 + 0.55 × 26 = 33.272 | −33.27 | −33.27 | −33.27 |
| Net material | 353.13 | 353.13 | 353.13 |
| In-house 3.50 + 142.20 + 277.92 | 423.62 | 423.62 | 423.62 |
| Setup ₹2,987.50 / 1,334 · 2,000 · 2,667 | 2.24 | 1.49 | 1.12 |
| Outside 75.05 + 15.80 + 4.50 | 95.35 | 95.35 | 95.35 |
| Conversion | 521.21 | 520.46 | 520.09 |
| Rejection 2 % | 17.49 | 17.47 | 17.46 |
| Overhead 15 % of in-house | 63.88 | 63.77 | 63.71 |
| ICC | 5.22 | 5.22 | 5.22 |
| Manufacturing cost | 960.93 | 960.05 | 959.61 |
| Profit 14 / 12 / 10.5 % | 134.53 | 115.21 | 100.76 |
| Packing | 9.50 | 9.50 | 9.50 |
| Freight 3.40 × 2.40 | 8.16 | 8.16 | 8.16 |
| Tooling ₹12,00,000 / (V × 3) | 25.00 | 16.67 | 12.50 |
| **Unit price** | **1,138.12** | **1,109.59** | **1,090.53** |

Approval value 1,109.59 × 24,000 = ₹2,66,30,160 → sales head.

### 3.7 Fixture C — RFQ-2611-023, gear blank, 20MnCr5 (conversion-basis profit, one-time tooling)

Inputs: gross 1.48 kg (sample), scale loss 2 %, forged 1.30 kg, net 1.12 kg. 20MnCr5 bar ₹90/kg;
flash ₹34/kg; turnings ₹26/kg. Routing: bar cutting ₹350/h 0.40 min setup 15 · hot upset forging
(in-house) ₹36/kg × forged · isothermal annealing (job work) ₹16/kg × forged · shot blasting
(job work) ₹4/kg × forged · CNC turning ₹950/h (sample) 4.8 min (sample) setup 60 · phosphating &
oiling (job work) ₹6/kg × **net**. Setup = 87.50 + 950.00 = ₹1,037.50/batch. Company D's format
allows profit on in-house conversion only (margin basis `CONVERSION`); margins 20 / 18 / 16.5 %.
Forging die set ₹2,40,000 quoted **separately** (one-time). Returnable bin ₹0.90/pc, freight
Maharashtra zone ₹2.40/kg.

| Line | 40,000 | **60,000 (base)** | 80,000 |
|---|---:|---:|---:|
| Raw material 1.48 × 90 | 133.20 | 133.20 | 133.20 |
| Scrap credit 0.1504 × 34 + 0.18 × 26 = 9.7936 | −9.79 | −9.79 | −9.79 |
| Net material | 123.41 | 123.41 | 123.41 |
| In-house 2.33 + 46.80 + 76.00 | 125.13 | 125.13 | 125.13 |
| Setup ₹1,037.50 / 3,334 · 5,000 · 6,667 | 0.31 | 0.21 | 0.16 |
| Outside 20.80 + 5.20 + 6.72 | 32.72 | 32.72 | 32.72 |
| Conversion | 158.16 | 158.06 | 158.01 |
| Rejection 2 % | 5.63 | 5.63 | 5.63 |
| Overhead 15 % of in-house | 18.82 | 18.80 | 18.79 |
| ICC | 1.83 | 1.83 | 1.83 |
| Manufacturing cost | 307.85 | 307.73 | 307.67 |
| Profit 20 / 18 / 16.5 % of in-house conversion | 25.09 | 22.56 | 20.67 |
| Packing | 0.90 | 0.90 | 0.90 |
| Freight 1.12 × 2.40 | 2.69 | 2.69 | 2.69 |
| **Unit price** | **336.53** | **333.88** | **331.93** |

Tooling ₹2,40,000 is printed as a one-time charge. Approval value 333.88 × 60,000 + 2,40,000 =
₹2,02,72,800 → sales head. All three fixtures are unit tests.

---

## 4. Rate masters and versioning

### 4.1 Model

- `RateItem` — category (`MATERIAL`, `SCRAP`, `BOP`, `MACHINE`, `PROCESS`, `PACKING`, `FREIGHT`,
  `COMMERCIAL`), code, name, unit (`PER_KG`, `PER_HOUR`, `PER_PIECE`, `PERCENT`, `RUPEES`, `COUNT`,
  `DAYS`), attributes (grade, family, form, aliases, default scrap items, in-house flag, zone …).
- `RateVersion` — `(item, value, effectiveFrom, note, createdBy, createdAt, voidedAt, voidedBy,
  voidReason)`. Unique per item and date among non-voided versions (partial unique index).
  Never updated in place; corrections void a version and add another.
- **Resolution:** `rateAt(item, date)` = the non-voided version with the latest
  `effectiveFrom ≤ date`; none → missing (blocking).
- **"Today"** is always the Asia/Kolkata calendar date (servers run in UTC).

### 4.2 The invariant that protects traceability

> No new or voided version may change the rate resolved for any frozen quote
> (submitted, approved or sent).

So a version may start in the past (with a mandatory reason) when no frozen quote that uses the
item has a basis date in the affected window `[effectiveFrom, next version)`. A version may be
voided while only drafts reference it; those drafts see the re-price prompt. This allows loading
rate history from the ERP, fixing a same-day typo, and recording a mill circular that arrives
late — without ever changing a quote that has left the estimator (A-10). Changes of more than 20 %
against the previous version need explicit confirmation (typo guard).

### 4.3 Basis date and policy items

- Each quote has one basis date, default today, allowed in `[RFQ received − 30 days, today]` (A-25).
  Changing it re-resolves every cost rate and shows the per-tier price change before applying.
- Policy values — approval threshold, margin floor — are resolved at **submit** date; GST at the
  **document** date (preview: today; sent: frozen). Cost rates — material, scrap, BOP, machines,
  processes, packing, freight, overhead, rejection default, ICC, margin ladder — at the basis date.

### 4.4 Freezing a quote

On submit the server re-resolves every rate at the basis date; if any differs from the version the
draft holds, submit is refused with a diff ("EN8 ₹72.50 → ₹75.00 since you priced") and a one-click
re-price. Then it appends a `QuoteSnapshot` (seq 1, 2 … — a return and resubmit adds a new one,
nothing is overwritten): inputs rounded to their column scales, every rate (id, value, effective
date), per-input provenance, every computed line, `engineVersion`, serialized as canonical JSON
(keys sorted recursively, decimals as fixed-scale strings, dates `YYYY-MM-DD`) and stored as **text**
with the SHA-256 of exactly those bytes (jsonb would reorder keys). The quote page and PDF render
from the snapshot, never by re-running a newer engine; the PDF footer prints number, revision, basis
date and the first 8 hex of the hash. Approve and return post the snapshot id the approver viewed
and are refused if it is no longer current.

Every status transition is a compare-and-set (`updateMany where {id, status: from, lockVersion}` →
exactly one row, else "changed — reload"), updating `Rfq` and `Quote` in the same transaction with
the audit row. `AuditEvent` and `QuoteSnapshot` are append-only (DB triggers); `RateVersion` rows may
only gain void fields. Inputs are rounded to their column scale (minutes 3 dp, weights 3 dp, money 2
dp) by the shared zod schemas before any computation, on client and server alike, so a stored quote
recomputes exactly.

### 4.5 Depth

Bulk update (paste `code,value` rows with one effective date → dry-run diff → apply in one
transaction); change-impact preview (which drafts and valid sent quotes would move, per tier);
RM-adjusted past prices (§5.5).

---

## 5. AI intake (RFQ extraction) — and what happens when it is wrong

### 5.1 Sources

- **Email** — `.eml` dropped in the browser is parsed client-side (postal-mime); each attachment
  becomes its own upload (one request per file, 4 MB cap each, A-19). Forwarded mails are unwrapped
  to find the original sender and date. Pasted text and `.txt` also work.
- **Excel part list** — parsed deterministically: header row detection, synonym mapping
  (`Part No / Part Number / Item Code`, `Annual Qty / EAU / Volume` …), cell addresses kept
  (`Sheet1!E4`). Unrecognized headers can be mapped by the estimator; the LLM is not needed.
- **Drawing PDF** — text items are read with positions; only the **title-block region**
  (bottom-right per ISO 7200) is sent to the LLM. If nothing is found there, the full page is sent
  and the source is flagged "full page sent".
- **Drawing image** (PNG/JPG) — vision model in JSON mode (`qwen/qwen3.8-27b`, preview).
- **Scanned PDF without text** — marked "no readable text"; the estimator types the values.
- **Process hints** (e.g. "INDUCTION HARDEN", "THREAD ROLL") come from a local keyword dictionary
  over the drawing notes — no LLM.

### 5.2 Extraction

Groq `openai/gpt-oss-120b`, strict JSON-schema output, temperature 0, reasoning effort low, capped
completion tokens. The prompt treats the document as data, returns `null` when absent, and for every
field the verbatim evidence and line number. The output is validated with zod. Every request is
logged on its `IntakeSource`: model, characters sent, SHA-256 of the payload, duration — never the
prompt or response bodies.

- **One request per source** (`POST /api/intake/[session]/sources/[source]/extract`, Node runtime,
  `maxDuration = 60`); the browser runs two at a time and shows per-source progress; merging is a
  separate short request. Budget per source 45 s: 20 s per attempt, `retry-after` honoured on 429,
  fallback at once if the wait would exceed the budget. A source stuck in progress beyond
  `maxDuration + 10 s` shows as failed with "Retry AI"; a re-run replaces that source's fields in one
  transaction.
- **Images**: the browser crops the title-block region (bottom-right by default, adjustable) at
  native resolution, caps the long edge at 2,000 px and uploads a JPEG; the vision model only
  *transcribes* the crop to lines; the same strict-schema extractor and grounding check then run on
  that transcription (still at most Medium confidence). Every source thus takes one code path.
- **Cache**: results are keyed by `sha256(promptVersion + model + sentText)`; a repeat run of the same
  sample pack is labelled "cached result from 10:42 · Re-run" — never presented as a fresh call.
- Model IDs come from env (`GROQ_TEXT_MODEL`, `GROQ_VISION_MODEL`); Groq retires preview models at
  short notice.

### 5.3 Normalization, plausibility and confidence (deterministic)

- Normalization: Indian digit grouping (`1,80,000`), `1.8 lakh` / `1.8 L` / `180k`, per-month
  quantities (`15,000 nos/month` → 1,80,000/yr, flagged), units (`610 g` → 0.61 kg), dates
  (`12-Nov-26`, `12th November 2026`, DD/MM/YYYY when ambiguous, A-12 — flagged when both parts ≤ 12),
  material grades via master aliases (`EN-8`, `080M40` → EN8), customer by sender domain.
- Plausibility: weight 0.01–500 kg, net ≤ gross, volume 100–50,00,000 per year, due date after
  received date and within 120 days.
- **Confidence never comes from the model** (`src/domain/intake/confidence.ts`):
  - *High* — evidence found verbatim, trivial normalization, plausible, matches the master where one
    applies (customer, grade).
  - *Medium* — grounded but interpreted (unit conversion, per-month × 12, alias, ambiguous date,
    vision-only read, rule-based fallback).
  - *Low* — not found in source, implausible, or in conflict.
  The reason is shown in words ("15,000/month × 12", "could be 04 Mar or 03 Apr").

### 5.4 Review: decide by uncertainty

- Excel columns are confirmed **once per column** ("Annual Qty (col E) → Annual volume: 1,80,000 ·
  24,000 · 60,000"); each value is logged with its cell.
- Per part, values where ≥ 2 sources agree and grounding passed may be accepted together
  ("Accept 4 matching: drawing no, rev, material, gross wt"). Everything else — Medium, Low,
  conflicts, single-source AI reads — is decided one at a time. There is no global "accept all".
- Ungrounded values are **not pre-filled**: the input stays empty with "AI read 0.65 — not found in
  source · Use".
- Conflicts are an inline choice ("◉ 0.61 kg · Excel E4 ○ 0.65 kg · Drawing ○ Other").
- Two panes at ≥ 1280 px: decision list (left) and a source viewer that follows the focused row
  (email lines with the evidence highlighted, sheet grid with the cell outlined, title-block text or
  image). Keyboard: ↑/↓ move, Enter accepts and moves on, F2 edits, Esc cancels.
- `decidedVia` (`SINGLE` / `COLUMN` / `AGREED` / `EDITED`) is recorded; the approver sees one line:
  "All 47 values accepted by Rohan — 31 by column, 9 agreed, 5 single, 2 edited". Bulk actions can be
  undone for 10 seconds.
- The RFQ is created when the required values are decided (customer, due date, ≥ 1 part with
  description and annual volume). Undecided values carry into the part tab ("3 to review") and
  block submit, not costing.

### 5.5 Similar past parts and routing suggestions

Deterministic, explainable retrieval — every suggestion is a real past quote.

- Candidate gate: same input form (`BAR` / `FORGING`) **and** (name similarity ≥ 0.5 **or** same
  shape family). Shape families from keywords: spindle/axle/shaft/pin → shaft; blank/hub/flange/
  ring/gear/disc → disc; arm/lever/yoke/bracket/link → arm; housing/body/cover → housing.
- Score `0.35·name + 0.20·family + 0.15·material + 0.15·weight + 0.10·process + 0.05·recency`
  (name: trigram Dice; material: grade 1, family 0.6; weight: `1 − |Δw|/max`; process: overlap with
  drawing hints; recency: 1 within 24 months → 0 at 48). Threshold 0.55; top 3 shown with the score
  breakdown and source ("from Q/25-26/0412 Front wheel spindle · EN8 · 0.58 kg · Company B · won
  Mar 2025 · match 82 %") (A-26).
- Applying a suggestion copies its operations as **suggested** (violet rule) until confirmed;
  editing a cycle time confirms that op; "Confirm routing" confirms the rest. Copied cycle times are
  flagged when the source part's weight differs by > 20 %. Legacy operation names map to current
  work centres through aliases; unmapped ones arrive unbound and must be bound before confirming.
  A process named on the drawing but missing from the routing shows as a ghost row ("Drawing:
  induction harden — not in routing · Add").
- **RM-adjusted past price**: `past price + (RM rate now − RM rate then) × past gross` (scrap
  adjusted likewise) from the rate history, marked "estimated" when weights or material are missing.

### 5.6 Failure modes

| Situation | Behaviour |
|---|---|
| No key, Groq down, 25 s timeout, 429 | 2 retries with back-off, then rule-based extractor; banner "AI unavailable — rule-based extraction"; values at most Medium |
| Invalid / non-schema JSON | strict mode prevents it; zod re-validates; failure → rule fallback for that source |
| Hallucinated value | grounding fails → Low, not pre-filled |
| Sources disagree | conflict, never auto-resolved |
| Unknown grade / customer | kept as text, flagged; costing blocked until mapped |
| Prompt injection in an email | output is schema-validated data; extraction cannot trigger actions; cost maths never uses AI |
| Customer NDA forbids AI (`Customer.aiAllowed = false`) | rule-based / manual only, banner "AI disabled under this customer's NDA" |

### 5.7 Data protection (NDA)

Groq Services Agreement §4.2: Groq "is not permitted to use Inputs or Outputs for training or
fine-tuning" unless instructed. Groq does not retain inference data by default but may log inputs
and outputs for up to 30 days for reliability and abuse monitoring unless **Zero Data Retention** is
enabled — production must enable ZDR (it only disables batch and fine-tuning, unused here). Only
the title-block text and email body leave the system, never drawing files when text is readable.
Files are served only to signed-in named users; every view or download is logged.

---

## 6. Data model (Prisma, PostgreSQL)

```
User · Session(sha256 id) · LoginAttempt
Customer(code, name, segment, city, emailDomain, paymentTerms, marginBasis, aiAllowed,
         freightItem, packingItem)
Rfq(number, customer, customerRef, subject, receivedAt, dueDate, owner, status, closeReason,
    closeNote, returned flag via latest quote)
RfqPart(lineNo, partNo, description, drawingNo/Rev, materialText, materialItem, gross/forged/net kg,
        annualVolume, heatTreatment, surfaceTreatment, processHints[], gstClass, hsnCode)
RateItem(category, code, name, unit, attributes) · RateVersion(value, effectiveFrom, note, void*)
Quote(rfq, revision, number, status, basisDate, validityDays, marginBasis, policy version ids,
      approvalValue, requiresApproval, snapshotJson, snapshotHash, engineVersion, lockVersion,
      submitted/decided/sent by+at, decisionNote, returnedParts[])
QuoteLine(part, weights, scale%, rate version ids, rejection%, batchesPerYear, tooling*,
          routingConfirmed, costingStartedAt, activeSeconds, lastActivityAt)
QuoteOperation(seq, name, kind, rateVersion, cycle, setup, weightBasis, qty, suggestedFrom, confirmed)
QuoteTier(sortOrder, volume, marginPct, isBase)
IntakeSession · IntakeSource(kind, file, status, mode, model, sentChars, sentSha256, text, meta)
ExtractedField(partKey, fieldKey, proposedValue, candidates, confidence, reason, conflict, status,
               finalValue, decidedVia, decidedBy/At)
FieldProvenance(entity, fieldKey, value, source, locator, evidence, confidence, decidedVia, by/at)
StoredFile(bytea, sha256, kind) · FileAccess
PastQuote(source, refNo, date, customer, part, material, weights, volume, unitPrice, outcome,
          routingText, routingOps, searchText — GIN trigram) · ImportBatch(file sha256, counts, issues)
AuditEvent · OutboxMessage(mock email + stored PDF) · Counter
```

Money `numeric(14,2)`; rates `numeric(14,4)`; weights `numeric(10,3)`; minutes `numeric(8,2)`;
percentages `numeric(6,3)`. Decimals cross the server/client boundary as strings. File bytes are
omitted from every query by default (Prisma global omit).

---

## 7. Statuses

RFQ: `ESTIMATING → IN_APPROVAL → APPROVED → SENT → WON`; `LOST(reason)` from any open state;
`REGRETTED(reason)` (we declined) from `ESTIMATING`; `IN_APPROVAL → ESTIMATING` when returned
(shown as "Estimating · returned" with the comment on the tagged parts); `SENT → ESTIMATING`
starts revision R+1. Rule-approved quotes go `ESTIMATING → APPROVED` directly. Close reasons:
price, lead time, technical, **late reply (missed due date)** — pre-selected when past due —,
customer cancelled, incumbent retained, capacity, other (A-27).

Quote: `DRAFT → IN_APPROVAL → APPROVED → SENT`, `IN_APPROVAL → DRAFT` (returned),
`SENT → SUPERSEDED` when a later revision is sent. Only `DRAFT` is editable. Transitions are a
pure, table-tested function.

---

## 8. Screens and interaction

Desktop-first (A-18); every screen works at 360 px without page-level horizontal scroll (tested).
The sidebar is a 56 px icon rail from 1024 to 1535 px and full width from 1536 px.

1. **Sign in** — email + password; demo panel lists accounts with one-click sign-in (demo mode).
2. **RFQ register** (`/rfqs`) — views: *Mine* (estimator default: open, due soonest first),
   *Awaiting review* (intakes), *Awaiting approval*, *Ready to send* (sales head default), *Open*,
   *Closed*. Toolbar chips double as counts and filters ("Overdue 2 · Due ≤ 2 wd 5 · Returned 1").
   Sales head sees one line: "Avg turnaround 30 d: 5.2 wd · target 4 · win rate 38 %". 44 px rows;
   colour only in the Due column (amber ≤ 2 working days, red overdue). Annual value "—" until
   costed. Below 640 px: three-line cards.
3. **Intake** (`/intake/new`, `/intake/[id]`) — drop zone (an `.eml` brings its attachments) and
   paste box; sample packs and "Simulate incoming RFQ" for demos; then the two-pane review (§5.4).
4. **RFQ workspace** (`/rfqs/[id]` + `/rfqs/[id]/parts/[partId]`) — persistent header: number,
   customer, due (working days), owner, status, "Rates as of 03 Nov 2026 · all current" (or "3 newer
   rates · Re-price"), margin basis, primary action. Tabs: Overview · one tab per part with its review
   count · Files · Activity. Overview holds the part × volume price matrix, approval value against
   ₹25,00,000 printed in full, and Submit.
5. **Part costing** (a part tab) — left column: part header with provenance; material + weights in
   one row (grade combobox with ₹/kg caption, gross, forged, net, yield as text); routing grid
   (spreadsheet keys; blank last row adds an op; empty state shows top-3 suggestions); BOP; commercials
   as a two-column form. Right panel (`clamp(424px, 26vw, 480px)`): pinned header = the volume
   inputs (base tier tinted and read-only, "+ volume" ghost column); scrollable build-up (24 px rows,
   subtotals 600 weight); pinned footer = margin % inputs per tier ("Apply to all parts"), profit,
   **unit price 16/24 600**, ₹/kg with "median ₹244 · 5 similar · +7 %" (opens the similar-quotes
   drawer), annual value, status line (issues button, quote approval value, "Saved 10:42",
   "Next part →"). Phones: inputs stacked, routing ops as two-line items, sticky bottom price bar.
6. **Quote** (`/quotes/[id]`) — left: the customer document (same content as the PDF); right rail
   (360 px) while in approval: per-part lowest margin, ₹/kg vs similar, warnings, approval value in
   full, rate basis and provenance summary; Approve / Return (comment required, parts can be tagged).
   After approval the primary button becomes "Send to customer" (composer dialog). Phones: single
   column, sticky action bar.
7. **Rate masters** (`/rates`) — category tabs; "as of" date; table with value as of the date,
   effective from, next scheduled change, versions, quotes using it; drawer with the version
   timeline, add / void (sales head), bulk update.
8. **Past quotes** (`/past-quotes`) — search + filters; similar-part mode; ₹/pc, ₹/kg, RM-adjusted
   price; drawer with routing.
9. **Import** (`/imports`) — upload → column mapping + row report → import → batch history.

Shared field-state component (intake and costing): *Suggested* (2 px violet rule + caption
"Drawing title block · Medium", inline ✓), *Accepted* (ink-3 caption "Excel E4", details on
hover/focus), *Edited* ("Edited · AI read 0.65"), *Manual* (no caption). Violet means "suggested,
awaiting you" and nothing else. Rate versions show only by exception (newer version: neutral chip;
change inside validity: amber; missing: red error). Read-only views render values as text in the
same positions, never disabled inputs. Disabled primary buttons open a popover listing the reasons
with links. Every data view has loading (skeleton), empty (one sentence + next action) and error
(message + retry) states.

---

## 9. Visual design

Calm, precise, quiet — an engineering ledger, not a dashboard.

- **Type:** IBM Plex Sans (UI) and Plex Mono (identifiers), weights 400/500/600. UI 14/20, tables
  13/20, captions 12/16 minimum, page title 20/28 600, section title 15/22 600, subtotals 13 600,
  unit price 16/24 600. Plex figures are tabular by default; numbers right-aligned.
- **Colour (cool neutrals, contrast on white):** canvas `#F6F7F9`, surface `#FFFFFF`, divider
  `#E3E6EA` (dividers only), control border `#8A939F` (3.1:1, WCAG 1.4.11), ink `#15191F` /
  `#4A5260` / `#646C7A`, accent `#2B5B8A` (7.1:1) with tint `#EEF3F8` (selected rows, base-volume
  column), focus 2 px accent outline, suggested-violet `#5B45B0` (rule + caption only), warning
  `#8A5A00`, error/overdue `#B42318`, success `#2E7D4F`. Red means "act now" only; lost is a grey dot;
  negatives use the U+2212 minus sign in ink.
- **Density:** register rows 44 px, input grids 32 px, read-only breakup 24 px; `table-layout:
  fixed` in the costing panel so recalculation never shifts columns. `pointer: coarse` raises
  controls to 44 px.
- **Formatting:** Indian grouping (`₹1,23,456.00`), lakh/crore summaries (`₹2.17 Cr`), threshold
  comparisons printed in full (`₹24,66,000.00 ≤ ₹25,00,000.00`), dates `03 Nov 2026`.

---

## 10. Architecture

- **Next.js 16 (App Router) monolith on Vercel + Neon Postgres.** One deployable; server components
  for reads, server actions for mutations, route handlers for uploads, file downloads, intake and
  PDFs. Six estimators and a sales head do not need services or queues; the 7-week budget favours
  one codebase with end-to-end types.
- **Layers:** `src/domain/*` pure logic (costing, rates, approval, statuses, calendar, numbering,
  intake normalization/confidence/merge, similarity), unit tested, runs in browser and server ·
  `src/server/*` server-only (Prisma, auth, guards, services, Groq client, PDF, audit) ·
  `src/app/*` routes · `src/components/ui/*` design system · `src/components/<feature>/*`.
- **Auth:** own sessions — random 256-bit token in an HttpOnly, SameSite=Lax, Secure cookie; only
  its SHA-256 stored; 12 h expiry; scrypt hashes; throttling (5 failures / 15 min per email,
  30 per IP). `proxy.ts` redirects anonymous requests; every page, action and route re-checks the
  session and permission.
- **Session details:** cookie `__Host-qd_session` in production (`qd_session` on http localhost),
  no Max-Age (dies with the browser) plus a server-side expiry that slides, written at most every
  10 minutes; `getCurrentUser` is memoised per request. Logout is a POST action.
- **Actions and services:** every server action is declared through `defineAction({ input, permission
  }, handler)` (zod + permission + `ActionResult`); a test imports every `"use server"` module and
  asserts each export is wrapped. Services take the current user and check `can()` themselves, so page
  reads are guarded too. Non-GET route handlers check `Origin` against `APP_ORIGIN`.
- **Validation:** zod at every boundary (actions, routes, AI output, Excel rows).
- **Business time:** all business dates are Asia/Kolkata calendar dates carried as `YYYY-MM-DD`
  strings (`@db.Date` in Postgres); timestamps are formatted with an explicit time zone. Tests run with
  `TZ=UTC` and include IST-midnight boundaries.
- **Numbers:** `RFQ-YYMM` sequences are allocated by one atomic upsert
  (`INSERT … ON CONFLICT DO UPDATE SET value = value + 1 RETURNING value`) inside the create
  transaction; the seed moves each counter past the numbers it used.
- **Uploads:** one file per request to a route handler; `content-length` checked (≤ 4 MB) before the
  body is read; type from a whitelist checked against magic bytes; `.xlsx` must contain
  `xl/workbook.xml`, ≤ 50 MB uncompressed per the zip directory, ≤ 5,000 rows.
- **Serving files:** whitelisted `Content-Type` (never sniffed), RFC 5987 `filename*`, inline only for
  PDF/PNG/JPEG; file routes send `frame-ancestors 'self'` instead of the global `DENY` so drawings can
  be previewed in-app. Links to files are plain `<a download>` (no prefetch writing false access-log
  rows). Evidence highlighting splits text into React nodes — never `dangerouslySetInnerHTML`.
- **Headers:** `X-Frame-Options: DENY`, `nosniff`, strict referrer policy, permissions policy.
- **PDF:** `@react-pdf/renderer` in a Node route, fonts registered at module scope from a static
  `process.cwd()` path and traced with `outputFileTracingIncludes`; IBM Plex has the ₹ glyph and
  tabular figures; rendered only from the frozen snapshot (drafts: live preview, watermarked DRAFT).
- **Hosting:** Vercel functions next to the Neon database (planned `sin1` / Singapore; deployed `cle1` / us-east-2 where the database was created); `DATABASE_URL` = Neon pooled
  host (runtime), `DIRECT_URL` = direct host (migrations only). Migrations run by hand or from CI —
  never in the Vercel build. `pg_trgm` is enabled by the first migration; search uses `similarity()`
  in `WHERE`/`ORDER BY` (no session `SET`, which leaks across pooled connections).
- **Demo safety:** demo panel and reset only when `DEMO_MODE=true`; quotas counted from existing rows
  (AI extractions per user per hour, upload bytes per user per day, total storage cap); nightly reset
  by Vercel Cron (`/api/cron/reset-demo`, bearer `CRON_SECRET`) so seeded due dates stay current;
  manual reset by the sales head behind a typed confirmation.
- **Secrets:** environment only; `.env.example` lists names.
- **CI:** GitHub Actions with a Postgres service — typecheck, lint, unit + integration tests, the
  rule-based extraction eval (Groq mocked through `GROQ_BASE_URL`).

---

## 11. Seed and sample data

Deterministic (seeded PRNG); dates relative to the day the seed runs.

- Users: 6 estimators (the brief's team) + 1 sales head; fictional names, `@companya.example`.
- Customers: Company B (two-wheelers), C (tractors), D (drivetrains) from the brief, plus E–H
  (A-14); one customer has `aiAllowed = false`.
- Rate masters with 2023–2026 history (needed for RM-adjusted comparisons) and one scheduled
  future change; illustrative 2026 Pune values (A-9): EN8 ₹72.50, 40Cr4 ₹84, 20MnCr5 ₹90/kg;
  turnings ₹26, flash ₹34/kg; saw ₹350, CNC ₹850 / ₹950, VMC ₹1,250, HMC ₹1,450, hobbing ₹1,100,
  grinding ₹750/h; forging ₹36/kg; normalising ₹10, isothermal annealing ₹16, H&T ₹19,
  carburising ₹48, shot blast ₹4/kg; IH ₹3.20, MPI ₹4.50/pc.
- RFQs: the three sample RFQs (014 estimating, 019 awaiting approval, 023 created from an AI intake)
  plus ~30 more across every status with timing history; two intakes awaiting review.
- Past quotes: `sample-data/past-quotes-2023-2026.xlsx`, 1,400 rows, imported by the seed through the
  same import service as the UI (idempotent on file hash + refNo/partNo); a 60-row file with
  deliberate errors.
- Sample RFQ packs (forwarded `.eml` with attachments, Excel, drawing PDF/PNG) generated by
  `scripts/generate-sample-data.ts`.

---

## 12. Assumptions

- **A-1** Approval value = Σ parts (base-tier price × RFQ annual volume) + one-time tooling charged
  separately; "above ₹25 lakh" means strictly greater.
- **A-2** Quotes at or below the threshold are approved by rule on submit; the sales head still sends.
- **A-3** Profit is a markup on manufacturing cost (material, BOP, conversion, rejection, overhead,
  ICC); packing, freight and tooling are recovered at cost. Customers can require profit on in-house
  conversion only.
- **A-4** Overhead applies to in-house conversion (machining, setup, in-house processes); rejection
  to material + BOP + conversion; ICC to material + BOP.
- **A-5** Freight is per kg of finished weight to the customer's freight zone (prices FOR destination).
- **A-6** Setup is amortized over `annual volume / batches per year` (default 12). Default tiers ⅔×,
  1×, 4⁄3×, rounded to 2 significant figures.
- **A-7** Tooling is either a separate one-time charge or amortized over N years of volume.
- **A-8** GST per part class: 18 % (auto parts) or 5 % (specified tractor parts) by default from the
  customer segment; the HSN code and rate must be confirmed by the client's tax team.
- **A-9** All seeded rates, prices and past quotes are illustrative.
- **A-10** Rate versions may be back-dated only when no frozen quote would change (§4.2).
- **A-11** Working days exclude Sundays; no holiday calendar.
- **A-12** Ambiguous dates are read as DD/MM/YYYY and flagged.
- **A-13** Rate masters are maintained by the sales head; costings by estimators only.
- **A-14** Customers E–H and every person's name are invented.
- **A-15** Net/forged weights, secondary operations and setup times of the sample parts are assumed;
  the sample cycle time and hour rate are used for each part's main operation. The 40Cr4 lift arm is
  forged in-house from bar.
- **A-16** The legacy Excel layout of the past-quote register is assumed.
- **A-17** RFQ numbers follow the sample `RFQ-YYMM-NNN`, sequence resetting monthly.
- **A-18** Desktop is the primary device; phones support reading, approving and light edits.
- **A-19** Hosted demo accepts files up to 4 MB each (Vercel request limit).
- **A-20** "Send" writes to an outbox and stores the exact PDF; no email leaves the system.
- **A-21** One quote document covers all parts of an RFQ; quotes are valid for 30 days.
- **A-22** The customer is identified from the sender's email domain (after unwrapping forwards).
- **A-23** Margin ladder: base 12 %, +2 pp below base, −1.5 pp above; floor 8 %.
- **A-24** Validation limits: margin −20…60 %, rejection 0–10 %, yield warning < 40 %, cycle-time
  warning > 120 min, ₹/kg warning beyond ±25 % of the similar-quote median.
- **A-25** Basis date may be set between 30 days before the RFQ was received and today.
- **A-26** Routing-suggestion weights and the 0.55 threshold are starting values to tune with use.
- **A-27** Lost/regretted reason list.

---

## 13. Testing

- **Unit (Vitest):** costing engine — golden fixtures for all three sample parts × 3 volumes, every
  line to the paisa (A: bar-turned, B: forged + amortized tooling + margin ladder, C: gear blank with
  per-kg process on NET, CONVERSION margin basis and SEPARATE tooling); property tests (fast-check):
  printed lines sum exactly to the subtotals and unit price, setup and amortized tooling per piece
  never rise with volume, round → save → reload → recompute is identical; validation scopes; default
  tiers (250, 600, 1,000, 1,200, 1,500); approval boundary (₹25,00,000.00 by rule, ₹25,00,000.01 to
  the sales head, tiers below the RFQ volume still route); rate resolution, voiding and the
  back-dating invariant; canonical snapshot hashing; status transitions; working days and
  IST-midnight boundaries (18:29Z / 18:31Z on the 30th); numbering; intake normalization,
  confidence, grounding, merge; Excel mapping and row validation; similarity gating and scoring;
  Groq client failure paths (mocked fetch); permissions, and that every server action is wrapped.
- **Integration (real Postgres):** submit fixture A at basis D; add EN8 ₹78.00 from D+7; the frozen
  quote re-hashes identically, a draft at D+7 re-prices and shows the per-tier difference, D+6 resolves
  ₹72.50 and D+7 ₹78.00, a back-date that would move the frozen quote is refused, voiding a version a
  frozen quote uses is refused. RFQ counter: 20 parallel creates over a 10-connection pool get 20
  distinct consecutive numbers. Seed smoke: every seeded frozen quote re-hashes; the next Create RFQ
  succeeds.
- **Eval:** `npm run eval:intake` over 12–15 synthetic RFQ packs with expected values — per-field
  accuracy and how many wrong values were flagged, for the LLM and the rule-based path.
- **End-to-end (Playwright):** estimator costs and submits → sales head approves and sends → the
  downloaded PDF's text contains "₹" and the expected unit price; every route at 360 × 740 has no
  page-level horizontal overflow.

---

## 14. Cut, next, limits

- Plant-head routing check (would sit before submit) and MD sign-off after a win — not built.
- Real email ingestion (IMAP / Microsoft Graph) instead of upload; ERP rate feed (out of scope).
- OCR for scanned drawings; CAD analysis (out of scope).
- Customer-specific costing norms beyond margin basis (overhead caps, fixed rejection).
- Per-RFQ access lists for NDA-restricted customers (today: all named users + access log).
- Object storage with encryption instead of Postgres bytea; virus scanning of uploads.
- Holiday calendar; tonnage-band material pricing; maker–checker for rate changes.
