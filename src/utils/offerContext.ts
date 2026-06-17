import { formatCurrency } from "./helpers";
import type { OfferLetterContext } from "../constants/offerLetters";

// Build the placeholder context for a recruiting/offer letter from the team
// doc + signed-in head coach. Offers are for the UPCOMING season, so team fees
// prefer next season's fee and fall back to the current one. Empty money
// strings signal "not set yet" so the modal can warn the coach.
export const makeOfferLetterContext = (
  team: any,
  user: any,
  recipientName: string
): OfferLetterContext => {
  const finances = team?.finances || {};
  const fee =
    finances.nextClubFee != null
      ? Number(finances.nextClubFee)
      : finances.clubFee != null
      ? Number(finances.clubFee)
      : null;
  const deposit =
    finances.depositAmount != null ? Number(finances.depositAmount) : null;
  return {
    playerName: recipientName || "[Player Name]",
    teamName: team?.name || "our team",
    teamFees: fee != null && fee > 0 ? formatCurrency(fee) : "",
    deposit: deposit != null && deposit > 0 ? formatCurrency(deposit) : "",
    depositDueDate: finances.depositDueDate || "",
    coachName: user?.displayName || "Your coach",
    coachEmail: user?.email || "",
    coachPhone: (team?.headCoachPhone as string) || "",
  };
};
