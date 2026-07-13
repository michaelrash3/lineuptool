// Clickable column header for the sortable Finances tables (ledger, budget
// planner). Click toggles asc/desc; the active column shows its direction.
export const SortHeader = ({
  label,
  active,
  asc,
  onClick,
}: {
  label: string;
  active: boolean;
  asc: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={`Sort by ${label}`}
    className={`t-eyebrow inline-flex items-center gap-1 hover:text-ink transition-colors ${
      active ? "text-ink" : ""
    }`}
  >
    {label}
    <span aria-hidden className="text-[9px] w-2">
      {active ? (asc ? "▲" : "▼") : ""}
    </span>
  </button>
);
