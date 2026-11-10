// The coach's Venmo link goes into offer letters families receive, so it must
// be a real Venmo address: an arbitrary URL there could send a family's
// payment somewhere else, and a `javascript:` "link" would run script when a
// coach clicked it (React 18 doesn't block those).
const VENMO_HOSTS = new Set([
  "venmo.com",
  "www.venmo.com",
  "account.venmo.com",
]);
const HANDLE = /^@?([A-Za-z0-9_-]{2,30})$/;

// A stored link is safe to render as <a href>: https on a Venmo host.
export const isSafeVenmoUrl = (value: unknown): value is string => {
  if (typeof value !== "string" || !value) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && VENMO_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
};

// What a coach typed → the link to store. Accepts a bare handle ("@Coach" or
// "Coach"), "venmo.com/u/Coach" without a scheme, or a full https Venmo URL.
// Empty clears it. Anything else is refused (ok: false) — never stored.
export const normalizeVenmoLink = (
  input: string,
): { ok: true; value: string } | { ok: false } => {
  const raw = String(input || "").trim();
  if (!raw) return { ok: true, value: "" };
  const handle = raw.match(HANDLE);
  if (handle) return { ok: true, value: `https://venmo.com/u/${handle[1]}` };
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  if (!isSafeVenmoUrl(withScheme)) return { ok: false };
  return { ok: true, value: new URL(withScheme).toString() };
};
