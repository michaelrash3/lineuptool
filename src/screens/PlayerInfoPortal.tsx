import React, { useEffect, useState } from "react";
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

// Shared input styling — mirrors the Tryouts Portal so the two public surfaces
// feel like one branded family. Ring color pulls from the team's primary.
const INPUT_BASE =
  "w-full px-3 py-2.5 text-sm bg-surface border border-line rounded-xl outline-none transition-shadow focus:ring-2 focus:border-transparent placeholder:text-ink-3 disabled:opacity-60 disabled:cursor-not-allowed";
const RING_STYLE = {
  "--tw-ring-color": "var(--team-primary)",
} as React.CSSProperties;

// Youth → adult apparel size scale. One list drives shirt + pants.
const APPAREL_SIZES = [
  "YXS",
  "YS",
  "YM",
  "YL",
  "YXL",
  "Adult S",
  "Adult M",
  "Adult L",
  "Adult XL",
  "Adult 2XL",
];
// Fitted-cap size ranges (flex-fit), distinct from the apparel scale.
const HAT_SIZES = ["XS-SM", "SM-MED", "MED-LG", "LG-XL"];

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

const Field = ({ label, className = "", children }: any) => (
  <label className={`block ${className}`}>
    <span className="block t-label mb-1.5">{label}</span>
    {children}
  </label>
);

export const PlayerInfoPortal = () => {
  const { slug } = useParams();
  const linkSlug = (slug || "").trim();
  const [phase, setPhase] = useState("loading");
  const [team, setTeam] = useState<any>(null);
  const [teamDocId, setTeamDocId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Guards against double-submit on flaky wifi (the second write would fire
  // before the first arrayUnion rehydrates locally).
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    dob: "",
    number: "",
    hatSize: "",
    shirtSize: "",
    pantsSize: "",
    height: "",
    weight: "",
    school: "",
    grade: "",
    parentName: "",
    email: "",
    phone: "",
    parent2Name: "",
    parent2Phone: "",
    parent2Email: "",
    notes: "",
  });

  // Team-specific browser-tab title so the shared link reads as
  // "<Team> Player Info" rather than the generic brand.
  useEffect(() => {
    const name = (team?.name || "").trim();
    if (name) document.title = `${name} Player Info`;
    return () => {
      document.title = "Dugout";
    };
  }, [team?.name]);

  useEffect(() => {
    let cancelled = false;
    const applyThemeColors = (data: any) => {
      const root = document.documentElement;
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
        reportError(err, { source: "PlayerInfoPortal.signInAnonymously" });
      }
      try {
        // Resolve the team from the sanitized public mirror by the SAME share
        // id the Tryouts Portal uses — never the full team doc. Submissions are
        // written to the real team doc by id below.
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
          setPhase("form");
          return;
        }

        setError("Link not found or has been deactivated.");
        setPhase("error");
      } catch (err) {
        reportError(err, { source: "PlayerInfoPortal.init", linkSlug });
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

  const handleSubmit = async (e: any) => {
    e?.preventDefault?.();
    if (submitting) return;
    if (!form.firstName.trim() || !form.lastName.trim())
      return setError("Player first + last name are required.");
    if (!form.email.trim())
      return setError("Parent email is required so we can reach you.");
    if (!isValidEmail(form.email))
      return setError("Please enter a valid parent email address.");
    if (!form.phone.trim()) return setError("Parent phone number is required.");

    setError(null);
    setSubmitting(true);

    // Trim + length-clamp every free-text field before it leaves the browser.
    const submission = {
      id: `pi-${Math.random().toString(36).slice(2, 10)}`,
      submittedAt: new Date().toISOString(),
      firstName: clampText(form.firstName, SIGNUP_LIMITS.name),
      lastName: clampText(form.lastName, SIGNUP_LIMITS.name),
      dob: form.dob || "",
      number: clampText(form.number, SIGNUP_LIMITS.size),
      hatSize: clampText(form.hatSize, SIGNUP_LIMITS.size),
      shirtSize: clampText(form.shirtSize, SIGNUP_LIMITS.size),
      pantsSize: clampText(form.pantsSize, SIGNUP_LIMITS.size),
      height: clampText(form.height, SIGNUP_LIMITS.size),
      weight: clampText(form.weight, SIGNUP_LIMITS.size),
      school: clampText(form.school, SIGNUP_LIMITS.name),
      grade: clampText(form.grade, SIGNUP_LIMITS.size),
      parentName: clampText(form.parentName, SIGNUP_LIMITS.name),
      email: clampText(form.email, SIGNUP_LIMITS.email),
      phone: clampText(form.phone, SIGNUP_LIMITS.phone),
      parent2Name: clampText(form.parent2Name, SIGNUP_LIMITS.name),
      parent2Phone: clampText(form.parent2Phone, SIGNUP_LIMITS.phone),
      parent2Email: clampText(form.parent2Email, SIGNUP_LIMITS.email),
      notes: clampText(form.notes, SIGNUP_LIMITS.notes),
    };

    try {
      await updateDoc(
        doc(db, "artifacts", appId, "public", "data", "teams", teamDocId!),
        { playerInfoSubmissions: arrayUnion(submission) },
      );
      setPhase("sent");
    } catch (err) {
      reportError(err, { source: "PlayerInfoPortal.handleSubmit" });
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
            <span className="t-eyebrow">Loading</span>
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
    return (
      <PortalShell>
        <div className="py-10">
          <PhaseCard tone="success" icon={Icons.Check} title="Thanks!">
            <p>
              <strong className="text-ink">
                {form.firstName} {form.lastName}
              </strong>
              's info was sent to {team?.name || "the team"}'s coaching staff.
              You can close this page.
            </p>
          </PhaseCard>
        </div>
      </PortalShell>
    );
  }

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
        <Eyebrow className="block mb-2 text-ink-3">Player Info</Eyebrow>
        <h1 className="t-display" style={{ color: "var(--team-primary)" }}>
          {team?.name || "Team"} Player Info
        </h1>
        <p className="t-body mt-2 max-w-md mx-auto">
          Help your coach gear up. Share your player's uniform/equipment sizing,
          school, and parent/guardian contacts. It only takes a minute.
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
              <h2 className="t-h2">Player</h2>
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
              <Field label="Jersey Number (preferred)">
                <input
                  type="text"
                  value={form.number}
                  onChange={(e) => setForm({ ...form, number: e.target.value })}
                  className={INPUT_BASE}
                  style={RING_STYLE}
                />
              </Field>
            </div>
            <p className="t-meta text-ink-3">
              Date of birth helps your coach match this to the right player on
              the roster.
            </p>
          </section>

          <section className="space-y-4">
            <div className="flex items-center justify-between gap-3 pb-2 border-b border-line">
              <h2 className="t-h2">Sizing</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Hat Size">
                <select
                  value={form.hatSize}
                  onChange={(e) =>
                    setForm({ ...form, hatSize: e.target.value })
                  }
                  className={INPUT_BASE}
                  style={RING_STYLE}
                >
                  <option value="">Select</option>
                  {HAT_SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Shirt / Jersey Size">
                <select
                  value={form.shirtSize}
                  onChange={(e) =>
                    setForm({ ...form, shirtSize: e.target.value })
                  }
                  className={INPUT_BASE}
                  style={RING_STYLE}
                >
                  <option value="">Select</option>
                  {APPAREL_SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Pants Size">
                <select
                  value={form.pantsSize}
                  onChange={(e) =>
                    setForm({ ...form, pantsSize: e.target.value })
                  }
                  className={INPUT_BASE}
                  style={RING_STYLE}
                >
                  <option value="">Select</option>
                  {APPAREL_SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Height">
                <input
                  type="text"
                  value={form.height}
                  placeholder={`e.g. 4'8"`}
                  onChange={(e) => setForm({ ...form, height: e.target.value })}
                  className={INPUT_BASE}
                  style={RING_STYLE}
                />
              </Field>
              <Field label="Weight">
                <input
                  type="text"
                  value={form.weight}
                  placeholder="e.g. 85 lbs"
                  onChange={(e) => setForm({ ...form, weight: e.target.value })}
                  className={INPUT_BASE}
                  style={RING_STYLE}
                />
              </Field>
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex items-center justify-between gap-3 pb-2 border-b border-line">
              <h2 className="t-h2">School</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="School">
                <input
                  type="text"
                  value={form.school}
                  onChange={(e) => setForm({ ...form, school: e.target.value })}
                  className={INPUT_BASE}
                  style={RING_STYLE}
                />
              </Field>
              <Field label="Grade">
                <input
                  type="text"
                  value={form.grade}
                  placeholder="e.g. 5th"
                  onChange={(e) => setForm({ ...form, grade: e.target.value })}
                  className={INPUT_BASE}
                  style={RING_STYLE}
                />
              </Field>
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex items-center justify-between gap-3 pb-2 border-b border-line">
              <h2 className="t-h2">Parent / Guardian 1</h2>
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
          </section>

          <section className="space-y-4">
            <div className="flex items-center justify-between gap-3 pb-2 border-b border-line">
              <h2 className="t-h2">Parent / Guardian 2</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Name">
                <input
                  type="text"
                  value={form.parent2Name}
                  onChange={(e) =>
                    setForm({ ...form, parent2Name: e.target.value })
                  }
                  className={INPUT_BASE}
                  style={RING_STYLE}
                />
              </Field>
              <Field label="Phone">
                <input
                  type="tel"
                  value={form.parent2Phone}
                  onChange={(e) =>
                    setForm({ ...form, parent2Phone: e.target.value })
                  }
                  className={INPUT_BASE}
                  style={RING_STYLE}
                />
              </Field>
              <Field label="Email" className="sm:col-span-2">
                <input
                  type="email"
                  value={form.parent2Email}
                  onChange={(e) =>
                    setForm({ ...form, parent2Email: e.target.value })
                  }
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
                <Icons.Check className="w-4 h-4" /> Submit Player Info
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
