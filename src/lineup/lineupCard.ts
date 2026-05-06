// Lineup card generator. buildLineupCanvas renders a self-contained
// portrait-oriented HTMLCanvasElement showing defense + batting + game info.
// Two thin wrappers expose it as a PNG blob (for image sharing) and as a PDF
// blob (for emailing/texting a fixed-format document — browser print is
// inconsistent across devices).

import { Game, SlimPlayer, Team, Toast } from "../types";

interface RenderArgs {
  game: Game;
  team?: Team | null;
  formatDate: (s: string) => string;
}

interface DownloadArgs extends RenderArgs {
  toast?: Toast;
}

export const buildLineupCanvas = ({ game, team, formatDate }: RenderArgs): HTMLCanvasElement => {
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
  const headerH = 90;
  const sectionTitleH = 36;
  const cellH = 38;
  const defenseH = sectionTitleH + cellH * (presentPositions.length + 1);
  const battingRowH = 32;
  const battingH = sectionTitleH + battingRowH * battingLineup.length;
  const footerH = 28;
  const H = headerH + defenseH + battingH + footerH + PAD * 4;

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
  ctx.font = "600 12px system-ui, -apple-system, Segoe UI, sans-serif";
  const dateStr = game.date ? formatDate(game.date) : "";
  const timeStr = game.time || "";
  const dateTime = [dateStr, timeStr].filter(Boolean).join(" • ");
  if (dateTime) {
    const tw = ctx.measureText(dateTime).width;
    ctx.fillText(dateTime, W - PAD - tw, 50);
  }

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

  // ---- Batting section ----
  ctx.textAlign = "left";
  ctx.fillStyle = "#0f172a";
  ctx.font = "900 14px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.fillText("BATTING ORDER", PAD, y);
  y += sectionTitleH;

  for (let i = 0; i < battingLineup.length; i++) {
    const player = battingLineup[i];
    if (i % 2 === 0) {
      ctx.fillStyle = "#f1f5f9";
      ctx.fillRect(PAD, y, W - PAD * 2, battingRowH);
    }
    ctx.fillStyle = primary;
    ctx.font = "900 13px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`${i + 1}`, PAD + 18, y + battingRowH / 2 - 5);
    ctx.fillStyle = "#0f172a";
    ctx.font = "700 13px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(player?.name || "—", PAD + 50, y + battingRowH / 2 - 5);
    if (player?.number) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = "700 11px system-ui, -apple-system, Segoe UI, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(`#${player.number}`, W - PAD - 8, y + battingRowH / 2 - 4);
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

// PNG blob wrapper — canonical "render" for image-share flows.
export const renderLineupCard = ({ game, team, formatDate }: RenderArgs): Promise<Blob | null> => {
  const canvas = buildLineupCanvas({ game, team, formatDate });
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
  const canvas = buildLineupCanvas({ game, team, formatDate });
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
