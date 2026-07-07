# Design: youth-baseball finance categories (staged)

_Status: **PR1 shipped — a non-breaking preset catalog.** The Budget Planner and
ledger now offer a curated set of the line items a travel/rec baseball team
actually budgets, as quick-pick chips and free-text autocomplete. No schema
change: entries still store a free-text `label`. **PR2 (structured categories)
is planned, not built** — see the bottom._

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

## PR2 — structured categories (planned, NOT built)

Promote the catalog from suggestions to structure so spending can be grouped and
reported **by category**:

- Add an optional `category?: FinanceCategoryId` to `BudgetItem`, `ExpenseEntry`,
  and `IncomeEntry` (`src/types.ts`), with a canonical id list in the catalog
  module.
- Group budget-vs-actual and the ledger by category; add a by-category breakdown
  to the treasurer report and the cash-flow/spending viz
  (`src/finances/treasurerReportPdf.ts`, `src/components/financeViz.tsx`).
- Lazy, non-destructive migration: infer a category from an item's label via the
  catalog on read; unmatched → "Other". Matches the app's existing read-migration
  ladder rather than a bulk rewrite.

Build PR2 when a coach wants spending rolled up by area (e.g. "Facilities: $2,400
of $2,000 planned") rather than line by line. Until then the catalog stands on
its own as PR1.
