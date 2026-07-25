import React, { memo, useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useTeam } from "../contexts";
import { PageShell } from "../components/PageShell";
import { ScreenLoader } from "../components/LoadingScreens";
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

// How long an empty signup list is treated as "still arriving" before we
// accept it as the truth. Generous on purpose: it only ever delays a REDIRECT
// (a resolved signup renders on the frame it arrives), so overshooting costs a
// moment of skeleton while undershooting costs the coach their page.

// Signups moved off the team doc into per-entry subcollection docs (Phase 1
// of docs/firestore-data-migration.md), so an empty list now means one of two
// very different things: the subscription hasn't delivered its first snapshot
// yet, or this team genuinely has no signups. It used to mean only the second
// — the legacy arrays rode in on the team doc, and the whole app is gated
// behind AppLoadingScreen until that doc lands — so looking an id up and
// bailing when it was missing was safe. It isn't any more: once the legacy
// arrays are dropped, empty is the NORMAL state for the first frames after a
// load or refresh, and redirecting on it bounces a coach straight out of the
// letter they deep-linked to.
//
// The provider publishes `signupsReady` (both subscriptions delivered) for
// exactly this. Do NOT substitute "the list is non-empty": mid-migration the
// team doc paints the legacy array on the first frame, so a non-empty list is
// already true while the subscription is still in flight — and every signup
// created after the cutover exists ONLY as a subdoc, so a deep link to one
// would be judged "settled, id unknown" and redirected away.

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
  // No settle guard here, unlike the two signup pages below: players still
  // ride on the team doc, which is loaded before any route renders, so an
  // unknown id really is unknown.
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
  const {
    team,
    user,
    updateFinances,
    updateTryoutSignup,
    currentRole,
    signupsReady,
  } = useTeam();
  const back = useBackOrFallback("/tryouts");
  const signups = team.tryoutSignups || [];
  const signup = signups.find((s: any) => s.id === signupId);
  const kind = KIND_SLUGS[kindSlug || ""];
  // Role and slug are decided by the URL and already-loaded state, so those
  // redirects stay immediate — only the id lookup has to wait for data.
  if (
    currentRole === "assistant" ||
    (kind !== "newPlayer" && kind !== "rejection")
  ) {
    return <Navigate to="/tryouts" replace />;
  }
  if (!signup) {
    // Same skeleton App.tsx uses as the Suspense fallback for this route, so
    // a chunk still loading and its data still arriving look like one wait.
    return signupsReady ? <Navigate to="/tryouts" replace /> : <ScreenLoader />;
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
  const { team, user, currentRole, signupsReady } = useTeam();
  const back = useBackOrFallback("/interest");
  const leads = team.interestSignups || [];
  const lead = leads.find((l: any) => l.id === leadId);
  if (currentRole === "assistant") {
    return <Navigate to="/interest" replace />;
  }
  if (!lead) {
    return signupsReady ? (
      <Navigate to="/interest" replace />
    ) : (
      <ScreenLoader />
    );
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
