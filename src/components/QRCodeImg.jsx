import React, { useEffect, useState } from "react";
import QRCode from "qrcode";

// Render a URL as a QR code SVG. Lazy-rebuilds whenever the value
// changes; small enough that a 120px-square render fits next to the
// existing "Copy link" buttons without crowding the row. Used in
// Settings for tryout-date links and the team join code so coaches
// can hand a phone to a parent at the field instead of dictating a
// URL.
//
// Errors (qrcode rejecting the value for some reason) render an empty
// placeholder rather than throwing — the surrounding copy-link UI is
// still usable.
export const QRCodeImg = ({ value, size = 120, className = "" }) => {
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

  if (!dataUrl) {
    return (
      <div
        className={`bg-slate-100 border border-slate-200 rounded-lg ${className}`}
        style={{ width: size, height: size }}
        aria-label="QR code unavailable"
      />
    );
  }
  return (
    <img
      src={dataUrl}
      alt={`QR code for ${value}`}
      width={size}
      height={size}
      className={`rounded-lg border border-slate-200 bg-white ${className}`}
    />
  );
};
