import { budgetItemAmount, formatCurrency } from "./helpers";
import type { OfferLetterContext } from "../constants/offerLetters";

const isTournamentItem = (item: { label?: string }): boolean =>
  /tournament/i.test(String(item?.label || ""));

// What next season's fees cover, read from the Budget Planner: the priced
// line-item labels (planner order, deduped) plus the total planned tournament
// count. Tournament items with a planned quantity fold into the count — the
// letter quotes them as a range — while a flat tournament item with no
// quantity stays in the list by label like everything else.
const coveredFromBudget = (finances: {
  budgetItems?: Array<{ label?: string; qty?: number }>;
  salesTaxPct?: number;
}): { coveredItems: string[]; tournamentCount: number } => {
  const items = (finances.budgetItems || []).filter(
    (item) => budgetItemAmount(item, finances.salesTaxPct) > 0,
  );
  const tournamentCount = Math.round(
    items
      .filter(isTournamentItem)
      .reduce((sum, item) => sum + Math.max(0, Number(item?.qty) || 0), 0),
  );
  const seen = new Set<string>();
  const coveredItems: string[] = [];
  for (const item of items) {
    if (tournamentCount > 0 && isTournamentItem(item)) continue;
    const label = String(item?.label || "").trim();
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    coveredItems.push(label);
  }
  return { coveredItems, tournamentCount };
};

// Build the placeholder context for a recruiting/offer letter from the team
// doc + signed-in head coach. Offer letters are for NEXT season, so money
// fields prefer Budget Planner values. Empty money strings signal "not set
// yet" so the modal can ask the coach to fill in next-season planning.
export const makeOfferLetterContext = (
  team: any,
  user: any,
  recipientName: string,
): OfferLetterContext => {
  const finances = team?.finances || {};
  const fee =
    finances.nextClubFee != null
      ? Number(finances.nextClubFee)
      : finances.clubFee != null
        ? Number(finances.clubFee)
        : null;
  const deposit =
    finances.nextDepositAmount != null
      ? Number(finances.nextDepositAmount)
      : finances.depositAmount != null
        ? Number(finances.depositAmount)
        : null;
  return {
    playerName: recipientName || "[Player Name]",
    teamName: team?.name || "our team",
    teamFees: fee != null && fee > 0 ? formatCurrency(fee) : "",
    deposit: deposit != null && deposit > 0 ? formatCurrency(deposit) : "",
    depositDueDate:
      finances.nextDepositDueDate || finances.depositDueDate || "",
    ...coveredFromBudget(finances),
    coachName: user?.displayName || "Your coach",
    coachEmail: user?.email || "",
    coachPhone: (team?.headCoachPhone as string) || "",
    venmoAccountName: (team?.coachVenmoAccountName as string) || "",
    venmoLink: (team?.coachVenmoLink as string) || "",
  };
};
