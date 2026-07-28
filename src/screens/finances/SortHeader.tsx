// Clickable column header for the sortable Finances tables (ledger, budget
// planner). Click toggles asc/desc; the active column shows its direction.
export const SortHeader = ({
  label,
  active,
  asc,
  onClick,
  context = "",
}: {
  label: string;
  active: boolean;
  asc: boolean;
  onClick: () => void;
  // Optional aria-only disambiguator (e.g. " (draft)") for pages that render
  // the same sortable columns twice; never shown visually.
  context?: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    // Encode the sort state in the accessible name too: the budget planner
    // uses a div layout (no columnheader role), where aria-sort is invalid —
    // this keeps the direction announced there. The ledger <th> also sets
    // aria-sort for table semantics.
    aria-label={`Sort by ${label}${context}${
      active ? `, sorted ${asc ? "ascending" : "descending"}` : ""
    }`}
    className={`t-eyebrow inline-flex items-center gap-1 min-h-[24px] hover:text-ink transition-colors ${
      active ? "text-ink" : ""
    }`}
  >
    {label}
    <span aria-hidden className="text-[9px] w-2">
      {active ? (asc ? "▲" : "▼") : ""}
    </span>
  </button>
);
