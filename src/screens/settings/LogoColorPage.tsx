import React, { memo, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useTeam } from "../../contexts";
import { PageShell } from "../../components/PageShell";
import { useBackOrFallback } from "../../hooks/usePageNav";
import { Button } from "../../components/shared";

// /settings/logo-colors — after a coach uploads a logo we extract its
// dominant colors (see extractLogoPalette in shared.tsx) and Settings
// navigates here so they can say which of those colors should be the team's
// Primary, Secondary, and Tertiary. A routed page per the app-wide
// modals→pages rule. The palette travels via navigation state (it's
// ephemeral extraction output, not addressable data), so a refresh or cold
// deep link bounces back to Settings where the upload lives. Manual hex
// editing still lives in the TeamColorPicker on the Settings page — this is
// the quick "match my logo" path, not a replacement.

type RoleColors = {
  primaryColor: string;
  secondaryColor: string;
  tertiaryColor: string;
};

const ROLES: { key: keyof RoleColors; label: string }[] = [
  { key: "primaryColor", label: "Primary" },
  { key: "secondaryColor", label: "Secondary" },
  { key: "tertiaryColor", label: "Tertiary" },
];

// Pre-fill each role from the extracted palette, falling back to the team's
// current value whenever the logo yielded fewer than three colors.
const seedAssignments = (
  palette: string[],
  current: RoleColors,
): RoleColors => ({
  primaryColor: palette[0] || current.primaryColor,
  secondaryColor: palette[1] || current.secondaryColor,
  tertiaryColor: palette[2] || current.tertiaryColor,
});

export const LogoColorPage = memo(() => {
  const { team, currentRole, updateTeam } = useTeam();
  const location = useLocation();
  const back = useBackOrFallback("/settings");
  const payload = (location.state || null) as { palette?: string[] } | null;
  const palette =
    payload && Array.isArray(payload.palette) ? payload.palette : null;

  const { primaryColor, secondaryColor, tertiaryColor, logoUrl } = team;
  const [assignments, setAssignments] = useState<RoleColors>(() =>
    seedAssignments(palette || [], {
      primaryColor,
      secondaryColor,
      tertiaryColor,
    }),
  );

  // No payload = refresh / cold deep link; the extraction output is gone, so
  // bounce back to Settings where the logo upload and "Pull colors" live.
  if (!palette) {
    return <Navigate to="/settings" replace />;
  }
  if (currentRole === "assistant") {
    return <Navigate to="/" replace />;
  }

  // An empty palette is still a real arrival: the manual "Pull colors"
  // trigger navigates here even when extraction found nothing distinct.
  const hasPalette = palette.length > 0;

  const setRole = (key: keyof RoleColors, color: string) =>
    setAssignments((prev) => ({ ...prev, [key]: color }));

  const apply = () => {
    updateTeam(assignments);
    back();
  };

  return (
    <PageShell
      eyebrow="Team Branding"
      title="Set colors from your logo"
      onBack={back}
    >
      <div className="cc-card p-5">
        {!hasPalette ? (
          <p className="t-body leading-relaxed">
            We couldn't read distinct colors from this logo. You can set your
            team colors manually with the color pickers on the Settings page.
          </p>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              {logoUrl && (
                <img
                  src={logoUrl}
                  alt="Logo"
                  className="w-14 h-14 object-contain bg-surface border border-line p-1.5 rounded-xl shadow-sm shrink-0"
                />
              )}
              <p className="text-xs text-ink-3 font-medium leading-relaxed">
                Pick which logo color is your Primary, Secondary, and Tertiary.
                Tap a swatch to assign it.
              </p>
            </div>

            <div className="space-y-3">
              {ROLES.map(({ key, label }) => (
                <div key={key}>
                  <span className="block text-[9px] font-black text-ink-3 uppercase tracking-widest mb-1.5">
                    {label}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    {palette.map((color) => {
                      const selected =
                        assignments[key].toLowerCase() === color.toLowerCase();
                      return (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setRole(key, color)}
                          aria-label={`Use ${color} for ${label}`}
                          aria-pressed={selected}
                          title={color}
                          className={`w-8 h-8 rounded-full border-2 shadow-sm transition-transform hover:-translate-y-0.5 ${
                            selected
                              ? "ring-2 ring-offset-2 ring-[var(--team-primary)] border-white"
                              : "border-white"
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      );
                    })}
                    <span className="ml-1 text-[10px] font-mono uppercase text-ink-3">
                      {assignments[key]}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Live Preview — mirrors the cluster on the Settings page so the
                coach sees the chosen combo before applying. */}
            <div className="flex flex-wrap items-center gap-3 bg-surface p-3 border border-line rounded-xl shadow-sm">
              <span className="text-[9px] font-black text-ink-3 uppercase tracking-widest mr-1">
                Live Preview
              </span>
              <span
                className="text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg shadow-sm tabular-nums"
                style={{
                  backgroundColor: assignments.primaryColor,
                  color: assignments.tertiaryColor,
                }}
              >
                8-3
              </span>
              <span
                className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-md border"
                style={{
                  backgroundColor: assignments.secondaryColor,
                  color: assignments.primaryColor,
                  borderColor: assignments.primaryColor,
                }}
              >
                Today
              </span>
              <span
                className="text-[11px] px-4 py-2 font-black uppercase tracking-widest rounded-xl shadow-md"
                style={{
                  backgroundColor: assignments.primaryColor,
                  color: assignments.tertiaryColor,
                }}
              >
                Primary Button
              </span>
            </div>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          {hasPalette ? (
            <>
              <Button variant="secondary" onClick={back}>
                Skip
              </Button>
              <Button variant="primary" onClick={apply}>
                Apply colors
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={back}>
              Close
            </Button>
          )}
        </div>
      </div>
    </PageShell>
  );
});
