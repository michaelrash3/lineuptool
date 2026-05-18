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

const getTryoutAgeLabel = (teamAge) => {
  const n = Number.parseInt(String(teamAge || "").replace(/[^0-9]/g, ""), 10);
  if (Number.isNaN(n)) return "Next Season";
  return `${n + 1}U`;
};

const getOutfieldPositions = (tryoutAgeLabel) => {
  const n = Number.parseInt(
    String(tryoutAgeLabel || "").replace(/[^0-9]/g, ""),
    10
  );
  return !Number.isNaN(n) && n >= 9
    ? ["LF", "CF", "RF"]
    : ["LF", "LCF", "CF", "RCF"];
};

export const TryoutsPortal = () => {
  const { shareId, dateSlug } = useParams();
  const slug = (dateSlug || shareId || "").trim();
  const [phase, setPhase] = useState("loading");
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
          getDocs(query(teamsRef, where("tryoutShareId", "==", slug))),
          getDocs(query(teamsRef, where("tryoutDateSlug", "==", slug))),
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
        setForm((prev) => ({
          ...prev,
          tryoutDate: Array.isArray(data.tryoutDates) ? data.tryoutDates[0] || "" : "",
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
  }, [slug]);

  const togglePos = (pos) =>
    setForm((prev) => ({
      ...prev,
      comfortablePositions: prev.comfortablePositions.includes(pos)
        ? prev.comfortablePositions.filter((p) => p !== pos)
        : [...prev.comfortablePositions, pos],
    }));

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (!form.firstName.trim() || !form.lastName.trim()) return setError("Player first + last name are required.");
    if (!form.currentTeam.trim()) return setError("Current team is required.");
    if (!form.email.trim()) return setError("Parent email is required so we can reach you with results.");
    if (!form.phone.trim()) return setError("Parent phone number is required.");
    setError(null);

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
      setPhase("sent");
    } catch {
      setError("Submission failed — please retry, or contact the team's head coach directly.");
    }
  };

  if (phase === "loading") return <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6"><div className="text-sm font-medium text-slate-500">Loading tryouts page…</div></div>;
  if (phase === "error") return <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6"><div className="bg-white border border-rose-200 rounded-2xl p-6 max-w-md text-center shadow-md"><p className="text-sm font-bold text-rose-700">{error}</p></div></div>;
  if (phase === "sent") return <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6"><div className="bg-white border-2 rounded-2xl p-8 max-w-md text-center shadow-lg" style={{ borderColor: "var(--team-primary)" }}><h1 className="text-2xl font-black uppercase tracking-tight mb-2" style={{ color: "var(--team-primary)" }}>Thanks!</h1><p className="text-sm font-medium text-slate-700">Your signup is in. <strong>{form.firstName} {form.lastName}</strong> is registered for {team?.name || "tryouts"}. We&apos;ll reach you at <strong>{form.email}</strong> and <strong>{form.phone}</strong> with next steps.</p></div></div>;

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden">
      {team?.logoUrl && (
        <img src={team.logoUrl} alt="Team watermark" className="pointer-events-none absolute inset-0 m-auto w-[95vw] max-w-6xl opacity-[0.08]" />
      )}
      <div className="h-2 w-full" style={{ backgroundColor: "var(--team-primary)" }} />
      <div className="max-w-2xl mx-auto p-5 sm:p-8 relative z-10">
        <div className="text-center mb-6">
          {team?.logoUrl && <img src={team.logoUrl} alt={team.name} className="w-20 h-20 mx-auto mb-3 object-contain" />}
          <h1 className="text-3xl font-black uppercase tracking-tight" style={{ color: "var(--team-primary)" }}>{team?.name || "Tryouts"} {tryoutAgeLabel} Tryouts</h1>
          <p className="text-sm text-slate-600 mt-1 font-medium">{team?.currentSeason || "Next Season"} · Registering for {tryoutAgeLabel}</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white/95 rounded-2xl shadow-md border border-slate-200 p-5 sm:p-7 space-y-5">
          <h2 className="text-lg font-black uppercase tracking-tight text-slate-900">Player Info</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="First Name *"><input type="text" required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" /></Field>
            <Field label="Last Name *"><input type="text" required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" /></Field>
            <Field label="Date of Birth"><input type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" /></Field>
            <Field label="Current Team *"><input type="text" required value={form.currentTeam} onChange={(e) => setForm({ ...form, currentTeam: e.target.value })} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" /></Field>
            <Field label="Jersey Number (preferred)"><input type="text" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" /></Field>
            <Field label="Tryout Date"><input type="text" placeholder="e.g. 5-23-2026" value={form.tryoutDate} onChange={(e) => setForm({ ...form, tryoutDate: e.target.value })} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" /></Field>
            <Field label="Bats"><select value={form.bats} onChange={(e) => setForm({ ...form, bats: e.target.value })} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"><option value="R">Right</option><option value="L">Left</option><option value="S">Switch</option></select></Field>
            <Field label="Throws"><select value={form.throws} onChange={(e) => setForm({ ...form, throws: e.target.value })} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"><option value="R">Right</option><option value="L">Left</option></select></Field>
          </div>

          <Field label="Positions your player can play"><div className="flex flex-wrap gap-1.5">{positions.map((pos) => { const active = form.comfortablePositions.includes(pos); return <button key={pos} type="button" onClick={() => togglePos(pos)} className="px-2 py-1 text-[11px] font-black rounded-md border transition-all" style={active ? { backgroundColor: "var(--team-primary)", color: "var(--team-tertiary)", borderColor: "var(--team-primary)" } : { backgroundColor: "white", color: "#475569", borderColor: "#e2e8f0" }}>{pos}</button>; })}</div></Field>

          <h2 className="text-lg font-black uppercase tracking-tight text-slate-900 pt-3">Parent / Guardian</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Your Name"><input type="text" value={form.parentName} onChange={(e) => setForm({ ...form, parentName: e.target.value })} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" /></Field>
            <Field label="Email *"><input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" /></Field>
            <Field label="Phone *"><input type="tel" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" /></Field>
          </div>
          <Field label="Anything we should know?"><textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" /></Field>

          {error && <p className="text-sm font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2">{error}</p>}

          <button type="submit" className="w-full py-3 rounded-xl shadow-md font-black uppercase tracking-widest text-sm" style={{ backgroundColor: "var(--team-primary)", color: "var(--team-tertiary)" }}>Submit Signup</button>
        </form>
      </div>
    </div>
  );
};

const Field = ({ label, children }) => (
  <label className="block">
    <span className="block text-[10px] font-extrabold uppercase tracking-widest text-slate-500 mb-1">{label}</span>
    {children}
  </label>
);
