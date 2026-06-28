// Google sign-in redirect-flow guards, extracted from App.tsx. The redirect
// path (used as a fallback when popup sign-in is blocked) can get stuck if the
// provider bounces back without completing; these sessionStorage flags let the
// app detect a stalled redirect and cap retries. Shared by the team/auth
// provider and the app shell.

const REDIRECT_FLAG_KEY = "googleSignInRedirectPending";
const REDIRECT_STARTED_AT_KEY = "googleSignInRedirectStartedAt";
const REDIRECT_GUARD_MS = 45 * 1000;
const REDIRECT_ATTEMPTS_KEY = "googleSignInRedirectAttempts";
const MAX_REDIRECT_ATTEMPTS = 2;

export const markRedirectPending = () => {
  if (typeof window === "undefined") return;
  const priorAttempts = Number(
    sessionStorage.getItem(REDIRECT_ATTEMPTS_KEY) || "0",
  );
  sessionStorage.setItem(
    REDIRECT_ATTEMPTS_KEY,
    String(Number.isFinite(priorAttempts) ? priorAttempts + 1 : 1),
  );
  sessionStorage.setItem(REDIRECT_FLAG_KEY, "1");
  sessionStorage.setItem(REDIRECT_STARTED_AT_KEY, String(Date.now()));
};

export const clearRedirectPending = () => {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(REDIRECT_FLAG_KEY);
  sessionStorage.removeItem(REDIRECT_STARTED_AT_KEY);
  sessionStorage.removeItem(REDIRECT_ATTEMPTS_KEY);
};

export const isRedirectLikelyStuck = () => {
  if (typeof window === "undefined") return false;
  if (sessionStorage.getItem(REDIRECT_FLAG_KEY) !== "1") return false;
  const started = Number(
    sessionStorage.getItem(REDIRECT_STARTED_AT_KEY) || "0",
  );
  if (!Number.isFinite(started) || started <= 0) return true;
  return Date.now() - started > REDIRECT_GUARD_MS;
};

export const redirectAttemptsExceeded = () => {
  if (typeof window === "undefined") return false;
  const attempts = Number(sessionStorage.getItem(REDIRECT_ATTEMPTS_KEY) || "0");
  return Number.isFinite(attempts) && attempts >= MAX_REDIRECT_ATTEMPTS;
};
