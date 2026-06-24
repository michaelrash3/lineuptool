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
  buildMonthGrid,
  addAbsenceDateRange,
  removeAbsenceDates,
} from "../utils/helpers";
import { reportError } from "../utils/errorReporter";
import { Button, Eyebrow } from "../components/shared";
import { Icons } from "../icons";

// Shared input styling — mirrors the other public portals so all three feel
// like one branded family. Ring color pulls from the team's primary.
const INPUT_BASE =
  "w-full px-3 py-2.5 text-sm bg-surface border border-line rounded-xl outline-none transition-shadow focus:ring-2 focus:border-transparent placeholder:text-ink-3 disabled:opacity-60 disabled:cursor-not-allowed";
const RING_STYLE = {
  "--tw-ring-color": "var(--team-primary)",
} as React.CSSProperties;

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

const todayIso = () => new Date().toISOString().slice(0, 10);

// Human-friendly chip label, e.g. "2026-07-04" → "Jul 4". UTC parts so the
// label never drifts a day across timezones.
const formatShortDate = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
};

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

// Tap-to-toggle month calendar. `selected` is a Set of ISO dates; tapping a day
// toggles it. Past days are disabled (you can't be unavailable in the past).
const MonthPicker = ({
  selected,
  onToggle,
}: {
  selected: Set<string>;
  onToggle: (iso: string) => void;
}) => {
  const now = new Date();
  const [view, setView] = useState({
    year: now.getUTCFullYear(),
    month: now.getUTCMonth(),
  });
  const cells = useMemo(
    () => buildMonthGrid(view.year, view.month),
    [view.year, view.month],
  );
  const today = todayIso();
  const monthLabel = new Date(
    Date.UTC(view.year, view.month, 1),
  ).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const step = (delta: number) =>
    setView((v) => {
      const d = new Date(Date.UTC(v.year, v.month + delta, 1));
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
    });

  return (
    <div className="relative overflow-hidden bg-surface border border-line rounded-xl p-4 shadow-card">
      <div
        className="-m-4 mb-4 px-4 py-3 flex items-center justify-between"
        style={{
          background:
            "linear-gradient(135deg, var(--team-primary), var(--team-secondary))",
        }}
      >
        <button
          type="button"
          onClick={() => step(-1)}
          className="p-2 rounded-md text-white hover:bg-white/15"
          aria-label="Previous month"
        >
          <Icons.ChevronDown className="w-4 h-4 rotate-90" />
        </button>
        <span className="t-button text-white">{monthLabel}</span>
        <button
          type="button"
          onClick={() => step(1)}
          className="p-2 rounded-md text-white hover:bg-white/15"
          aria-label="Next month"
        >
          <Icons.ChevronDown className="w-4 h-4 -rotate-90" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAYS.map((d, i) => (
          <div
            key={i}
            className="text-center text-[10px] font-black uppercase tracking-widest text-ink-3"
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {cells.map((iso, i) => {
          if (!iso) return <div key={i} />;
          const isSel = selected.has(iso);
          const isPast = iso < today;
          const day = Number(iso.slice(8, 10));
          return (
            <button
              key={i}
              type="button"
              disabled={isPast}
              onClick={() => onToggle(iso)}
              aria-pressed={isSel}
              className={`aspect-square min-h-11 rounded-md text-base font-bold transition-colors ${
                isPast
                  ? "text-ink-3 opacity-40 cursor-not-allowed"
                  : isSel
                    ? "text-white"
                    : "text-ink hover:bg-surface-2"
              }`}
              style={
                isSel ? { backgroundColor: "var(--team-primary)" } : undefined
              }
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export const AvailabilityPortal = () => {
  const { slug } = useParams();
  const linkSlug = (slug || "").trim();
  const [phase, setPhase] = useState("loading");
  const [team, setTeam] = useState<any>(null);
  const [teamDocId, setTeamDocId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    dob: "",
    parentName: "",
    email: "",
    phone: "",
  });
  // Selected unavailable dates (ISO yyyy-mm-dd).
  const [dates, setDates] = useState<string[]>([]);
  const [dateDetails, setDateDetails] = useState<
    Record<string, { startTime?: string; endTime?: string; reason?: string }>
  >({});
  // The "add a range" shortcut inputs.
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");

  const selectedSet = useMemo(() => new Set(dates), [dates]);
  const sortedDates = useMemo(() => [...dates].sort(), [dates]);

  useEffect(() => {
    const name = (team?.name || "").trim();
    if (name) document.title = `${name} Availability`;
    return () => {
      document.title = "Coach's Card";
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
        reportError(err, { source: "AvailabilityPortal.signInAnonymously" });
      }
      try {
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
        reportError(err, { source: "AvailabilityPortal.init", linkSlug });
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

  const toggleDate = (iso: string) => {
    setDates((prev) => {
      if (prev.includes(iso)) {
        setDateDetails((details) => {
          const next = { ...details };
          delete next[iso];
          return next;
        });
        return prev.filter((d) => d !== iso);
      }
      return [...prev, iso].sort();
    });
  };

  const updateDateDetail = (
    iso: string,
    patch: { startTime?: string; endTime?: string; reason?: string },
  ) => {
    setDateDetails((prev) => ({
      ...prev,
      [iso]: { ...(prev[iso] || {}), ...patch },
    }));
  };

  const addRange = () => {
    if (!rangeFrom) return setError("Pick a start date for the range.");
    // addAbsenceDateRange dedupes, sorts, and caps the span — exactly the
    // semantics we want for "I'm out for a stretch of days."
    setDates((prev) =>
      addAbsenceDateRange(prev, rangeFrom, rangeTo || rangeFrom),
    );
    setRangeFrom("");
    setRangeTo("");
    setError(null);
  };

  const handleSubmit = async (e: any) => {
    e?.preventDefault?.();
    if (submitting) return;
    if (!form.firstName.trim() || !form.lastName.trim())
      return setError("Player first + last name are required.");
    if (!form.dob.trim())
      return setError(
        "Date of birth is required so your coach can match this to the right player.",
      );
    if (form.email.trim() && !isValidEmail(form.email))
      return setError("Please enter a valid email address.");
    if (sortedDates.length === 0)
      return setError("Add at least one date your player is unavailable.");

    setError(null);
    setSubmitting(true);

    const submission = {
      id: `av-${Math.random().toString(36).slice(2, 10)}`,
      submittedAt: new Date().toISOString(),
      firstName: clampText(form.firstName, SIGNUP_LIMITS.name),
      lastName: clampText(form.lastName, SIGNUP_LIMITS.name),
      dob: form.dob || "",
      parentName: clampText(form.parentName, SIGNUP_LIMITS.name),
      email: clampText(form.email, SIGNUP_LIMITS.email),
      phone: clampText(form.phone, SIGNUP_LIMITS.phone),
      // Cap the payload — a sane ceiling on dates per submission.
      dates: sortedDates.slice(0, 366),
      blocks: sortedDates.slice(0, 366).map((date) => ({
        date,
        ...(dateDetails[date]?.startTime
          ? { startTime: dateDetails[date].startTime }
          : {}),
        ...(dateDetails[date]?.endTime
          ? { endTime: dateDetails[date].endTime }
          : {}),
        ...(dateDetails[date]?.reason
          ? { reason: clampText(dateDetails[date].reason || "", 140) }
          : {}),
      })),
    };

    try {
      await updateDoc(
        doc(db, "artifacts", appId, "public", "data", "teams", teamDocId!),
        { availabilitySubmissions: arrayUnion(submission) },
      );
      setPhase("sent");
    } catch (err) {
      reportError(err, { source: "AvailabilityPortal.handleSubmit" });
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
              's {sortedDates.length} unavailable date
              {sortedDates.length === 1 ? "" : "s"} were sent to{" "}
              {team?.name || "the team"}'s coaching staff. Submit the form again
              any time to add more dates.
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
        <Eyebrow className="block mb-2 text-ink-3">Availability</Eyebrow>
        <h1 className="t-display" style={{ color: "var(--team-primary)" }}>
          {team?.name || "Team"} Availability
        </h1>
        <p className="t-body mt-2 max-w-md mx-auto">
          Let your coach know the dates your player will be unavailable so the
          team can plan around them. Tap days on the calendar, or add a range
          for longer stretches.
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
              <Field label="Date of Birth *">
                <input
                  type="date"
                  required
                  value={form.dob}
                  onChange={(e) => setForm({ ...form, dob: e.target.value })}
                  className={INPUT_BASE}
                  style={RING_STYLE}
                />
              </Field>
            </div>
            <p className="t-meta text-ink-3">
              Date of birth lets your coach match this to the right player on
              the roster.
            </p>
          </section>

          <section className="space-y-4">
            <div className="flex items-center justify-between gap-3 pb-2 border-b border-line">
              <h2 className="t-h2">Unavailable Dates *</h2>
              <Eyebrow>{sortedDates.length} selected</Eyebrow>
            </div>

            <MonthPicker selected={selectedSet} onToggle={toggleDate} />

            <div className="rounded-xl border border-line p-3 space-y-2">
              <div className="t-label">Add a range (for vacations)</div>
              <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                <Field label="From" className="flex-1">
                  <input
                    type="date"
                    value={rangeFrom}
                    onChange={(e) => setRangeFrom(e.target.value)}
                    className={INPUT_BASE}
                    style={RING_STYLE}
                  />
                </Field>
                <Field label="To" className="flex-1">
                  <input
                    type="date"
                    value={rangeTo}
                    onChange={(e) => setRangeTo(e.target.value)}
                    className={INPUT_BASE}
                    style={RING_STYLE}
                  />
                </Field>
                <button
                  type="button"
                  onClick={addRange}
                  className="px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white rounded-xl shrink-0"
                  style={{ backgroundColor: "var(--team-primary)" }}
                >
                  Add
                </button>
              </div>
            </div>

            {sortedDates.length > 0 && (
              <div className="space-y-2">
                {sortedDates.map((d) => (
                  <div
                    key={d}
                    className="border border-line bg-surface-2 p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-black text-ink">
                        {formatShortDate(d)}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setDates((prev) => removeAbsenceDates(prev, [d]));
                          setDateDetails((prev) => {
                            const next = { ...prev };
                            delete next[d];
                            return next;
                          });
                        }}
                        className="text-loss text-[11px] font-black uppercase tracking-widest inline-flex items-center gap-1"
                        title="Remove this date"
                      >
                        <Icons.X className="w-3 h-3" /> Remove
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <Field label="Start time (optional)">
                        <input
                          type="time"
                          value={dateDetails[d]?.startTime || ""}
                          onChange={(e) =>
                            updateDateDetail(d, { startTime: e.target.value })
                          }
                          className={INPUT_BASE}
                          style={RING_STYLE}
                        />
                      </Field>
                      <Field label="End time (optional)">
                        <input
                          type="time"
                          value={dateDetails[d]?.endTime || ""}
                          onChange={(e) =>
                            updateDateDetail(d, { endTime: e.target.value })
                          }
                          className={INPUT_BASE}
                          style={RING_STYLE}
                        />
                      </Field>
                      <Field label="Reason (optional)">
                        <input
                          type="text"
                          value={dateDetails[d]?.reason || ""}
                          onChange={(e) =>
                            updateDateDetail(d, { reason: e.target.value })
                          }
                          placeholder="Vacation, school event..."
                          className={INPUT_BASE}
                          style={RING_STYLE}
                        />
                      </Field>
                    </div>
                  </div>
                ))}
              </div>
            )}
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
              <Field label="Email">
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className={INPUT_BASE}
                  style={RING_STYLE}
                />
              </Field>
              <Field label="Phone" className="sm:col-span-2">
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className={INPUT_BASE}
                  style={RING_STYLE}
                />
              </Field>
            </div>
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
                <Icons.Check className="w-4 h-4" /> Submit Availability
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
