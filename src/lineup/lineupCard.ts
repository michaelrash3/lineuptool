// Lineup card generator. buildLineupCanvas renders a self-contained
// portrait-oriented HTMLCanvasElement showing defense + batting + game info.
// Two thin wrappers expose it as a PNG blob (for image sharing) and as a PDF
// blob (for emailing/texting a fixed-format document — browser print is
// inconsistent across devices).

import { Game, SlimPlayer, Team, Toast } from "../types";
import { isGameFinalized } from "../utils/helpers";

// Compute the team's W-L-T record from finalized games, for the share
// card header. Uses the shared isGameFinalized() so it matches the
// record badge shown elsewhere in the app (a game with a saved score
// but no "final" status still counts; future games don't).
const computeRecord = (team?: Team | null): string | null => {
  const games = team?.games;
  if (!Array.isArray(games)) return null;
  let w = 0;
  let l = 0;
  let t = 0;
  for (const g of games) {
    if (!isGameFinalized(g)) continue;
    const ts = Number(g.teamScore);
    const os = Number(g.opponentScore);
    if (!Number.isFinite(ts) || !Number.isFinite(os)) continue;
    if (ts > os) w += 1;
    else if (ts < os) l += 1;
    else t += 1;
  }
  if (w + l + t === 0) return null;
  return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
};

interface RenderArgs {
  game: Game;
  team?: Team | null;
  formatDate: (s: string) => string;
}

interface DownloadArgs extends RenderArgs {
  toast?: Toast;
}

// Off-DOM image loader with CORS attribute set. Today every photoUrl is an
// inline data URL (no CORS to worry about), but legacy Cloud Storage URLs
// from earlier releases still serve with CORS headers, so the attribute is
// kept for backward compatibility. Resolves null on any error so we silently
// fall back to initials.
const loadImage = (url: string): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });

// Walk the game's defense and batting lineups, look up each unique player's
// photoUrl in the team roster, and preload them all in parallel. Returns a
// Map<playerId, HTMLImageElement> for use inside buildLineupCanvas.
const preloadPhotos = async (
  game: Game,
  team?: Team | null
): Promise<Map<string, HTMLImageElement>> => {
  const ids = new Set<string>();
  for (const inn of game.lineup || []) {
    if (!inn) continue;
    for (const key of Object.keys(inn)) {
      const v = inn[key];
      if (Array.isArray(v)) {
        v.forEach((p) => p && ids.add(p.id));
      } else if (v) {
        ids.add(v.id);
      }
    }
  }
  for (const p of game.battingLineup || []) {
    if (p) ids.add(p.id);
  }
  const playerById = new Map<string, { id: string; photoUrl?: string }>();
  for (const p of team?.players || []) {
    if (p && typeof p.id === "string") {
      playerById.set(p.id, p as unknown as { id: string; photoUrl?: string });
    }
  }
  const out = new Map<string, HTMLImageElement>();
  await Promise.all(
    Array.from(ids).map(async (id) => {
      const url = playerById.get(id)?.photoUrl;
      if (!url) return;
      const img = await loadImage(url);
      if (img) out.set(id, img);
    })
  );
  return out;
};

// Draw an avatar circle: photo if available, initials over a colored fill
// otherwise. The cx/cy are circle center; radius defines the diameter.
const drawAvatar = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  player: SlimPlayer | { id?: string; name?: string } | undefined,
  photo: HTMLImageElement | undefined,
  fillColor: string
) => {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.closePath();
  if (photo) {
    ctx.clip();
    // Cover fit
    const ratio = Math.max(
      (radius * 2) / photo.width,
      (radius * 2) / photo.height
    );
    const w = photo.width * ratio;
    const h = photo.height * ratio;
    ctx.drawImage(photo, cx - w / 2, cy - h / 2, w, h);
  } else {
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = `900 ${Math.max(8, radius * 0.9)}px system-ui, -apple-system, Segoe UI, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const name = player?.name || "?";
    const parts = name.trim().split(/\s+/);
    const initials =
      parts.length === 1
        ? parts[0].slice(0, 2).toUpperCase()
        : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    ctx.fillText(initials, cx, cy + 0.5);
  }
  ctx.restore();
};

// Internal canvas-build args carry the preloaded photo map.
interface CanvasArgs extends RenderArgs {
  photos: Map<string, HTMLImageElement>;
}

const PITCH_LIMITS: Record<string, number> = {
  "6U": 50,
  "7U": 50,
  "8U": 50,
  "9U": 75,
  "10U": 75,
  "11U to 12U": 85,
  "13U to 14U": 95,
  "15U to 18U": 105,
};

const buildLineupCanvasInternal = ({
  game,
  team,
  formatDate,
  photos,
}: CanvasArgs): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const ratio = window.devicePixelRatio || 1;

  // This file only ever indexes lineups by position string (never by BENCH),
  // so retype to a simple Record for cleaner narrowing through the function.
  const lineup = (game.lineup || []) as Array<Record<string, SlimPlayer | undefined>>;
  const battingLineup = game.battingLineup || [];
  const totalInnings = lineup.length;

  // Determine which positions are present in this game (skip ones never used).
  const allPositions = ["P", "C", "1B", "2B", "3B", "SS", "LF", "LCF", "CF", "RCF", "RF"];
  const presentPositions = allPositions.filter((pos) =>
    lineup.some((inn) => inn && inn[pos])
  );

  // ---- Compute width based on longest name in any cell ----
  ctx.font = "600 11px system-ui, -apple-system, Segoe UI, sans-serif";
  let maxNameW = 40;
  for (const inn of lineup) {
    if (!inn) continue;
    for (const pos of presentPositions) {
      const player = inn[pos];
      if (player?.name) {
        const w = ctx.measureText(player.name).width;
        if (w > maxNameW) maxNameW = w;
      }
    }
  }
  const inningColW = Math.ceil(maxNameW + 12);
  const PAD = 24;
  const labelColW = 64;
  const minW = 600;
  const maxW = 1100;
  let W = PAD * 2 + labelColW + inningColW * Math.max(totalInnings, 1);
  W = Math.max(minW, Math.min(maxW, W));

  // If we hit the cap, recompute inningColW so cells fit evenly within W.
  const usableW = W - PAD * 2 - labelColW;
  const finalInningColW = usableW / Math.max(totalInnings, 1);

  // ---- Compute layout (top-down) ----
  // Any batter with a `battingReason` adds a second 11px line under the
  // primary name row. Pre-detect so we can size the section correctly.
  const hasAnyReason = battingLineup.some(
    (p) => p && (p as SlimPlayer & { battingReason?: { role?: string; note?: string } }).battingReason
  );

  // Pitcher footer: list each pitcher used in the game with their inning
  // appearances + recent-pitch / limit status. Only renders on Kid Pitch.
  const isKidPitch =
    typeof team?.pitchingFormat === "string" &&
    team.pitchingFormat.toLowerCase().includes("kid");
  const pitcherEntries: Array<{
    player: NonNullable<SlimPlayer>;
    innings: number[];
    limit: number;
    recent: number;
  }> = [];
  if (isKidPitch) {
    const ageGroup = (typeof team?.teamAge === "string" && team.teamAge) || "";
    const limit = PITCH_LIMITS[ageGroup] ?? 105;
    const byId = new Map<string, { player: NonNullable<SlimPlayer>; innings: number[] }>();
    lineup.forEach((inn, idx) => {
      const p = inn?.P;
      if (p && !Array.isArray(p)) {
        const cur = byId.get(p.id);
        if (cur) cur.innings.push(idx + 1);
        else byId.set(p.id, { player: p, innings: [idx + 1] });
      }
    });
    for (const entry of byId.values()) {
      const rosterP = (team?.players || []).find((rp) => rp.id === entry.player.id) as
        | { pitching?: { recentPitches?: number } }
        | undefined;
      pitcherEntries.push({
        player: entry.player,
        innings: entry.innings,
        limit,
        recent: rosterP?.pitching?.recentPitches || 0,
      });
    }
  }
  const pitcherRowH = 22;
  const pitcherSectionTitleH = pitcherEntries.length > 0 ? 28 : 0;
  const pitcherSectionH =
    pitcherEntries.length > 0
      ? pitcherSectionTitleH + pitcherRowH * pitcherEntries.length
      : 0;

  const headerH = 100;
  const sectionTitleH = 36;
  const cellH = 38;
  const defenseH = sectionTitleH + cellH * (presentPositions.length + 1);
  const battingRowH = hasAnyReason ? 44 : 32;
  const battingH = sectionTitleH + battingRowH * battingLineup.length;
  const footerH = 28;
  const H =
    headerH +
    defenseH +
    pitcherSectionH +
    battingH +
    footerH +
    PAD * 4 +
    (pitcherSectionH > 0 ? PAD : 0);

  canvas.width = W * ratio;
  canvas.height = H * ratio;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  ctx.scale(ratio, ratio);

  // ---- Background ----
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, W, H);

  // ---- Header band (team color) ----
  const primary = team?.primaryColor || "#1e293b";
  const tertiary = team?.tertiaryColor || "#ffffff";
  ctx.fillStyle = primary;
  ctx.fillRect(0, 0, W, headerH);
  ctx.fillStyle = tertiary;
  ctx.font = "900 22px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText((team?.name || "TEAM").toUpperCase(), PAD, 18);
  ctx.font = "700 14px system-ui, -apple-system, Segoe UI, sans-serif";
  const opp = (game.opponent || "OPPONENT").toUpperCase();
  ctx.fillText(`VS ${opp}`, PAD, 48);
  // Big Game star in the header so the shared card flags the stakes.
  if (game.isBigGame) {
    ctx.font = "700 13px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.fillText("★ BIG GAME", PAD, 72);
  }

  // Right column: season (top), record (middle, bold), date•time (bottom).
  // Each line is right-aligned against the header's right padding.
  const rightLine = (text: string, y: number, font: string) => {
    if (!text) return;
    ctx.font = font;
    const tw = ctx.measureText(text).width;
    ctx.fillText(text, W - PAD - tw, y);
  };
  const season = String(team?.currentSeason || "").toUpperCase();
  rightLine(season, 20, "600 12px system-ui, -apple-system, Segoe UI, sans-serif");
  const record = computeRecord(team);
  if (record) {
    rightLine(
      `RECORD ${record}`,
      42,
      "800 15px system-ui, -apple-system, Segoe UI, sans-serif"
    );
  }
  const dateStr = game.date ? formatDate(game.date) : "";
  const timeStr = game.time || "";
  const dateTime = [dateStr, timeStr].filter(Boolean).join(" • ");
  rightLine(
    dateTime,
    record ? 68 : 46,
    "600 12px system-ui, -apple-system, Segoe UI, sans-serif"
  );

  // ---- Defense section ----
  let y = headerH + PAD;
  ctx.fillStyle = "#0f172a";
  ctx.font = "900 14px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.fillText("DEFENSIVE LINEUP", PAD, y);
  y += sectionTitleH;

  ctx.fillStyle = "#64748b";
  ctx.font = "800 11px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("POS", PAD + labelColW / 2, y + 12);
  for (let i = 0; i < totalInnings; i++) {
    const x = PAD + labelColW + i * finalInningColW + finalInningColW / 2;
    ctx.fillText(`I${i + 1}`, x, y + 12);
  }
  y += cellH;

  for (let r = 0; r < presentPositions.length; r++) {
    const pos = presentPositions[r];
    if (r % 2 === 0) {
      ctx.fillStyle = "#f1f5f9";
      ctx.fillRect(PAD, y, W - PAD * 2, cellH);
    }
    ctx.fillStyle = primary;
    ctx.font = "900 12px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(pos, PAD + labelColW / 2, y + cellH / 2 - 6);
    ctx.fillStyle = "#0f172a";
    ctx.font = "600 11px system-ui, -apple-system, Segoe UI, sans-serif";
    for (let i = 0; i < totalInnings; i++) {
      const player = lineup[i]?.[pos];
      const x = PAD + labelColW + i * finalInningColW + finalInningColW / 2;
      let drawText = player?.name ? player.name : "—";
      const maxCellW = finalInningColW - 6;
      if (ctx.measureText(drawText).width > maxCellW) {
        const parts = drawText.split(/\s+/);
        if (parts.length >= 2) {
          drawText = `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
        }
        while (drawText.length > 1 && ctx.measureText(drawText + "…").width > maxCellW) {
          drawText = drawText.slice(0, -1);
        }
        if (ctx.measureText(drawText).width > maxCellW) {
          drawText += "…";
        }
      }
      ctx.fillText(drawText, x, y + cellH / 2 - 5);
    }
    y += cellH;
  }
  y += PAD;

  // ---- Pitcher rotation section (Kid Pitch only) ----
  if (pitcherEntries.length > 0) {
    ctx.textAlign = "left";
    ctx.fillStyle = "#0f172a";
    ctx.font = "900 14px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.fillText("PITCHING PLAN", PAD, y);
    y += pitcherSectionTitleH;

    for (let i = 0; i < pitcherEntries.length; i++) {
      const pe = pitcherEntries[i];
      if (i % 2 === 0) {
        ctx.fillStyle = "#f1f5f9";
        ctx.fillRect(PAD, y, W - PAD * 2, pitcherRowH);
      }
      ctx.fillStyle = "#0f172a";
      ctx.font = "800 11.5px system-ui, -apple-system, Segoe UI, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(pe.player.name, PAD + 12, y + pitcherRowH / 2 + 4);

      ctx.fillStyle = "#64748b";
      ctx.font = "600 10.5px system-ui, -apple-system, Segoe UI, sans-serif";
      const innLabel = `Inn ${pe.innings.join(", ")}`;
      ctx.fillText(innLabel, PAD + 180, y + pitcherRowH / 2 + 4);

      // Remaining pitch budget (limit minus recent).
      const remaining = Math.max(0, pe.limit - pe.recent);
      const budgetText = `${remaining}/${pe.limit} avail`;
      ctx.fillStyle = remaining > pe.limit * 0.5 ? "#047857" : remaining > 0 ? "#b45309" : "#b91c1c";
      ctx.font = "800 10.5px system-ui, -apple-system, Segoe UI, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(budgetText, W - PAD - 8, y + pitcherRowH / 2 + 4);

      y += pitcherRowH;
    }
    y += PAD;
  }

  // ---- Batting section ----
  ctx.textAlign = "left";
  ctx.fillStyle = "#0f172a";
  ctx.font = "900 14px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.fillText("BATTING ORDER", PAD, y);
  y += sectionTitleH;

  const photoR = hasAnyReason ? 14 : 12;
  const photoCx = PAD + 50;
  const nameStartX = PAD + 50 + photoR + 10;
  for (let i = 0; i < battingLineup.length; i++) {
    const player = battingLineup[i] as
      | (SlimPlayer & { battingReason?: { role?: string; note?: string } })
      | undefined;
    if (i % 2 === 0) {
      ctx.fillStyle = "#f1f5f9";
      ctx.fillRect(PAD, y, W - PAD * 2, battingRowH);
    }
    ctx.fillStyle = primary;
    ctx.font = "900 13px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    const nameY = hasAnyReason ? y + 13 : y + battingRowH / 2 - 5;
    ctx.fillText(`${i + 1}`, PAD + 18, nameY);
    // Avatar: photo if available, otherwise initials-on-primary medallion.
    if (player) {
      drawAvatar(
        ctx,
        photoCx,
        y + battingRowH / 2,
        photoR,
        player,
        photos.get(player.id),
        primary
      );
    }
    ctx.fillStyle = "#0f172a";
    ctx.font = "700 13px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(player?.name || "—", nameStartX, nameY);
    if (player?.number) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = "700 11px system-ui, -apple-system, Segoe UI, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(`#${player.number}`, W - PAD - 8, nameY + 1);
    }
    // Second-line reasoning: italicized role + note. Empty rows still get
    // the height so striping stays consistent.
    if (hasAnyReason) {
      const reason = player?.battingReason;
      if (reason && (reason.role || reason.note)) {
        ctx.fillStyle = "#64748b";
        ctx.font = "italic 600 10.5px system-ui, -apple-system, Segoe UI, sans-serif";
        ctx.textAlign = "left";
        const why = [reason.role, reason.note].filter(Boolean).join(" — ");
        const maxW = W - PAD - nameStartX - 60; // leave room for jersey number
        let trimmed = why;
        if (ctx.measureText(trimmed).width > maxW) {
          while (
            trimmed.length > 1 &&
            ctx.measureText(trimmed + "…").width > maxW
          ) {
            trimmed = trimmed.slice(0, -1);
          }
          trimmed = trimmed + "…";
        }
        ctx.fillText(trimmed, nameStartX, y + 30);
      }
    }
    y += battingRowH;
  }

  // ---- Footer ----
  ctx.textAlign = "left";
  ctx.fillStyle = "#94a3b8";
  ctx.font = "600 10px system-ui, -apple-system, Segoe UI, sans-serif";
  const stamp = `Generated ${new Date().toLocaleString()}`;
  ctx.fillText(stamp, PAD, H - footerH / 2);

  return canvas;
};

// Public-facing canvas builder. Preloads any player photos (best effort)
// then renders. Async because Image() loads are async; falls back to
// initials on any photo load failure.
export const buildLineupCanvas = async ({
  game,
  team,
  formatDate,
}: RenderArgs): Promise<HTMLCanvasElement> => {
  const photos = await preloadPhotos(game, team);
  return buildLineupCanvasInternal({ game, team, formatDate, photos });
};

// PNG blob wrapper — canonical "render" for image-share flows.
export const renderLineupCard = async ({ game, team, formatDate }: RenderArgs): Promise<Blob | null> => {
  const canvas = await buildLineupCanvas({ game, team, formatDate });
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
};

// PDF blob wrapper. Embeds the canvas as a single-page PDF sized to the
// canvas dimensions (in points), so the document renders identically across
// devices and email clients without browser print quirks. jspdf is loaded
// lazily so it only enters the bundle when a coach actually downloads a PDF.
export const renderLineupPdf = async ({ game, team, formatDate }: RenderArgs): Promise<Blob> => {
  const { jsPDF } = await import("jspdf");
  const canvas = await buildLineupCanvas({ game, team, formatDate });
  const wPt = parseFloat(canvas.style.width) || canvas.width;
  const hPt = parseFloat(canvas.style.height) || canvas.height;
  const pdf = new jsPDF({
    unit: "pt",
    format: [wPt, hPt],
    orientation: hPt >= wPt ? "portrait" : "landscape",
    compress: true,
  });
  pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, wPt, hPt, undefined, "FAST");
  return pdf.output("blob");
};

export const downloadLineupPdf = async ({ game, team, formatDate, toast }: DownloadArgs): Promise<void> => {
  try {
    const blob = await renderLineupPdf({ game, team, formatDate });
    const filename = `lineup-${game.opponent || "game"}-${game.date || "card"}.pdf`
      .replace(/\s+/g, "-")
      .toLowerCase();
    const file = new File([blob], filename, { type: "application/pdf" });

    const nav = navigator as unknown as {
      share?: (data: { files: File[]; title?: string; text?: string }) => Promise<void>;
      canShare?: (data: { files: File[] }) => boolean;
    };
    if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
      try {
        await nav.share!({
          files: [file],
          title: `Lineup vs ${game.opponent || "Game"}`,
          text: `Lineup vs ${game.opponent || "Game"}`,
        });
        return;
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") return;
      }
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (toast) {
      toast.push({
        kind: "success",
        title: "Lineup PDF downloaded",
        message: "Saved to your downloads — share from there.",
      });
    }
  } catch (e) {
    console.error("downloadLineupPdf failed", e);
    if (toast) {
      toast.push({
        kind: "error",
        title: "Couldn't generate PDF",
        message: (e instanceof Error ? e.message : null) || "Try again.",
      });
    }
  }
};

// Tries Web Share API first (so the user's iOS/Android share sheet appears),
// falls back to a download link.
export const shareLineupCard = async ({ game, team, formatDate, toast }: DownloadArgs): Promise<void> => {
  try {
    const blob = await renderLineupCard({ game, team, formatDate });
    if (!blob) throw new Error("Image generation failed");
    const filename = `lineup-${game.opponent || "game"}-${game.date || "card"}.png`
      .replace(/\s+/g, "-")
      .toLowerCase();
    const file = new File([blob], filename, { type: "image/png" });

    const nav = navigator as unknown as {
      share?: (data: { files: File[]; title?: string; text?: string }) => Promise<void>;
      canShare?: (data: { files: File[] }) => boolean;
    };
    if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
      try {
        await nav.share!({
          files: [file],
          title: `Lineup vs ${game.opponent || "Game"}`,
          text: `Lineup vs ${game.opponent || "Game"}`,
        });
        return;
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") return;
      }
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (toast) {
      toast.push({
        kind: "success",
        title: "Lineup downloaded",
        message: "Saved to your downloads — share from there.",
      });
    }
  } catch (e) {
    console.error("shareLineupCard failed", e);
    if (toast) {
      toast.push({
        kind: "error",
        title: "Couldn't share lineup",
        message: (e instanceof Error ? e.message : null) || "Try again.",
      });
    }
  }
};
