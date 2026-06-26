import { formatCurrency } from "./helpers";
import type { OfferLetterContext } from "../constants/offerLetters";

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
  // Coach's Venmo, set in Settings → Tryouts. Accept either a handle
  // ("@Trash-Pandas" or "Trash-Pandas") or a full link; derive the missing one.
  const rawHandle = String(team?.venmoHandle || "").trim();
  const handle = rawHandle.replace(/^@/, "");
  const rawLink = String(team?.venmoLink || "").trim();
  const venmoLink =
    rawLink || (handle ? `https://venmo.com/u/${handle}` : "");
  const venmoName = rawHandle ? (rawHandle.startsWith("@") ? rawHandle : `@${handle}`) : "";

  return {
    playerName: recipientName || "[Player Name]",
    teamName: team?.name || "our team",
    teamFees: fee != null && fee > 0 ? formatCurrency(fee) : "",
    deposit: deposit != null && deposit > 0 ? formatCurrency(deposit) : "",
    depositDueDate:
      finances.nextDepositDueDate || finances.depositDueDate || "",
    coachName: user?.displayName || "Your coach",
    coachEmail: user?.email || "",
    coachPhone: (team?.headCoachPhone as string) || "",
    venmoName,
    venmoLink,
  };
};
