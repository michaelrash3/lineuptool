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
import { Button, Eyebrow } from "../components/shared.jsx";
import { Icons } from "../icons";

const getTryoutAgeLabel = (teamAge) => {
  const n = Number.parseInt(String(teamAge || "").replace(/[^0-9]/g, ""), 10);
  if (Number.isNaN(n)) return "Next Season";
  return `${n + 1}U`;
};

// 8U plays 10 defenders → LF, LCF, RCF, RF (LC + RC cover center, no
// lone CF). 9U+ plays 9 defenders → LF, CF, RF. Anything younger than
// 8U or unknown defaults to the 8U layout.
const getOutfieldPositions = (tryoutAgeLabel) => {
  const n = Number.parseInt(
    String(tryoutAgeLabel || "").replace(/[^0-9]/g, ""),
    10
  );
  return !Number.isNaN(n) && n >= 9
    ? ["LF", "CF", "RF"]
    : ["LF", "LCF", "RCF", "RF"];
};


const normalizeForMatch = (v) =>
  String(v || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const hasDuplicateSignup = (signups, form) => {
  const fFirst = normalizeForMatch(form.firstName);
  const fLast = normalizeForMatch(form.lastName);
  const fEmail = String(form.email || "").trim().toLowerCase();
  const fDate = String(form.tryoutDate || "").trim();
  if (!fFirst || !fLast || !fEmail) return false;
  return (Array.isArray(signups) ? signups : []).some((s) => {
    const sFirst = normalizeForMatch(s?.firstName);
    const sLast = normalizeForMatch(s?.lastName);
    const sEmail = String(s?.email || "").trim().toLowerCase();
    const sDate = String(s?.tryoutDate || "").trim();
    return sFirst === fFirst && sLast === fLast && sEmail === fEmail && sDate === fDate;
  });
};

// Shared focus-ring + radius recipe applied to every input/select/textarea
// in this surface. Pulls the ring color from the team's primary so the form
// feels branded instead of using a generic Tailwind blue ring.
const INPUT_BASE =
  "w-full px-3 py-2.5 text-sm bg-white border border-slate-200 rounded-xl outline-none transition-shadow focus:ring-2 focus:border-transparent placeholder:text-slate-400 disabled:opacity-60 disabled:cursor-not-allowed";
const RING_STYLE = { "--tw-ring-color": "var(--team-primary)" };

const PortalShell = ({ children, accent = true }) => (
  <div className="min-h-screen bg-slate-50 relative overflow-hidden">
    {accent && (
      <div
        className="h-2 w-full"
        style={{ backgroundColor: "var(--team-primary)" }}
      />
    )}
    <div className="max-w-2xl mx-auto p-5 sm:p-8 relative z-10">{children}</div>
  </div>
);

const PhaseCard = ({ tone = "neutral", icon: Icon, title, children }) => {
  const toneStyle =
    tone === "error"
      ? "border-rose-200"
      : tone === "success"
      ? ""
      : "border-slate-200";
  const accent = tone === "success" ? { borderColor: "var(--team-primary)" } : undefined;
  return (
    <div
      className={`bg-white rounded-2xl p-7 max-w-md mx-auto text-center shadow-card border-2 ${toneStyle}`}
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
  const [team, setTeam] = useState(null);
  const [teamDocId, setTeamDocId] = useState(null);
  const [error, setError] = useState(null);
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
    comfortablePositions: [],
    parentName: "",
    email: "",
    phone: "",
    tryoutDate: "",
    notes: "",
  });

  const tryoutAgeLabel = useMemo(() => getTryoutAgeLabel(team?.teamAge), [team?.teamAge]);
  const positions = useMemo(() => {
    const outfield = getOutfieldPositions(tryoutAgeLabel);
    return ["P", "C", "1B", "2B", "3B", "SS", ...outfield];
  }, [tryoutAgeLabel]);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        await signInAnonymously(auth);
      } catch {}
      try {
        const teamsRef = collection(db, "artifacts", appId, "public", "data", "teams");
        const [shareSnap, dateSnap] = await Promise.all([
          getDocs(query(teamsRef, where("tryoutsOpen", "==", true), where("tryoutShareId", "==", linkSlug))),
          getDocs(query(teamsRef, where("tryoutsOpen", "==", true), where("tryoutDateSlug", "==", linkSlug))),
        ]);
        if (cancelled) return;
        const hit = !shareSnap.empty ? shareSnap : dateSnap;
        if (hit.empty) {
          setError("Tryouts link not found or has been deactivated.");
          setPhase("error");
          return;
        }
        const teamDoc = hit.docs[0];
        const data = teamDoc.data();
        if (data.tryoutsOpen === false) {
          setError("Tryouts are closed for this team.");
          setPhase("error");
          return;
        }
        setTeam(data);
        setTeamDocId(teamDoc.id);
        const configuredDates = Array.isArray(data.tryoutDates) ? data.tryoutDates.filter(Boolean) : [];
        const matchedDate = configuredDates.find((d) => String(d).trim() === linkSlug);
        setForm((prev) => ({
          ...prev,
          tryoutDate: matchedDate || configuredDates[0] || "",
        }));
        const root = document.documentElement;
        if (data.primaryColor) root.style.setProperty("--team-primary", data.primaryColor);
        if (data.secondaryColor) root.style.setProperty("--team-secondary", data.secondaryColor);
        if (data.tertiaryColor) root.style.setProperty("--team-tertiary", data.tertiaryColor);
        setPhase("form");
      } catch {
        setError("Couldn't load this team's tryouts page. The link may be invalid or your network may be down.");
        setPhase("error");
      }
    };
    init();
    return () => {
      cancelled = true;
    };
  }, [linkSlug]);

  const togglePos = (pos) =>
    setForm((prev) => ({
      ...prev,
      comfortablePositions: prev.comfortablePositions.includes(pos)
        ? prev.comfortablePositions.filter((p) => p !== pos)
        : [...prev.comfortablePositions, pos],
    }));

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (submitting) return;
    if (!form.firstName.trim() || !form.lastName.trim()) return setError("Player first + last name are required.");
    if (!form.currentTeam.trim()) return setError("Current team is required.");
    if (!form.email.trim()) return setError("Parent email is required so we can reach you with results.");
    if (!form.phone.trim()) return setError("Parent phone number is required.");
    if (hasDuplicateSignup(team?.tryoutSignups, form)) {
      return setError("Looks like this player is already registered for that date with this email.");
    }
    setError(null);
    setSubmitting(true);

    const signup = {
      id: `ts-${Math.random().toString(36).slice(2, 10)}`,
      submittedAt: new Date().toISOString(),
      status: "tryout",
      tryoutAge: tryoutAgeLabel,
      ...form,
    };

    try {
      await updateDoc(doc(db, "artifacts", appId, "public", "data", "teams", teamDocId), {
        tryoutSignups: arrayUnion(signup),
      });
      setTeam((prev) => ({
        ...(prev || {}),
        tryoutSignups: [...(Array.isArray(prev?.tryoutSignups) ? prev.tryoutSignups : []), signup],
      }));
      setPhase("sent");
    } catch {
      setError("Submission failed — please retry, or contact the team's head coach directly.");
      setSubmitting(false);
    }
  };

  if (phase === "loading") {
    return (
      <PortalShell accent={false}>
        <div className="min-h-[60vh] flex items-center justify-center">
          <div className="flex items-center gap-3 text-slate-500">
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
    return (
      <PortalShell>
        <div className="py-10">
          <PhaseCard tone="success" icon={Icons.Check} title="You're in">
            <p>
              <strong className="text-slate-900">
                {form.firstName} {form.lastName}
              </strong>{" "}
              is registered for {team?.name || "tryouts"}. We'll reach you at{" "}
              <strong className="text-slate-900">{form.email}</strong> and{" "}
              <strong className="text-slate-900">{form.phone}</strong> with
              next steps.
            </p>
          </PhaseCard>
        </div>
      </PortalShell>
    );
  }

  return (
    <PortalShell>
      {team?.logoUrl && (
        <img
          src={team.logoUrl}
          alt=""
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 m-auto w-[120vw] max-w-[1100px] opacity-[0.10]"
          style={{ filter: "saturate(1.05)" }}
        />
      )}
      <header className="text-center mb-7">
        {team?.logoUrl && (
          <img
            src={team.logoUrl}
            alt={team.name}
            className="w-20 h-20 mx-auto mb-3 object-contain"
          />
        )}
        <Eyebrow className="block mb-2 text-slate-500">
          {team?.currentSeason || "Next Season"} · {tryoutAgeLabel}
        </Eyebrow>
        <h1
          className="t-display"
          style={{ color: "var(--team-primary)" }}
        >
          {team?.name || "Tryouts"} {tryoutAgeLabel} Tryouts
        </h1>
        <p className="t-body mt-2 max-w-md mx-auto">
          Fill in the player and parent details below — fields marked with an
          asterisk are required.
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="bg-white/95 backdrop-blur rounded-2xl shadow-card border border-slate-200 overflow-hidden"
      >
        <div
          className="h-1 w-full"
          style={{ backgroundColor: "var(--team-primary)" }}
        />
        <div className="p-5 sm:p-7 space-y-6">
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-3 pb-2 border-b border-slate-100">
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
              <Field label="Current Team *">
                <input
                  type="text"
                  required
                  value={form.currentTeam}
                  onChange={(e) =>
                    setForm({ ...form, currentTeam: e.target.value })
                  }
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
              <Field label="Tryout Date">
                {Array.isArray(team?.tryoutDates) && team.tryoutDates.length > 0 ? (
                  <select
                    value={form.tryoutDate}
                    onChange={(e) =>
                      setForm({ ...form, tryoutDate: e.target.value })
                    }
                    className={INPUT_BASE}
                    style={RING_STYLE}
                  >
                    {team.tryoutDates.filter(Boolean).map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    placeholder="e.g. 5-23-2026"
                    value={form.tryoutDate}
                    onChange={(e) =>
                      setForm({ ...form, tryoutDate: e.target.value })
                    }
                    className={INPUT_BASE}
                    style={RING_STYLE}
                  />
                )}
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
                  onChange={(e) => setForm({ ...form, throws: e.target.value })}
                  className={INPUT_BASE}
                  style={RING_STYLE}
                >
                  <option value="R">Right</option>
                  <option value="L">Left</option>
                </select>
              </Field>
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
            <div className="flex items-center justify-between gap-3 pb-2 border-b border-slate-100">
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
                <Icons.Check className="w-4 h-4" /> Submit Signup
              </>
            )}
          </Button>
          <p className="t-meta text-center text-slate-400">
            Your info is shared only with this team's coaching staff.
          </p>
        </div>
      </form>
    </PortalShell>
  );
};

const Field = ({ label, className = "", children }) => (
  <label className={`block ${className}`}>
    <span className="block t-label mb-1.5">{label}</span>
    {children}
  </label>
);
