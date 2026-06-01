import React, { memo, useEffect, useMemo, useState } from "react";
import { Modal, Button } from "./shared";

// After a coach uploads a logo we extract its dominant colors (see
// extractLogoPalette in shared.tsx) and open this modal so they can say
// which of those colors should be the team's Primary, Secondary, and
// Tertiary. It pre-fills the top three extracted colors and lets the coach
// reassign any role by tapping a swatch, with a live preview of the combo.
// Manual hex editing still lives in the TeamColorPicker on the Settings
// page — this is the quick "match my logo" path, not a replacement.

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
const seedAssignments = (palette: string[], current: RoleColors): RoleColors => ({
  primaryColor: palette[0] || current.primaryColor,
  secondaryColor: palette[1] || current.secondaryColor,
  tertiaryColor: palette[2] || current.tertiaryColor,
});

export const LogoColorModal = memo(
  ({
    open,
    onClose,
    logoUrl,
    palette = [],
    current,
    onApply,
  }: {
    open: boolean;
    onClose: () => void;
    logoUrl?: string;
    palette?: string[];
    current: RoleColors;
    onApply: (colors: RoleColors) => void;
  }) => {
    const [assignments, setAssignments] = useState<RoleColors>(() =>
      seedAssignments(palette, current)
    );

    // Re-seed whenever the modal opens with a fresh palette (a new logo or a
    // manual "Pull colors" re-run) so stale picks don't linger.
    useEffect(() => {
      if (open) setAssignments(seedAssignments(palette, current));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, palette]);

    const hasPalette = palette.length > 0;

    const setRole = (key: keyof RoleColors, color: string) =>
      setAssignments((prev) => ({ ...prev, [key]: color }));

    const footer = useMemo(
      () =>
        hasPalette ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Skip
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                onApply(assignments);
                onClose();
              }}
            >
              Apply colors
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        ),
      [hasPalette, assignments, onApply, onClose]
    );

    return (
      <Modal
        open={open}
        onClose={onClose}
        eyebrow="Team Branding"
        title="Set colors from your logo"
        size="md"
        footer={footer}
      >
        {!hasPalette ? (
          <p className="leading-relaxed">
            We couldn't read distinct colors from this logo. You can set your
            team colors manually with the color pickers below.
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
      </Modal>
    );
  }
);
