import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  updateDoc,
  arrayUnion,
} from "firebase/firestore";
import { signInAnonymously } from "firebase/auth";
import { db, appId, auth } from "../firebase";

const POSITIONS = [
  "P",
  "C",
  "1B",
  "2B",
  "3B",
  "SS",
  "LF",
  "LCF",
  "CF",
  "RCF",
  "RF",
];

// Public form. Looks up the team by `tryoutShareId`, applies the team's
// theme colors to CSS vars, and submits the parent-filled signup back
// to the team document via Firestore.
//
// Anonymous sign-in is attempted on mount so the write call carries an
// auth UID — this requires the Firebase project to have Anonymous Auth
// enabled. Without it the write may be rejected by rules; the form
// surfaces a clear error in that case.
export const TryoutsPortal = () => {
  const { shareId } = useParams();
  const [phase, setPhase] = useState("loading"); // loading | form | sent | error
  const [team, setTeam] = useState(null);
  const [teamDocId, setTeamDocId] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    dob: "",
    number: "",
    bats: "R",
    throws: "R",
    comfortablePositions: [],
    isCatcher: false,
    parentName: "",
    email: "",
    phone: "",
    notes: "",
  });

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        await signInAnonymously(auth);
      } catch {
        // Anonymous auth might not be enabled — proceed without it
        // (Firestore rules may still allow the read/write depending on
        // project config).
      }
      try {
        const q = query(
          collection(db, "artifacts", appId, "public", "data", "teams"),
          where("tryoutShareId", "==", shareId)
        );
        const snap = await getDocs(q);
        if (cancelled) return;
        if (snap.empty) {
          setError("Tryouts link not found or has been deactivated.");
          setPhase("error");
          return;
        }
        const docRef = snap.docs[0];
        const data = docRef.data();
        if (data.tryoutsOpen === false) {
          setError("Tryouts are closed for this team.");
          setPhase("error");
          return;
        }
        setTeam(data);
        setTeamDocId(docRef.id);
        // Theme the page from the team's colors.
        const root = document.documentElement;
        if (data.primaryColor)
          root.style.setProperty("--team-primary", data.primaryColor);
        if (data.secondaryColor)
          root.style.setProperty("--team-secondary", data.secondaryColor);
        if (data.tertiaryColor)
          root.style.setProperty("--team-tertiary", data.tertiaryColor);
        setPhase("form");
      } catch (err) {
        setError(
          "Couldn't load this team's tryouts page. The link may be invalid or your network may be down."
        );
        setPhase("error");
      }
    };
    init();
    return () => {
      cancelled = true;
    };
  }, [shareId]);

  const togglePos = (pos) =>
    setForm((prev) => ({
      ...prev,
      comfortablePositions: prev.comfortablePositions.includes(pos)
        ? prev.comfortablePositions.filter((p) => p !== pos)
        : [...prev.comfortablePositions, pos],
    }));

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setError("Player first + last name are required.");
      return;
    }
    if (!form.email.trim()) {
      setError("Parent email is required so we can reach you with results.");
      return;
    }
    setError(null);
    const signup = {
      id: "ts-" + Math.random().toString(36).slice(2, 10),
      submittedAt: new Date().toISOString(),
      status: "tryout",
      ...form,
    };
    try {
      await updateDoc(
        doc(db, "artifacts", appId, "public", "data", "teams", teamDocId),
        {
          tryoutSignups: arrayUnion(signup),
        }
      );
      setPhase("sent");
    } catch (err) {
      setError(
        "Submission failed — please retry, or contact the team's head coach directly."
      );
    }
  };

  if (phase === "loading") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-sm font-medium text-slate-500">
          Loading tryouts page…
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-rose-200 rounded-2xl p-6 max-w-md text-center shadow-md">
          <p className="text-sm font-bold text-rose-700">{error}</p>
        </div>
      </div>
    );
  }

  if (phase === "sent") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div
          className="bg-white border-2 rounded-2xl p-8 max-w-md text-center shadow-lg"
          style={{ borderColor: "var(--team-primary)" }}
        >
          <h1
            className="text-2xl font-black uppercase tracking-tight mb-2"
            style={{ color: "var(--team-primary)" }}
          >
            Thanks!
          </h1>
          <p className="text-sm font-medium text-slate-700">
            Your signup is in.{" "}
            <strong>
              {form.firstName} {form.lastName}
            </strong>{" "}
            is registered for {team?.name || "tryouts"}. We&apos;ll reach
            you at <strong>{form.email}</strong> with next steps.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div
        className="h-2 w-full"
        style={{ backgroundColor: "var(--team-primary)" }}
      />
      <div className="max-w-2xl mx-auto p-5 sm:p-8">
        <div className="text-center mb-6">
          {team?.logoUrl && (
            <img
              src={team.logoUrl}
              alt={team.name}
              className="w-20 h-20 mx-auto mb-3 object-contain"
            />
          )}
          <h1
            className="text-3xl font-black uppercase tracking-tight"
            style={{ color: "var(--team-primary)" }}
          >
            {team?.name || "Tryouts"}
          </h1>
          <p className="text-sm text-slate-600 mt-1 font-medium">
            {team?.currentSeason || ""} · {team?.teamAge || ""} ·{" "}
            {team?.pitchingFormat || ""}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl shadow-md border border-slate-200 p-5 sm:p-7 space-y-5"
        >
          <h2 className="text-lg font-black uppercase tracking-tight text-slate-900">
            Player Info
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="First Name *">
              <input
                type="text"
                required
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
              />
            </Field>
            <Field label="Last Name *">
              <input
                type="text"
                required
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
              />
            </Field>
            <Field label="Date of Birth">
              <input
                type="date"
                value={form.dob}
                onChange={(e) => setForm({ ...form, dob: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
              />
            </Field>
            <Field label="Jersey Number (preferred)">
              <input
                type="text"
                value={form.number}
                onChange={(e) => setForm({ ...form, number: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
              />
            </Field>
            <Field label="Bats">
              <select
                value={form.bats}
                onChange={(e) => setForm({ ...form, bats: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
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
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="R">Right</option>
                <option value="L">Left</option>
              </select>
            </Field>
          </div>

          <Field label="Positions your player can play">
            <div className="flex flex-wrap gap-1.5">
              {POSITIONS.map((pos) => {
                const active = form.comfortablePositions.includes(pos);
                return (
                  <button
                    key={pos}
                    type="button"
                    onClick={() => togglePos(pos)}
                    className="px-2 py-1 text-[11px] font-black rounded-md border transition-all"
                    style={
                      active
                        ? {
                            backgroundColor: "var(--team-primary)",
                            color: "var(--team-tertiary)",
                            borderColor: "var(--team-primary)",
                          }
                        : {
                            backgroundColor: "white",
                            color: "#475569",
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

          <label className="flex items-start gap-3 bg-slate-50 border border-slate-200 p-3 rounded-lg">
            <input
              type="checkbox"
              checked={form.isCatcher}
              onChange={(e) =>
                setForm({ ...form, isCatcher: e.target.checked })
              }
              className="mt-0.5 w-4 h-4 accent-emerald-600"
            />
            <span className="text-xs font-bold text-slate-800">
              My player is part of the catching rotation
            </span>
          </label>

          <h2 className="text-lg font-black uppercase tracking-tight text-slate-900 pt-3">
            Parent / Guardian
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Your Name">
              <input
                type="text"
                value={form.parentName}
                onChange={(e) =>
                  setForm({ ...form, parentName: e.target.value })
                }
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
              />
            </Field>
            <Field label="Email *">
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
              />
            </Field>
            <Field label="Phone">
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
              />
            </Field>
          </div>

          <Field label="Anything we should know?">
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
            />
          </Field>

          {error && (
            <p className="text-sm font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="w-full py-3 rounded-xl shadow-md font-black uppercase tracking-widest text-sm"
            style={{
              backgroundColor: "var(--team-primary)",
              color: "var(--team-tertiary)",
            }}
          >
            Submit Signup
          </button>
        </form>

        <p className="text-[10px] text-slate-400 text-center mt-4 font-medium">
          Submitting sends your info directly to the team&apos;s coaches.
        </p>
      </div>
    </div>
  );
};

const Field = ({ label, children }) => (
  <label className="block">
    <span className="block text-[10px] font-extrabold uppercase tracking-widest text-slate-500 mb-1">
      {label}
    </span>
    {children}
  </label>
);
