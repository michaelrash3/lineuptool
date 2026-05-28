import React, { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";

// Slugify the value into a filesystem-friendly default filename when
// the caller doesn't pass one explicitly. "https://x.com/foo" →
// "x-com-foo". Falls back to a generic "qr-code" if nothing usable.
const defaultFilename = (value) => {
  const slug = String(value || "")
    .replace(/^https?:\/\//i, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  return slug ? `qr-${slug}` : "qr-code";
};

// Render a URL as a QR code. Lazy-rebuilds whenever the value
// changes; small enough that a 120px-square render fits next to the
// existing "Copy link" buttons without crowding the row.
//
// When `downloadable` is true, an inline "Download PNG" button below
// the QR exports a 512px-square PNG to disk (regardless of the inline
// display size) so it's flyer-printable. Filename is derived from the
// value or can be set via `filename`.
//
// Errors (qrcode rejecting the value for some reason) render an empty
// placeholder rather than throwing — the surrounding copy-link UI is
// still usable.
export const QRCodeImg = ({
  value,
  size = 120,
  className = "",
  downloadable = false,
  filename,
  downloadSize = 512,
  downloadLabel = "Download PNG",
}) => {
  const [dataUrl, setDataUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!value) {
      setDataUrl("");
      return () => {};
    }
    QRCode.toDataURL(value, {
      width: size,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#0f172a", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  // Generate a fresh high-res PNG on demand (not pre-computed — most
  // QR renders never get downloaded, and the inline view is fine at
  // size px). Triggers a browser download via a transient anchor.
  const handleDownload = useCallback(async () => {
    if (!value) return;
    try {
      const hiResUrl = await QRCode.toDataURL(value, {
        width: downloadSize,
        margin: 2,
        errorCorrectionLevel: "M",
        color: { dark: "#0f172a", light: "#ffffff" },
      });
      const name = (filename || defaultFilename(value)).replace(
        /\.png$/i,
        ""
      );
      const a = document.createElement("a");
      a.href = hiResUrl;
      a.download = `${name}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      // Best-effort; if generation fails the download just doesn't fire.
    }
  }, [value, filename, downloadSize]);

  if (!dataUrl) {
    return (
      <div
        className={`bg-slate-100 border border-slate-200 rounded-lg ${className}`}
        style={{ width: size, height: size }}
        aria-label="QR code unavailable"
      />
    );
  }
  const img = (
    <img
      src={dataUrl}
      alt={`QR code for ${value}`}
      width={size}
      height={size}
      className={`rounded-lg border border-slate-200 bg-white ${className}`}
    />
  );
  if (!downloadable) return img;
  return (
    <div className="inline-flex flex-col items-center gap-1.5">
      {img}
      <button
        type="button"
        onClick={handleDownload}
        className="text-[9px] font-black uppercase tracking-widest text-slate-600 hover:text-slate-900 px-2 py-0.5 rounded border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
        title={`Save a high-resolution PNG for flyers`}
      >
        {downloadLabel}
      </button>
    </div>
  );
};
