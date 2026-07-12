import React, { memo } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useTeam } from "../contexts";
import { PageShell } from "../components/PageShell";
import { useBackOrFallback } from "../hooks/usePageNav";
import { OfferLetterView } from "../components/OfferLetterView";
import { makeOfferLetterContext } from "../utils/offerContext";
import {
  OFFER_LETTER_LABELS,
  type OfferLetterKind,
} from "../constants/offerLetters";

// Routed recruiting-letter drafts — one page per audience, converted from
// the offer-letter modal overlays per the app-wide modals→pages rule. All
// three are head-coach surfaces (they quote money and family contact info).
// The URL segment is "letter", not "offer": the same pages also render
// rejection and not-returning letters, and .../offer/rejection read as a
// contradiction in the address bar.

// URL slug → letter kind. Slugs stay kebab-case in the address bar.
const KIND_SLUGS: Record<string, OfferLetterKind> = {
  returning: "returning",
  "not-returning": "notReturning",
  "new-player": "newPlayer",
  rejection: "rejection",
};

const Shell = ({
  kind,
  onBack,
  children,
}: {
  kind: OfferLetterKind;
  onBack: () => void;
  children: React.ReactNode;
}) => (
  <PageShell
    eyebrow="Recruiting draft"
    title={OFFER_LETTER_LABELS[kind]}
    onBack={onBack}
  >
    <div className="cc-card p-5">{children}</div>
  </PageShell>
);

// /roster/:playerId/letter/:kind — returning / not-returning letters for a
// roster player, opened from the profile's Family Contact section.
export const RosterLetterPage = memo(() => {
  const { playerId, kind: kindSlug } = useParams();
  const { team, user, updateFinances, currentRole } = useTeam();
  const back = useBackOrFallback(playerId ? `/roster/${playerId}` : "/roster");
  const player = (team.players || []).find((p: any) => p.id === playerId);
  const kind = KIND_SLUGS[kindSlug || ""];
  if (
    currentRole === "assistant" ||
    !player ||
    (kind !== "returning" && kind !== "notReturning")
  ) {
    return <Navigate to="/roster" replace />;
  }
  return (
    <Shell kind={kind} onBack={back}>
      <OfferLetterView
        kind={kind}
        recipientEmail={player.email}
        ctx={makeOfferLetterContext(team, user, player.name)}
        onSaveNextSeasonMoney={
          kind === "returning"
            ? (patch) => updateFinances?.({ op: "set", fields: patch })
            : undefined
        }
      />
    </Shell>
  );
});

// /tryouts/letter/:signupId/:kind — new-player offer or rejection letter for
// a tryout signup; copying/opening the draft marks the signup
// offered/declined.
export const TryoutLetterPage = memo(() => {
  const { signupId, kind: kindSlug } = useParams();
  const { team, user, updateFinances, updateTryoutSignup, currentRole } =
    useTeam();
  const back = useBackOrFallback("/tryouts");
  const signup = (team.tryoutSignups || []).find((s: any) => s.id === signupId);
  const kind = KIND_SLUGS[kindSlug || ""];
  if (
    currentRole === "assistant" ||
    !signup ||
    (kind !== "newPlayer" && kind !== "rejection")
  ) {
    return <Navigate to="/tryouts" replace />;
  }
  const name = [signup.firstName, signup.lastName].filter(Boolean).join(" ");
  return (
    <Shell kind={kind} onBack={back}>
      <OfferLetterView
        kind={kind}
        recipientEmail={signup.email}
        ctx={makeOfferLetterContext(team, user, name)}
        onSaveNextSeasonMoney={(patch) =>
          updateFinances?.({ op: "set", fields: patch })
        }
        onDelivered={() =>
          updateTryoutSignup?.(signup.id, {
            status: kind === "rejection" ? "declined" : "offered",
          })
        }
      />
    </Shell>
  );
});

// /interest/letter/:leadId — tryout-invite draft for a year-round interest
// lead.
export const InterestLetterPage = memo(() => {
  const { leadId } = useParams();
  const { team, user, currentRole } = useTeam();
  const back = useBackOrFallback("/interest");
  const lead = (team.interestSignups || []).find((l: any) => l.id === leadId);
  if (currentRole === "assistant" || !lead) {
    return <Navigate to="/interest" replace />;
  }
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ");
  return (
    <Shell kind="interest" onBack={back}>
      <OfferLetterView
        kind="interest"
        recipientEmail={lead.email}
        ctx={makeOfferLetterContext(team, user, name)}
      />
    </Shell>
  );
});
