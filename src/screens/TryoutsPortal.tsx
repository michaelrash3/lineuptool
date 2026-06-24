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
} from "../utils/helpers";
import { reportError } from "../utils/errorReporter";
import { Button, Eyebrow } from "../components/shared";
import { Icons } from "../icons";

const getTryoutAgeLabel = (teamAge: any) => {
  const n = Number.parseInt(String(teamAge || "").replace(/[^0-9]/g, ""), 10);
  if (Number.isNaN(n)) return "Next Season";
  return `${n + 1}U`;
};

const getNextSpringSeasonLabel = (currentSeason: any) => {
  const match = String(currentSeason || "")
    .trim()
    .match(/^(Spring|Fall)\s+(\d{4})$/i);
  if (!match) return "Next Season";

  const year = Number.parseInt(match[2], 10);
  if (Number.isNaN(year)) return "Next Season";

  // Interest links are for the next spring tryout cycle, not merely the
  // next chronological season after the current team season.
  return `Spring ${year + 1}`;
};

// 8U plays 10 defenders → LF, LCF, RCF, RF (LC + RC cover center, no
// lone CF). 9U+ plays 9 defenders → LF, CF, RF. Anything younger than
// 8U or unknown defaults to the 8U layout.
const getOutfieldPositions = (tryoutAgeLabel: any) => {
  const n = Number.parseInt(
    String(tryoutAgeLabel || "").replace(/[^0-9]/g, ""),
    10,
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
const RING_STYLE = {
  "--tw-ring-color": "var(--team-primary)",
} as React.CSSProperties;

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
    tone === "error" ? "border-loss" : tone === "success" ? "" : "border-line";
  const accent =
    tone === "success" ? { borderColor: "var(--team-primary)" } : undefined;
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
              tone === "error" ? "var(--loss-bg)" : "var(--team-primary-15)",
          }}
        >
          <Icon
            className="w-6 h-6"
            style={{
              color: tone === "error" ? "var(--loss)" : "var(--team-primary)",
            }}
          />
        </div>
      )}
      {title && (
        <h1
          className="t-card-title mb-3"
          style={
            tone === "success" ? { color: "var(--team-primary)" } : undefined
          }
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
  const [mode, setMode] = useState<string | null>("interest");
  const [selectedTryoutDate, setSelectedTryoutDate] = useState("");
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
    primaryPosition: "",
    secondaryPosition: "",
    canPitch: "",
    canCatch: "",
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
      document.title = `${name} Player Interest`;
    }
    return () => {
      document.title = "Coach's Card";
    };
  }, [team?.name]);

  const tryoutAgeLabel = useMemo(
    () => getTryoutAgeLabel(team?.teamAge),
    [team?.teamAge],
  );
  const headerSeasonLabel = useMemo(
    () => getNextSpringSeasonLabel(team?.currentSeason),
    [team?.currentSeason],
  );
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
          "teamPublic",
        );
        const shareSnap = await getDocs(
          query(mirrorRef, where("tryoutShareId", "==", linkSlug)),
        );
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

        setError("Link not found or has been deactivated.");
        setPhase("error");
      } catch (err) {
        reportError(err, { source: "TryoutsPortal.init", linkSlug });
        setError(
          "Couldn't load this team's page. The link may be invalid or your network may be down.",
        );
        setPhase("error");
      }
    };
    init();
    return () => {
      cancelled = true;
    };
  }, [linkSlug]);

  const activeTryoutDates = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return Array.isArray(team?.tryoutDates)
      ? team.tryoutDates.filter(
          (date: any) => String(date || "").trim() >= today,
        )
      : [];
  }, [team?.tryoutDates]);

  const setPosition = (
    field: "primaryPosition" | "secondaryPosition",
    value: string,
  ) => {
    setForm((prev) => ({
      ...prev,
      [field]: value,
      canPitch:
        value === "P" ||
        (field === "primaryPosition"
          ? prev.secondaryPosition
          : prev.primaryPosition) === "P"
          ? "yes"
          : prev.canPitch,
      canCatch:
        value === "C" ||
        (field === "primaryPosition"
          ? prev.secondaryPosition
          : prev.primaryPosition) === "C"
          ? "yes"
          : prev.canCatch,
    }));
  };

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
    if (!form.phone.trim()) return setError("Parent phone number is required.");

    if (!form.canPitch)
      return setError("Please answer whether your player pitches.");
    if (!form.canCatch)
      return setError("Please answer whether your player catches.");

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
      {
        const comfortablePositions = Array.from(
          new Set(
            [cleanForm.primaryPosition, cleanForm.secondaryPosition].filter(
              Boolean,
            ),
          ),
        );
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
          number: cleanForm.number,
          bats: cleanForm.bats,
          throws: cleanForm.throws,
          primaryPosition: cleanForm.primaryPosition,
          secondaryPosition: cleanForm.secondaryPosition,
          comfortablePositions,
          canPitch: cleanForm.canPitch === "yes",
          canCatch: cleanForm.canCatch === "yes",
          isCatcher: cleanForm.canCatch === "yes",
          tryoutDate: selectedTryoutDate || "",
          notes: cleanForm.notes,
        };
        const selectedDate = selectedTryoutDate || "";
        const isDatedTryoutSignup = selectedDate && team?.tryoutsOpen === true;
        const destination = isDatedTryoutSignup
          ? "tryoutSignups"
          : "interestSignups";
        const submission = isDatedTryoutSignup
          ? {
              ...lead,
              id: `ts-${Math.random().toString(36).slice(2, 10)}`,
              status: "tryout",
              tryoutDate: selectedDate,
            }
          : lead;
        await updateDoc(
          doc(db, "artifacts", appId, "public", "data", "teams", teamDocId!),
          { [destination]: arrayUnion(submission) },
        );
      }
      setPhase("sent");
    } catch (err) {
      reportError(err, { source: "TryoutsPortal.handleSubmit", mode });
      setError(
        "Submission failed — please retry, or contact the team's head coach directly.",
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
          <PhaseCard
            tone="error"
            icon={Icons.Alert}
            title="Can't open this page"
          >
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
            title="Thanks for your interest"
          >
            <p>
              <strong className="text-ink">
                {form.firstName} {form.lastName}
              </strong>{" "}
              {selectedTryoutDate && team?.tryoutsOpen === true
                ? `is signed up for the ${selectedTryoutDate} tryout. The head coach will reach out with next steps.`
                : selectedTryoutDate
                  ? `is on ${team?.name || "the team"}'s interest list for the ${selectedTryoutDate} tryout. The head coach will reach out with next steps.`
                  : `is on ${team?.name || "the team"}'s interest list. The head coach will be in touch.`}{" "}
              Contact at <strong className="text-ink">{form.email}</strong> ·{" "}
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
          {headerSeasonLabel} · {tryoutAgeLabel}
        </Eyebrow>
        <h1 className="t-display" style={{ color: "var(--team-primary)" }}>
          {team?.name || "Tryouts"} Player Interest
        </h1>
        <p className="t-body mt-2 max-w-md mx-auto">
          Let us know your child is interested in playing for this team. Select
          a tryout date if one is available, or submit general interest any time
          during the season.
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="bg-transparent rounded-2xl shadow-card border border-line overflow-hidden"
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
                  onChange={(e) =>
                    setForm({ ...form, firstName: e.target.value })
                  }
                  className={INPUT_BASE}
                  style={RING_STYLE}
                />
              </Field>
              <Field label="Last Name *">
                <input
                  type="text"
                  required
                  value={form.lastName}
                  onChange={(e) =>
                    setForm({ ...form, lastName: e.target.value })
                  }
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
              <Field label="Current Team">
                <input
                  type="text"
                  value={form.currentTeam}
                  onChange={(e) =>
                    setForm({ ...form, currentTeam: e.target.value })
                  }
                  className={INPUT_BASE}
                  style={RING_STYLE}
                />
              </Field>
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
                {activeTryoutDates.length > 0 && (
                  <Field label="Tryout Date">
                    <select
                      value={selectedTryoutDate}
                      onChange={(e) => setSelectedTryoutDate(e.target.value)}
                      className={INPUT_BASE}
                      style={RING_STYLE}
                    >
                      <option value="">General interest / not sure yet</option>
                      {activeTryoutDates.map((date: string) => (
                        <option key={date} value={date}>
                          {date}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
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
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Primary Position">
                <select
                  value={form.primaryPosition}
                  onChange={(e) =>
                    setPosition("primaryPosition", e.target.value)
                  }
                  className={INPUT_BASE}
                  style={RING_STYLE}
                >
                  <option value="">Select primary position</option>
                  {positions.map((pos) => (
                    <option key={pos} value={pos}>
                      {pos}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Secondary Position (optional)">
                <select
                  value={form.secondaryPosition}
                  onChange={(e) =>
                    setPosition("secondaryPosition", e.target.value)
                  }
                  className={INPUT_BASE}
                  style={RING_STYLE}
                >
                  <option value="">None</option>
                  {positions.map((pos) => (
                    <option key={pos} value={pos}>
                      {pos}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Does your player pitch? *">
                <select
                  required
                  value={form.canPitch}
                  onChange={(e) =>
                    setForm({ ...form, canPitch: e.target.value })
                  }
                  className={INPUT_BASE}
                  style={RING_STYLE}
                >
                  <option value="">Select</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </Field>
              <Field label="Does your player catch? *">
                <select
                  required
                  value={form.canCatch}
                  onChange={(e) =>
                    setForm({ ...form, canCatch: e.target.value })
                  }
                  className={INPUT_BASE}
                  style={RING_STYLE}
                >
                  <option value="">Select</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </Field>
            </div>
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
              className="flex items-start gap-2 text-sm font-bold text-loss bg-loss-bg border border-loss rounded-xl px-3 py-2.5"
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
                <Icons.Check className="w-4 h-4" /> Submit Interest
              </>
            )}
          </Button>
          <p className="t-meta text-center text-ink-3">
            Your info is shared only with this team's coaching staff.
          </p>
        </div>
      </form>
      {(team?.headCoachName || team?.headCoachEmail) && (
        <p className="t-meta text-center text-ink-3 mt-5">
          Questions?{" "}
          {team.headCoachName
            ? `Contact ${team.headCoachName}`
            : "Contact the head coach"}
          {team.headCoachEmail ? (
            <>
              {" "}
              at{" "}
              <a
                href={`mailto:${team.headCoachEmail}`}
                className="font-bold text-ink underline"
              >
                {team.headCoachEmail}
              </a>
            </>
          ) : (
            "."
          )}
        </p>
      )}
    </PortalShell>
  );
};

const Field = ({ label, className = "", children }: any) => (
  <label className={`block ${className}`}>
    <span className="block t-label mb-1.5">{label}</span>
    {children}
  </label>
);
