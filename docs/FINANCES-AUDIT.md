# Finances — Audit & Feature-Gap Analysis

_Audited 2026-07-03 against `main` (4a7c9a2). Feature decisions in §4/§5 were
reviewed with the head coach on the same date._

This document is an analysis artifact, not a spec. It records (1) what the
Finances area does today, (2) defects and risks found in an audit of the
implementation, and (3) a coach-centered feature-gap check against what
comparable team-management products (TeamSnap, SportsEngine HQ, Crossbar,
Jersey Watch, LeagueApps, Snap! Spend) offer. Each gap carries an explicit
**Approved** / **Not planned** decision so follow-up PRs can cite this doc.

---

## 1. Scope and architecture constraints

Finances lives entirely client-side, like the rest of the app:

- All financial data is the `finances` object on the single team doc
  (`artifacts/{appId}/public/data/teams/{teamId}`); the 1 MB doc cap bounds
  ledger growth and rules out attachments. Types: `src/types.ts:538-670`
  (`TeamFinances` at `types.ts:626`).
- Firebase Spark plan: no Cloud Functions, no Cloud Storage, no server email.
  The one serverless escape hatch is a Vercel function (`api/gc-schedule.js`
  is the existing precedent).
- Only two authenticated roles exist (`head` / `assistant`). Parents and
  players are not users; they interact through anonymous share-link portals
  backed by the sanitized `teamPublic/{teamId}` mirror.

**Core files**

| File                                                             | Role                                           |
| ---------------------------------------------------------------- | ---------------------------------------------- |
| `src/screens/FinancesTab.tsx` (~2,470 lines)                     | Entire Finances UI                             |
| `src/utils/finances.ts` (~810 lines)                             | Pure money math (unit-tested)                  |
| `src/components/financeViz.tsx`                                  | Hero, cash-flow, donut, year-comparison charts |
| `src/finances/feeSheetPdf.ts`                                    | Parent-facing fee-schedule PDF (lazy jspdf)    |
| `src/utils/finances.test.ts`, `src/screens/FinancesTab.test.tsx` | ~44 UI cases + math suite                      |

## 2. What Finances does today (current-state inventory)

The feature is substantially complete for a manual, single-treasurer ledger:

- **Collections** — per-player club fee, optional deposit slice, due dates,
  partial payments, paid-in-full shortcut, full fee waivers (`feeExemptIds`),
  fundraising credits (team-wide even split or credited to a specific child),
  carryover-surplus discount with apply / dismiss / reverse, copy-to-clipboard
  dues reminder (`owesReminderText`, `finances.ts:622`).
- **Ledger** — dated in/out entries with running balance, month group headers,
  sortable columns, inline editing, budget-category tagging on expenses,
  fundraising flag + per-child credit on income, CSV export (`ledgerCsv`,
  `finances.ts:654`).
- **Charts** — monthly cash-flow bars + balance line, spending-by-category
  donut with an "Unplanned" bucket, year-over-year comparison from
  `pastSeasons`.
- **Budget Planner (next season)** — preset chips, flat or qty × unit items,
  per-item sales-tax toggle, seed-from-this-season estimate, budget-vs-actual
  meters, fee buffer rounding, planned-player-count override, suggested fee →
  "set as next season's fee", parent fee-sheet PDF.
- **Sponsorships** — current-season (posts income) vs next-season pledges,
  each with its own "reduces team fees" switch.
- **Season rollover** (`rollFinancesForNewSeason`, `finances.ts:699`) — fires
  on the Spring→Fall advance: closing balance carries over, collections and
  waivers reset, planned fee/deposit promote, pledges convert to income, the
  year archives to `pastSeasons`; tryout deposits seed the new season's
  payments.
- **Integration** — HomeTab "Team Fees" action cards (`teamFeesStatus`,
  consumed at `HomeTab.tsx:1594`), offer letters quote next-season fee +
  deposit + the coach's Venmo link (`types.ts:506-507`).

What it deliberately does **not** do: no payment processor (Venmo is a text
link only), no server-sent notifications (clipboard/mailto drafts only), no
parent-facing view, USD only.

## 3. Audit findings

| #   | Severity | Area         | Finding                                                                   |
| --- | -------- | ------------ | ------------------------------------------------------------------------- |
| 1   | **High** | Security     | `finances` has no server-side protection — any member can read/write it   |
| 2   | **High** | Data loss    | Whole-object last-write-wins on every finance mutation                    |
| 3   | Medium   | Correctness  | Floating-point money aggregation without cent rounding                    |
| 4   | Medium   | Correctness  | Blank/invalid dates: charts and totals disagree; ledger ordering distorts |
| 5   | Medium   | Robustness   | Amount parsing mishandles comma-decimal input; no refund path             |
| 6   | Low      | Design       | Unpaid dues silently destroyed on Fall rollover                           |
| 7   | Low      | Auditability | No attribution (`recordedBy`) on any money entry                          |
| 8   | Low      | Performance  | Unbounded ledger render; O(payments × players) name lookup                |

### 3.1 `finances` is not protected server-side — High

The Finances tab is "head-coach-only" in the UI: the nav button is hidden for
assistants (`App.tsx:673-674`), the route redirects them (`App.tsx:784-786`),
and the tab resets to home (`useMainShellRouting.ts:110-114`). But the rules
layer grants every team member full read **and update** on the team doc with
field-level guards only for `ownerId`/`members` (`firestore.rules:135-138`).
Nothing constrains the `finances` key, so an assistant — or any tampered
client authenticated as a member — can read all payment history and rewrite
fees, payments, and the ledger directly through the SDK. The head-only claim
is cosmetic.

**Fix direction:** add a rules guard so writes touching `finances` require
`isCurrentOwner()` (mirroring the existing `ownerId` diff-key pattern at
`firestore.rules:65-67`), with a rules test in `firestore-tests/`. Note the
rules already demonstrate the exact `changedKeys().hasAny([...])` technique
needed.

### 3.2 Last-write-wins concurrency — High

Every mutation spreads the in-memory object and writes it back whole:
`updateTeam({ finances: { ...finances, ...patch } })`
(`FinancesTab.tsx:171-172`). Two writers (head coach on two devices, or head +
assistant given finding 3.1) recording entries near-simultaneously will
silently drop one side's entry — no transaction, no `arrayUnion`, no conflict
detection. Real-world trigger: recording cash payments at the field while a
spouse/treasurer enters checks at home.

**Fix direction:** route append-type mutations (payments, incomes, expenses)
through a Firestore transaction or per-array `arrayUnion`-style merge inside
`persistTeam`, keeping the single-doc model.

### 3.3 Floating-point money math — Medium

Aggregates sum raw floats with no cent rounding: `budgetTotal`
(`finances.ts:63-69`), `financeSummary`'s `collected`/`spent`/`balanceNow`
(`finances.ts:272-338`), and the ledger running balance
(`finances.ts:471-475`). `formatCurrency` rounds for display only, and some
paths do round (`round2` at `finances.ts:310`, the rollover balance at
`finances.ts:752`), so stored and compared values can drift by sub-cent
amounts (`0.1 + 0.2` class errors) and comparisons like `eff - paid > 0`
(`finances.ts:373`) can misclassify a settled family by a fraction of a cent.

**Fix direction:** round at the aggregation boundaries (a `round2` on the
summary fields and running balance) — or store cents as integers, which is a
larger migration and not justified yet.

### 3.4 Blank/invalid dates — Medium

`<input type="date">` can be cleared to `""` when editing a ledger row. An
entry with an empty or malformed date is dropped from the cash-flow chart by
the `/^\d{4}-\d{2}/` filter (`finances.ts:571-573`) while still counting in
`balanceNow` and the tiles — the chart and the totals silently disagree.
Dates sort via `localeCompare` (`finances.ts:469`) with no validation, so a
blank date sorts to the top of the ledger and distorts the running-balance
column from the first row down.

**Fix direction:** refuse to save a ledger edit without a valid date (the
add-transaction form already defaults to today at `FinancesTab.tsx:676`).

### 3.5 Amount parsing and the missing refund path — Medium

`parseAmount` strips only `$`, commas, and whitespace (`FinancesTab.tsx:98-102`),
so comma-decimal input ("1,50") parses as 150. There are no upper bounds on
amounts (only `salesTaxPct` is clamped 0–30, `FinancesTab.tsx:232-239`), and
negative amounts are rejected everywhere (`parseAmount` returns null for
`n <= 0`), which means **refunds have no first-class representation** — a
returned deposit must be faked as an expense, which corrupts the
spending-by-category picture. See §4: refunds are an approved addition.

### 3.6 Unpaid dues destroyed on rollover — Low (by design, undocumented)

`rollFinancesForNewSeason` intentionally excludes `stillOwed` from the
carryover — "unpaid fees die with the year" (`finances.ts:749-750`). Coaches
get no warning and no archive of who still owed at year-end; the
`FinancePastSeason` row keeps only `collected`/`otherIncome`/`spent`/
`closingBalance`. The approved year-end treasurer report (§4) is the natural
place to snapshot outstanding balances before they're wiped.

### 3.7 No attribution — Low

`PaymentEntry`/`IncomeEntry`/`ExpenseEntry` carry no `recordedBy` uid or
created-at timestamp. Combined with 3.1 there is no way to establish who
entered or altered a money record. Cheap to add at write time; becomes more
valuable if finance access ever widens beyond the head coach.

### 3.8 Performance — Low

The full ledger renders every row with no windowing (`FinancesTab.tsx:1444`);
only the cash-flow axis has a cap (36 months, `finances.ts:615`).
`transactionLedger`'s `nameOf` does a linear `players.find` per payment row
(`finances.ts:424-427`). Both are bounded in practice by the season reset;
worth fixing opportunistically, not urgently.

## 4. Coach feature-gap check

Benchmark: what a head coach managing team money gets from TeamSnap,
SportsEngine HQ, Crossbar, Jersey Watch, LeagueApps, and Snap! Spend that this
app doesn't provide. Feasibility is judged against the constraints in §1.
Decisions recorded 2026-07-03.

### Approved

| Feature                             | Why coaches want it                                                                                                                                | Current state                                                                                                                        | Feasibility                                                                                                                                                                                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Refunds**                         | Families drop mid-season; deposits get returned; overpayments happen. Every benchmarked product supports money-back entries.                       | Not representable — negative amounts rejected (`FinancesTab.tsx:100`); refunds must be faked as expenses, corrupting category spend. | Good fit. A `refund` entry type (or signed payment) flowing through `transactionLedger`, `financeSummary`, CSV, and charts. Pure client change + math tests.                                                                                    |
| **Year-end treasurer report (PDF)** | Season-close accountability to parents/club: budget vs actual, income by source, who paid what, closing balance. The current handoff is a raw CSV. | Ledger CSV + on-screen charts only; `pastSeasons` keeps four numbers per year.                                                       | Good fit. Reuse the lazy-jspdf pattern (`src/finances/feeSheetPdf.ts`) over existing `financeSummary`/`budgetActuals`/`yearComparison` outputs. Also the right place to snapshot outstanding balances before rollover wipes them (finding 3.6). |

Plus the two high-severity audit fixes, approved as follow-up work:

- **Firestore rules guard for `finances`** (finding 3.1) — head-coach-only,
  enforced server-side, with rules tests.
- **Concurrency-safe finance writes** (finding 3.2) — transaction/merge-based
  appends so simultaneous entries can't erase each other.

### Considered, not planned

Reviewed with the coach and declined for now; recorded so future requests can
reopen them with context.

| Feature                                                            | Benchmark norm                         | Why it would fit / notes                                                                                       |
| ------------------------------------------------------------------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Payment method + notes on payments                                 | TeamSnap, Crossbar record method       | Trivial schema add (`method?`, `note?` on `PaymentEntry`)                                                      |
| Per-player fee adjustments (sibling discount, partial scholarship) | Common in club invoicing               | Today only full waive via `feeExemptIds`; per-player override map would slot into `effectiveFeeByPlayer`       |
| Installment plans / payment schedules                              | TeamSnap Invoicing, Snap! Spend        | Deposit + final due date exist; a schedule array would extend `teamFeesStatus` and HomeTab cards               |
| Payment receipts (per-payment PDF)                                 | Processor-issued receipts elsewhere    | Same jspdf pattern as the approved treasurer report                                                            |
| Reimbursements (out-of-pocket + owed-back status)                  | Common treasurer workflow              | New entry flag + settle action in the ledger                                                                   |
| Fundraising goals / raise-or-pay                                   | Snap! Raise-style campaigns            | Per-player credit already exists; goals/meters are additive                                                    |
| Parent balance portal ("what do I owe")                            | Table stakes in TeamSnap/Crossbar      | Would follow the anonymous-portal + `teamPublic` mirror pattern; declined — coach prefers direct communication |
| Treasurer access (finance role for a member)                       | Club norm: a team parent handles money | Declined; finances stay head-only — which the approved rules guard then enforces for real                      |
| Online payments (Stripe Payment Links + webhook)                   | The headline competitor feature        | Needs a Vercel function + Stripe account; declined — Venmo/cash workflow is sufficient at this scale           |
| Automated email dues reminders                                     | TeamSnap auto-reminders                | Needs server email (Vercel fn + email API), reversing a deliberate product stance; declined                    |

### Not recommended (poor architectural fit)

Receipt-photo attachments (no Cloud Storage; 1 MB doc cap), bank-feed
reconciliation, late-fee automation, multi-currency, general-ledger
accounting. These outgrow a single-team, single-doc tool; a coach needing
them should export the CSV into real accounting software.

## 5. Roadmap

Approved work, in recommended order (each item is an independent PR). All
four have since shipped:

1. **Rules guard for `finances`** — highest severity, smallest diff
   (`firestore.rules` + `firestore-tests/`). Do first; everything else builds
   on a trustworthy ledger. **Shipped** — the head-gate in `firestore.rules`
   (the `untouched('finances') || isHeadCoach()` clause), with emulator tests
   and a validation-matrix entry in `docs/firebase-rules-rollout.md`.
2. **Concurrency-safe finance writes** — rework `writeFinances`'s
   read-modify-write for the append paths (payments/incomes/expenses).
   **Shipped** — `updateFinances` in `src/utils/financeUpdates.ts`.
3. **Refunds** — entry type + math + UI + tests; fixes finding 3.5's gap.
   **Shipped** — the `refund` payment flag flows through the ledger, summary,
   CSV, and charts in `src/utils/finances.ts`.
4. **Year-end treasurer report PDF** — includes the outstanding-balances
   snapshot that softens finding 3.6. **Shipped** —
   `src/finances/treasurerReportPdf.ts`.

Opportunistic (bundle into whichever PR touches the code first): cent
rounding at aggregation boundaries (3.3), require valid dates on ledger edits
(3.4), comma-decimal parse hardening (3.5), `recordedBy` stamps (3.7). All
shipped — `round2` at the summary/running-balance boundaries and
`parseMoneyInput`'s comma-decimal handling (`src/utils/finances.ts`), the
`isValidIsoDate` gate on ledger edits (`src/screens/FinancesTab.tsx`), and
`recordedBy`/`recordedAt` stamps on money entries (`src/types.ts`). Finding
3.8's mitigations landed too (`LEDGER_RENDER_CAP` + a Map-based name lookup).

Everything in "Considered, not planned" stays out of scope until explicitly
reopened.
