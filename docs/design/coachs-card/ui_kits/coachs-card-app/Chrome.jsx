/* global React */
const { memo, useState } = React;

// Lucide icons via window.lucide.icons (the UMD bundle).
const I = (name) => (props) => {
  const node = window.lucide.icons[name];
  if (!node) return React.createElement("span", null, "?");
  const [, attrs, children] = node;
  const merged = { ...attrs, ...props };
  return React.createElement(
    "svg",
    merged,
    ...(children || []).map((c, i) =>
      React.createElement(c[0], { key: i, ...c[1] })
    )
  );
};

const Lucide = {
  Calendar: I("calendar"),
  Clipboard: I("clipboard"),
  Settings: I("settings"),
  Users: I("users"),
  UserPlus: I("user-plus"),
  Edit: I("edit"),
  Plus: I("plus"),
  Check: I("check"),
  X: I("x"),
  Clock: I("clock"),
  FileText: I("file-text"),
  Cloud: I("cloud"),
  Refresh: I("refresh-cw"),
  ChevronRight: I("chevron-right"),
  ChevronLeft: I("chevron-left"),
};

const BaseballIcon = ({ name, className, style }) => (
  <img
    src={`../../assets/iconography/${name}.svg`}
    className={className}
    style={style}
    alt={name}
  />
);

// ───────────────────────────────────────────────────────────── LoginScreen
const LoginScreen = ({ onSignIn }) => {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-6 border-t-8 bg-slate-50 relative"
      style={{ borderColor: "#2563eb" }}
    >
      <div
        className="fixed inset-0 z-0 pointer-events-none"
        style={{
          backgroundImage: "url(../../assets/baseball-mark.svg)",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          backgroundSize: "40%",
          opacity: 0.15,
        }}
      />
      <div className="bg-white/40 p-10 shadow-2xl max-w-sm w-full text-center rounded-2xl border border-white/50 relative z-10">
        <div className="flex justify-center mb-6">
          <div className="p-4 rounded-full bg-white border border-white/40 shadow-sm">
            <Lucide.Clipboard
              width="40"
              height="40"
              style={{ color: "#2563eb" }}
            />
          </div>
        </div>
        <h1 className="text-3xl font-black mb-2 uppercase tracking-tight text-slate-900">
          Lineup Generator
        </h1>
        <p className="text-slate-500 mb-8 text-sm font-bold uppercase tracking-wider">
          Authentication Required
        </p>
        <button
          onClick={onSignIn}
          className="w-full py-4 px-4 font-black uppercase tracking-wider flex items-center justify-center gap-3 transition-all rounded-xl shadow-lg hover:shadow-xl hover:-translate-y-0.5 text-white"
          style={{ backgroundColor: "#2563eb" }}
        >
          <Lucide.Users width="20" height="20" /> Sign In with Google
        </button>
      </div>
    </div>
  );
};

// ───────────────────────────────────────────────────────────── AppHeader
const AppHeader = memo(({ team, record }) => (
  <header className="w-full relative z-20 bg-white/40 shadow-[0_4px_20px_rgb(0,0,0,0.04)]">
    <div className="h-1.5 w-full" style={{ backgroundColor: team.primaryColor }} />
    <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-5">
        <img src={team.logoUrl} alt="" className="w-16 h-16 object-contain p-1" />
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black uppercase tracking-tight leading-none text-slate-900">
              {team.name}
            </h1>
            <span
              className="text-[11px] font-black uppercase tracking-widest px-3 py-1 rounded-lg shadow-sm border border-white/50 tabular-nums"
              style={{ backgroundColor: team.primaryColor, color: team.tertiaryColor }}
            >
              {record.wins}-{record.losses}
            </span>
          </div>
          <p className="text-xs uppercase tracking-widest font-extrabold mt-1 text-slate-500">
            Head Coach Dashboard
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <select className="p-3 text-sm font-black uppercase tracking-wider cursor-pointer rounded-xl bg-white/20 hover:bg-white border border-slate-200 shadow-sm">
          <option>{team.name}</option>
        </select>
        <button className="text-xs py-3 px-5 flex items-center gap-2 font-black uppercase tracking-wider rounded-xl border-2 bg-white/20 hover:bg-white border-slate-200 text-slate-700 shadow-sm">
          <Lucide.Clipboard width="16" height="16" /> Team Code
        </button>
      </div>
    </div>
    <div className="bg-slate-900/85 text-white relative z-10 border-b border-slate-900 shadow-inner">
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex gap-2">
          <button className="text-xs bg-slate-700/80 hover:bg-slate-600 py-2 px-4 flex items-center gap-2 font-extrabold uppercase tracking-wider rounded-lg">
            <Lucide.Plus width="14" height="14" /> New Team
          </button>
          <button className="text-xs bg-slate-700/80 hover:bg-slate-600 py-2 px-4 flex items-center gap-2 font-extrabold uppercase tracking-wider rounded-lg">
            <Lucide.Users width="14" height="14" /> Join Team
          </button>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-300">
          <Lucide.Cloud width="12" height="12" style={{ color: "#4ade80" }} /> Saved
        </div>
      </div>
    </div>
  </header>
));

// ───────────────────────────────────────────────────────────── TabBarNav
const TabBarNav = ({ team, activeTab, setActiveTab, tabs }) => (
  <div className="bg-white/30 border-b border-white/40 relative z-10 shadow-sm">
    <div className="max-w-7xl mx-auto px-6 pt-4">
      <div className="flex gap-2 pb-4">
        {tabs.map((btn) => {
          const isActive = activeTab === btn.id;
          return (
            <button
              key={btn.id}
              onClick={() => setActiveTab(btn.id)}
              className={`py-2.5 px-5 font-extrabold text-xs uppercase tracking-wider flex items-center gap-2 rounded-full transition-all duration-200 border ${
                isActive ? "shadow-sm" : "text-slate-600 hover:bg-white/80 hover:text-slate-900 border-transparent"
              } ${btn.id === "settings" ? "ml-auto" : ""}`}
              style={
                isActive
                  ? { backgroundColor: team.secondaryColor, color: team.primaryColor, borderColor: team.primaryColor }
                  : {}
              }
            >
              {btn.icon ? <btn.icon width="16" height="16" /> : null}
              {btn.label}
            </button>
          );
        })}
      </div>
    </div>
  </div>
);

window.CCApp = { LoginScreen, AppHeader, TabBarNav, Lucide, BaseballIcon };
