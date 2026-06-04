import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  arrayUnion,
  collection,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { signInAnonymously } from "firebase/auth";
import { auth, appId, db } from "../firebase";
import {
  SIGNUP_LIMITS,
  clampText,
  isValidEmail,
  isSafeCssColor,
  isSafeImageUrl,
  resolveTryoutDateForSlug,
} from "../utils/helpers";
import { reportError } from "../utils/errorReporter";
import { Button, Eyebrow } from "../components/shared";
import { Icons } from "../icons";

const getTryoutAgeLabel = (teamAge: any) => {
  const n = Number.parseInt(String(teamAge || "").replace(/[^0-9]/g, ""), 10);
  if (Number.isNaN(n)) return "Next Season";
  return `${n + 1}U`;
};

// 8U plays 10 defenders → LF, LCF, RCF, RF (LC + RC cover center, no
// lone CF). 9U+ plays 9 defenders → LF, CF, RF. Anything younger than
// 8U or unknown defaults to the 8U layout.
const getOutfieldPositions = (tryoutAgeLabel: any) => {
  const n = Number.parseInt(
    String(tryoutAgeLabel || "").replace(/[^0-9]/g, ""),
    10
  );
  return !Number.isNaN(n) && n >= 9
    ? ["LF", "CF", "RF"]
    : ["LF", "LCF", "RCF", "RF"];
};


// Shared focus-ring + radius recipe applied to every input/select/textarea
// in this surface. Pulls the ring color from the team's primary so the form
// feels branded instead of using a generic Tailwind blue ring.
const INPUT_BASE =
  "w-full px-3 py-2.5 text-sm bg-surface border border-line rounded-xl outline-none transition-shadow focus:ring-2 focus:border-transparent placeholder:text-ink-3 disabled:opacity-60 disabled:cursor-not-allowed";
const RING_STYLE = { "--tw-ring-color": "var(--team-primary)" } as React.CSSProperties;

const PortalShell = ({ children, accent = true }: any) => (
  <div className="min-h-screen bg-app relative overflow-hidden">
    {accent && (
      <div
        className="h-2 w-full"
        style={{ backgroundColor: "var(--team-primary)" }}
      />
    )}
    <div className="max-w-2xl mx-auto p-5 sm:p-8 relative z-10">{children}</div>
  </div>
);

const PhaseCard = ({ tone = "neutral", icon: Icon, title, children }: any) => {
  const toneStyle =
    tone === "error"
      ? "border-rose-200"
      : tone === "success"
      ? ""
      : "border-line";
  const accent = tone === "success" ? { borderColor: "var(--team-primary)" } : undefined;
  return (
    <div
      className={`bg-surface rounded-2xl p-7 max-w-md mx-auto text-center shadow-card border-2 ${toneStyle}`}
      style={accent}
    >
      {Icon && (
        <div
          className="w-12 h-12 rounded-2xl mx-auto mb-4 flex items-center justify-center"
          style={{
            backgroundColor:
              tone === "error" ? "#fef2f2" : "var(--team-primary-15)",
          }}
        >
          <Icon
            className="w-6 h-6"
            style={{
              color: tone === "error" ? "#b91c1c" : "var(--team-primary)",
            }}
          />
        </div>
      )}
      {title && (
        <h1
          className="t-card-title mb-3"
          style={tone === "success" ? { color: "var(--team-primary)" } : undefined}
        >
          {title}
        </h1>
      )}
      <div className="t-body leading-relaxed">{children}</div>
    </div>
  );
};

export const TryoutsPortal = () => {
  const { slug } = useParams();
  const linkSlug = (slug || "").trim();
  const [phase, setPhase] = useState("loading");
  // "interest" → standing share link → year-round interest survey.
  // "tryout"   → per-date slug → tryout signup with date pinned.
  const [mode, setMode] = useState<string | null>(null);
  // Pinned tryout date (only meaningful in tryout mode). Parents no
  // longer pick a date — the slug determines it. Removes the long-
  // standing bug where the date dropdown surfaced stale dates left
  // over on the team after the HC removed them.
  const [pinnedDate, setPinnedDate] = useState("");
  const [team, setTeam] = useState<any>(null);
  const [teamDocId, setTeamDocId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Guards the submit button — parents on flaky wifi could otherwise
  // double-tap and the duplicate-signup check would still let one slip
  // through (the second write fires before the first one's arrayUnion
  // has rehydrated team.tryoutSignups locally).
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    dob: "",
    number: "",
    bats: "R",
    throws: "R",
    currentTeam: "",
    comfortablePositions: [] as string[],
    parentName: "",
    email: "",
    phone: "",
    notes: "",
  });

  // Team-specific browser-tab title so a shared portal link reads as
  // "<Team> Tryouts" / "<Team> Interest List" rather than the generic brand.
  // Restored to the brand on unmount so navigating back into the app is clean.
  useEffect(() => {
    const name = (team?.name || "").trim();
    if (name) {
      document.title =
        mode === "interest" ? `${name} Interest List` : `${name} Tryouts`;
    }
    return () => {
      document.title = "Coach's Card";
    };
  }, [team?.name, mode]);

  const tryoutAgeLabel = useMemo(() => getTryoutAgeLabel(team?.teamAge), [team?.teamAge]);
  const positions = useMemo(() => {
    const outfield = getOutfieldPositions(tryoutAgeLabel);
    return ["P", "C", "1B", "2B", "3B", "SS", ...outfield];
  }, [tryoutAgeLabel]);

  useEffect(() => {
    let cancelled = false;
    const applyThemeColors = (data: any) => {
      const root = document.documentElement;
      // Only honor team-supplied colors that are valid CSS color literals —
      // guards against smuggling extra declarations through branding values.
      if (isSafeCssColor(data.primaryColor))
        root.style.setProperty("--team-primary", data.primaryColor);
      if (isSafeCssColor(data.secondaryColor))
        root.style.setProperty("--team-secondary", data.secondaryColor);
      if (isSafeCssColor(data.tertiaryColor))
        root.style.setProperty("--team-tertiary", data.tertiaryColor);
    };
    const init = async () => {
      try {
        await signInAnonymously(auth);
      } catch (err) {
        // Non-fatal: the public mirror is world-readable, so the page can still
        // load. Log for diagnostics in case auth is consistently failing.
        reportError(err, { source: "TryoutsPortal.signInAnonymously" });
      }
      try {
        // Read the sanitized public mirror — never the full team doc. The
        // mirror carries only branding + tryout config (see buildPublicMirror);
        // signups are still written to the real team doc by id below.
        const mirrorRef = collection(
          db,
          "artifacts",
          appId,
          "public",
          "data",
          "teamPublic"
        );
        // Standing share link → interest survey (always valid).
        // Per-date link → tryout signup (gated on tryoutsOpen). New teams
        // expose every per-date slug in `tryoutDateSlugs` (array-contains
        // lookup); legacy teams only carried a single `tryoutDateSlug`, so we
        // fall back to the equality query for them.
        const [shareSnap, dateArraySnap, legacyDateSnap] = await Promise.all([
          getDocs(query(mirrorRef, where("tryoutShareId", "==", linkSlug))),
          getDocs(
            query(mirrorRef, where("tryoutDateSlugs", "array-contains", linkSlug))
          ),
          getDocs(query(mirrorRef, where("tryoutDateSlug", "==", linkSlug))),
        ]);
        if (cancelled) return;

        if (!shareSnap.empty) {
          const teamDoc = shareSnap.docs[0];
          const data = teamDoc.data();
          setTeam(data);
          setTeamDocId(teamDoc.id);
          applyThemeColors(data);
          setMode("interest");
          setPhase("form");
          return;
        }

        const dateSnap = !dateArraySnap.empty ? dateArraySnap : legacyDateSnap;
        if (!dateSnap.empty) {
          const teamDoc = dateSnap.docs[0];
          const data = teamDoc.data();
          if (data.tryoutsOpen === false) {
            setError("Tryouts are closed for this team.");
            setPhase("error");
            return;
          }
          // Date is pinned to the slug via the explicit mapping (with a legacy
          // fallback for teams that predate it) — never a parent-picked chooser.
          setPinnedDate(resolveTryoutDateForSlug(data, linkSlug));
          setTeam(data);
          setTeamDocId(teamDoc.id);
          applyThemeColors(data);
          setMode("tryout");
          setPhase("form");
          return;
        }

        setError("Link not found or has been deactivated.");
        setPhase("error");
      } catch (err) {
        reportError(err, { source: "TryoutsPortal.init", linkSlug });
        setError("Couldn't load this team's page. The link may be invalid or your network may be down.");
        setPhase("error");
      }
    };
    init();
    return () => {
      cancelled = true;
    };
  }, [linkSlug]);

  const togglePos = (pos: any) =>
    setForm((prev) => ({
      ...prev,
      comfortablePositions: prev.comfortablePositions.includes(pos)
        ? prev.comfortablePositions.filter((p) => p !== pos)
        : [...prev.comfortablePositions, pos],
    }));

  const handleSubmit = async (e: any) => {
    e?.preventDefault?.();
    if (submitting) return;
    // Common required fields (player name + parent contact). Both modes
    // need these; the tryout mode additionally requires currentTeam.
    if (!form.firstName.trim() || !form.lastName.trim())
      return setError("Player first + last name are required.");
    if (!form.email.trim())
      return setError("Parent email is required so we can reach you.");
    if (!isValidEmail(form.email))
      return setError("Please enter a valid parent email address.");
    if (!form.phone.trim())
      return setError("Parent phone number is required.");

    if (mode === "tryout") {
      if (!form.currentTeam.trim()) return setError("Current team is required.");
      // The old client-side duplicate-signup pre-check read the team's full
      // signup list, which the public mirror intentionally no longer exposes
      // (it's other families' PII). The `submitting` guard still prevents
      // double-taps; coaches can de-dupe genuine repeats in the app.
    }

    setError(null);
    setSubmitting(true);

    // Trim + length-clamp every free-text field before it leaves the browser.
    // The inputs are anonymous/untrusted; this bounds the stored payload.
    const cleanForm = {
      ...form,
      firstName: clampText(form.firstName, SIGNUP_LIMITS.name),
      lastName: clampText(form.lastName, SIGNUP_LIMITS.name),
      parentName: clampText(form.parentName, SIGNUP_LIMITS.name),
      currentTeam: clampText(form.currentTeam, SIGNUP_LIMITS.name),
      email: clampText(form.email, SIGNUP_LIMITS.email),
      phone: clampText(form.phone, SIGNUP_LIMITS.phone),
      notes: clampText(form.notes, SIGNUP_LIMITS.notes),
    };

    try {
      if (mode === "tryout") {
        const signup = {
          id: `ts-${Math.random().toString(36).slice(2, 10)}`,
          submittedAt: new Date().toISOString(),
          status: "tryout",
          tryoutAge: tryoutAgeLabel,
          tryoutDate: pinnedDate,
          ...cleanForm,
        };
        await updateDoc(
          doc(db, "artifacts", appId, "public", "data", "teams", teamDocId!),
          { tryoutSignups: arrayUnion(signup) }
        );
      } else {
        // Interest mode — separate array; smaller payload (no
        // bats/throws/jersey-number/currentTeam-required at this stage).
        const lead = {
          id: `int-${Math.random().toString(36).slice(2, 10)}`,
          submittedAt: new Date().toISOString(),
          firstName: cleanForm.firstName,
          lastName: cleanForm.lastName,
          dob: form.dob || "",
          parentName: cleanForm.parentName,
          email: cleanForm.email,
          phone: cleanForm.phone,
          currentTeam: cleanForm.currentTeam,
          comfortablePositions: form.comfortablePositions || [],
          notes: cleanForm.notes,
        };
        await updateDoc(
          doc(db, "artifacts", appId, "public", "data", "teams", teamDocId!),
          { interestSignups: arrayUnion(lead) }
        );
      }
      setPhase("sent");
    } catch (err) {
      reportError(err, { source: "TryoutsPortal.handleSubmit", mode });
      setError(
        "Submission failed — please retry, or contact the team's head coach directly."
      );
      setSubmitting(false);
    }
  };

  if (phase === "loading") {
    return (
      <PortalShell accent={false}>
        <div className="min-h-[60vh] flex items-center justify-center">
          <div className="flex items-center gap-3 text-ink-3">
            <Icons.Refresh className="w-4 h-4 animate-spin" />
            <span className="t-eyebrow">Loading Tryouts</span>
          </div>
        </div>
      </PortalShell>
    );
  }

  if (phase === "error") {
    return (
      <PortalShell>
        <div className="py-10">
          <PhaseCard tone="error" icon={Icons.Alert} title="Can't open this page">
            {error}
          </PhaseCard>
        </div>
      </PortalShell>
    );
  }

  if (phase === "sent") {
    const isInterest = mode === "interest";
    return (
      <PortalShell>
        <div className="py-10">
          <PhaseCard
            tone="success"
            icon={Icons.Check}
            title={isInterest ? "Thanks for your interest" : "You're in"}
          >
            <p>
              <strong className="text-ink">
                {form.firstName} {form.lastName}
              </strong>{" "}
              {isInterest
                ? `is on ${team?.name || "the team"}'s interest list. The head coach will be in touch when tryouts open.`
                : `is registered for ${team?.name || "tryouts"}. We'll reach out with next steps.`}{" "}
              Contact at{" "}
              <strong className="text-ink">{form.email}</strong> ·{" "}
              <strong className="text-ink">{form.phone}</strong>.
            </p>
          </PhaseCard>
        </div>
      </PortalShell>
    );
  }

  // Only render team-supplied logos that are https or inline image data URLs.
  const safeLogoUrl = isSafeImageUrl(team?.logoUrl) ? team.logoUrl : null;

  return (
    <PortalShell>
      {safeLogoUrl && (
        <img
          src={safeLogoUrl}
          alt=""
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 m-auto w-[120vw] max-w-[1100px] opacity-[0.10]"
          style={{ filter: "saturate(1.05)" }}
        />
      )}
      <header className="text-center mb-7">
        {safeLogoUrl && (
          <img
            src={safeLogoUrl}
            alt={team.name}
            className="w-20 h-20 mx-auto mb-3 object-contain"
          />
        )}
        <Eyebrow className="block mb-2 text-ink-3">
          {team?.currentSeason || "Next Season"} · {tryoutAgeLabel}
        </Eyebrow>
        <h1
          className="t-display"
          style={{ color: "var(--team-primary)" }}
        >
          {team?.name || "Tryouts"}{" "}
          {mode === "interest"
            ? "Player Interest"
            : `${tryoutAgeLabel} Tryouts`}
        </h1>
        <p className="t-body mt-2 max-w-md mx-auto">
          {mode === "interest"
            ? "Let us know your child is interested in playing for this team next season. The head coach will reach out when tryouts open."
            : `Tryout date ${pinnedDate || ""}. Fill in the details below — fields marked with an asterisk are required.`}
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="bg-surface backdrop-blur rounded-2xl shadow-card border border-line overflow-hidden"
      >
        <div
          className="h-1 w-full"
          style={{ backgroundColor: "var(--team-primary)" }}
        />
        <div className="p-5 sm:p-7 space-y-6">
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-3 pb-2 border-b border-line">
              <h2 className="t-h2">Player Info</h2>
              <Eyebrow>{tryoutAgeLabel}</Eyebrow>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="First Name *">
                <input
                  type="text"
                  required
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                  className={INPUT_BASE}
                  style={RING_STYLE}
                />
              </Field>
              <Field label="Last Name *">
                <input
                  type="text"
                  required
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                  className={INPUT_BASE}
                  style={RING_STYLE}
                />
              </Field>
              <Field label="Date of Birth">
                <input
                  type="date"
                  value={form.dob}
                  onChange={(e) => setForm({ ...form, dob: e.target.value })}
                  className={INPUT_BASE}
                  style={RING_STYLE}
                />
              </Field>
              <Field label={mode === "interest" ? "Current Team" : "Current Team *"}>
                <input
                  type="text"
                  required={mode === "tryout"}
                  value={form.currentTeam}
                  onChange={(e) =>
                    setForm({ ...form, currentTeam: e.target.value })
                  }
                  className={INPUT_BASE}
                  style={RING_STYLE}
                />
              </Field>
              {mode === "tryout" && (
                <>
                  <Field label="Jersey Number (preferred)">
                    <input
                      type="text"
                      value={form.number}
                      onChange={(e) =>
                        setForm({ ...form, number: e.target.value })
                      }
                      className={INPUT_BASE}
                      style={RING_STYLE}
                    />
                  </Field>
                  <Field label="Tryout Date">
                    <div
                      className={`${INPUT_BASE} bg-app text-ink font-bold cursor-not-allowed`}
                      style={RING_STYLE}
                      aria-label="Tryout date (locked)"
                    >
                      {pinnedDate || "—"}
                    </div>
                  </Field>
                  <Field label="Bats">
                    <select
                      value={form.bats}
                      onChange={(e) => setForm({ ...form, bats: e.target.value })}
                      className={INPUT_BASE}
                      style={RING_STYLE}
                    >
                      <option value="R">Right</option>
                      <option value="L">Left</option>
                      <option value="S">Switch</option>
                    </select>
                  </Field>
                  <Field label="Throws">
                    <select
                      value={form.throws}
                      onChange={(e) =>
                        setForm({ ...form, throws: e.target.value })
                      }
                      className={INPUT_BASE}
                      style={RING_STYLE}
                    >
                      <option value="R">Right</option>
                      <option value="L">Left</option>
                    </select>
                  </Field>
                </>
              )}
            </div>

            <Field label="Positions your player can play">
              <div className="flex flex-wrap gap-2">
                {positions.map((pos) => {
                  const active = form.comfortablePositions.includes(pos);
                  return (
                    <button
                      key={pos}
                      type="button"
                      onClick={() => togglePos(pos)}
                      aria-pressed={active}
                      className="min-w-[44px] px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-full border-2 transition-all tabular-nums shadow-sm"
                      style={
                        active
                          ? {
                              backgroundColor: "var(--team-primary)",
                              color: "var(--team-tertiary)",
                              borderColor: "var(--team-primary)",
                            }
                          : {
                              backgroundColor: "white",
                              color: "#334155",
                              borderColor: "#e2e8f0",
                            }
                      }
                    >
                      {pos}
                    </button>
                  );
                })}
              </div>
            </Field>
          </section>

          <section className="space-y-4">
            <div className="flex items-center justify-between gap-3 pb-2 border-b border-line">
              <h2 className="t-h2">Parent / Guardian</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Your Name">
                <input
                  type="text"
                  value={form.parentName}
                  onChange={(e) =>
                    setForm({ ...form, parentName: e.target.value })
                  }
                  className={INPUT_BASE}
                  style={RING_STYLE}
                />
              </Field>
              <Field label="Email *">
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className={INPUT_BASE}
                  style={RING_STYLE}
                />
              </Field>
              <Field label="Phone *" className="sm:col-span-2">
                <input
                  type="tel"
                  required
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className={INPUT_BASE}
                  style={RING_STYLE}
                />
              </Field>
            </div>
            <Field label="Anything we should know?">
              <textarea
                rows={3}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className={`${INPUT_BASE} resize-y min-h-[88px]`}
                style={RING_STYLE}
              />
            </Field>
          </section>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 text-sm font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2.5"
            >
              <Icons.Alert className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full"
            disabled={submitting}
            style={
              submitting ? { opacity: 0.7, cursor: "not-allowed" } : undefined
            }
          >
            {submitting ? (
              <>
                <Icons.Refresh className="w-4 h-4 animate-spin" /> Submitting…
              </>
            ) : (
              <>
                <Icons.Check className="w-4 h-4" />{" "}
                {mode === "interest" ? "Submit Interest" : "Submit Signup"}
              </>
            )}
          </Button>
          <p className="t-meta text-center text-ink-3">
            Your info is shared only with this team's coaching staff.
          </p>
        </div>
      </form>
    </PortalShell>
  );
};

const Field = ({ label, className = "", children }: any) => (
  <label className={`block ${className}`}>
    <span className="block t-label mb-1.5">{label}</span>
    {children}
  </label>
);
