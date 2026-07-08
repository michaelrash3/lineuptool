# Design: youth-baseball finance categories (staged)

_Status: **PR1 + PR2 + PR3 shipped.** PR1 added a non-breaking preset catalog
(quick-pick chips + free-text autocomplete). PR2 adds a structured `category` on
budget items and rolls spending up **by category** (budget-vs-actual per area,
the spending donut). PR3 adds the other half of the books: a separate **revenue**
taxonomy and a **money-in-by-source** rollup. All non-breaking: categories are
optional and inferred from the label when absent, so legacy items and untagged
entries roll up without a migration write._

## The need

The Finances tab and Budget Planner were all free-text: the planner add form was
a single label box (with 4 quick-add chips — Tournaments, Uniforms, Field
rental, Indoor facility), and ledger money-in/out entries were free labels with
no suggestions. A coach setting up a season had to know — and type — every line
item from scratch. The ask: "a lot more categories in Finances, and the Budget
planning should have more options that would typically be associated with a
youth baseball team."

## PR1 — preset catalog (shipped)

A convenience layer only; nothing about the stored shape changed.

- **`src/constants/financeCategories.ts`** — the catalog:
  - `BUDGET_PRESETS`: ~40 `BudgetPreset`s grouped into seven spending areas
    (`BUDGET_PRESET_GROUPS`): Tournaments & games, Facilities & field, Gear &
    equipment, Uniforms & apparel, League & admin, Travel & lodging, Team &
    events. Each preset carries optional hints: `unitNoun` (opens quantity
    mode — count × per-unit), `qtyFromRoster` (seed the count from roster size,
    e.g. a jersey per kid), and `taxable` (default the pre-tax flag).
  - `EXPENSE_LABEL_SUGGESTIONS` (= the preset labels) and
    `INCOME_LABEL_SUGGESTIONS` (sponsorship, car wash, raffle, concessions,
    spirit wear, donations, grants…) — autocomplete for the ledger boxes.
  - `DEPOSIT_QUICK_PICKS` — one-tap next-season deposit amounts.
- **`src/screens/FinancesTab.tsx`** wiring:
  - Budget Planner renders the catalog as grouped, scrollable quick-add chips.
    Tapping one prefills the add form; a `unitNoun` opens quantity mode, a
    `taxable` preset seeds a `+tax` toggle (also editable manually before add).
  - The ledger's money-out / money-in label box gets a `<datalist>` (expense
    catalog vs income catalog); free text still works.
  - The next-season deposit field gets quick-pick chips that commit the amount.

Covered areas (per the product decision): **expenses, income & fundraising, and
deposits & fees.**

Tests: `src/constants/financeCategories.test.ts` (catalog integrity) and new
cases in `src/screens/FinancesTab.test.tsx` (chip prefill + taxable default,
flat preset, ledger datalists, deposit quick-pick).

## PR2 — structured categories (shipped)

Promotes the catalog from suggestions to structure so spending groups and reports
**by category**.

- **`src/constants/financeCategories.ts`** — the taxonomy: `FinanceCategoryId`
  (the seven spending areas + `other`), `FINANCE_CATEGORIES` (id → label, display
  order), `groupToCategory` (preset group → category), `categoryLabel`, and
  `inferCategory(label)` — an exact catalog-label match, then keyword heuristics,
  then `other`.
- **`src/types.ts`** — optional `BudgetItem.category?: FinanceCategoryId`.
- **`src/utils/finances.ts`** — read helpers:
  - `budgetItemCategory(item)` = stored category, else inferred from the label.
  - `expenseCategory(expense, budgetItems)` = the linked item's category, else
    inferred from the expense label.
  - `budgetByCategory(finances)` = planned + actual rolled up per area (canonical
    order, only areas with money).
  - `spendingByCategory(finances)` = donut-ready actual spend per area.
- **`src/screens/FinancesTab.tsx`** — a category `<select>` on the budget add
  form (a preset preselects its area; "Auto" defers to inference) and in the
  inline row editor; a category line under each budget row; a **By category**
  budget-vs-actual rollup panel; and the spending donut now grouped by category
  (its `aria-label` was already "Spending by category").

**Migration is read-side and non-destructive:** `category` is optional; when
absent it's inferred at read time, so legacy items and untagged entries roll up
without ever rewriting the stored doc. A coach who wants a specific area just
picks it; otherwise the inference keeps the rollup meaningful.

~~**Deliberately out of scope:** income/fundraising keeps its existing structure
(the `fundraising` / `sponsor` flags), so categories cover the spend side only.
A future refinement could categorize income too if a by-source income report is
wanted.~~ _That refinement is PR3, below._

## PR3 — revenue taxonomy + by-source income accounting (shipped)

The accounting ask: **two separate lists — a taxonomy for money in and one for
money out** — so a year-end reader sees where every dollar came from and where
every dollar went. Spend (PR2) is untouched; PR3 adds the revenue side.

- **`src/constants/financeCategories.ts`** — the revenue taxonomy, deliberately
  distinct from `FinanceCategoryId`: `RevenueCategoryId` + `REVENUE_CATEGORIES`
  (display order) — Registration & dues, Sponsorships, Fundraisers, Donations,
  Grants, Concessions & snack bar, Merchandise & spirit wear, Tournament
  winnings, Interest income, Other income — plus `revenueCategoryLabel` and
  `inferRevenueCategory(label)` (keyword heuristics mirroring `inferCategory`;
  every `INCOME_LABEL_SUGGESTIONS` entry resolves to a real source).
- **`src/types.ts`** — optional `IncomeEntry.category?: RevenueCategoryId`.
  Club-fee `PaymentEntry` rows stay implicitly "Registration & dues" — no
  per-payment picker; the tracker already knows what they are.
- **`src/utils/finances.ts`** — read helpers, same non-destructive pattern:
  - `incomeCategory(entry)` = stored source, else inferred from the label.
  - `incomeByCategory(finances)` = money in per source (canonical order, only
    sources with money). Family payments post to **dues net of refunds**;
    income entries bucket by their stored-or-inferred source.
- **`src/screens/FinancesTab.tsx`** — a **Revenue source** `<select>` on the
  money-in ledger form ("Source: auto" defers to inference; resets after each
  add) and a **Money in by source** panel in the Cash Flow column beside the
  spending donut — the two accountant lists, in and out, side by side. The
  source is available on every money-in entry regardless of what's on the
  budget, so next season's books start categorized.

Tests: revenue-catalog integrity + `inferRevenueCategory` in
`financeCategories.test.ts`; `incomeCategory` / `incomeByCategory` (dues net of
refunds, stored-vs-inferred, canonical order, empty book) in `finances.test.ts`;
source tagging + picker reset + the by-source panel in `FinancesTab.test.tsx`.
