// Error-shape readers and an auth diagnostic logger, extracted from App.tsx.
// Shared by the team/auth provider and the app shell. Pure / side-effect-light.

export const errCode = (e: unknown): string =>
  e && typeof e === "object" && "code" in e
    ? String((e as { code?: unknown }).code ?? "")
    : "";

export const errMessage = (e: unknown): string =>
  e && typeof e === "object" && "message" in e
    ? String((e as { message?: unknown }).message ?? "")
    : String(e);

export const authDiag = (event: string, details = {}) => {
  if (typeof console === "undefined") return;
  console.info("[auth-diag]", event, {
    ts: new Date().toISOString(),
    ...details,
  });
};
