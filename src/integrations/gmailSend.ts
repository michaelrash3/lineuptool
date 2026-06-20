// Gmail send — piggy-backs on the user's Firebase Google auth session by
// requesting the `gmail.send` scope via a popup re-auth, then posts to
// the Gmail REST API as the signed-in user. The access token is cached
// in-memory only (per-tab); a 401 triggers a fresh consent prompt.
//
// Failure modes the caller should expect:
//   - "consent_declined": user closed the popup or denied gmail.send
//   - "not_google_user": Firebase user isn't authenticated via Google
//   - "send_failed": Gmail API rejected the request (rate limit, bad
//     recipient address, etc.). The exception's `cause` carries the
//     parsed Gmail error body when available.
// Callers (e.g. SettingsTab) typically fall back to a `mailto:` URL on
// any of these so the user can still get the invite out manually.

import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import type { User, Auth } from "firebase/auth";

const SCOPE = "https://www.googleapis.com/auth/gmail.send";
const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

let cachedToken: string | null = null;

const isGoogleUser = (user: User | null): boolean => {
  if (!user) return false;
  return (user.providerData || []).some((p) => p.providerId === "google.com");
};

// Prompt the user with the Gmail scope. Resolves to the new access token
// or throws "consent_declined" if the popup was dismissed without grant.
const requestGmailScope = async (auth: Auth): Promise<string> => {
  const provider = new GoogleAuthProvider();
  provider.addScope(SCOPE);
  // Force the account picker so the right Google identity is selected
  // when the user has multiple signed-in accounts in their browser.
  provider.setCustomParameters({ prompt: "consent" });
  let result;
  try {
    result = await signInWithPopup(auth, provider);
  } catch (err: any) {
    if (
      err?.code === "auth/popup-closed-by-user" ||
      err?.code === "auth/cancelled-popup-request"
    ) {
      const e = new Error("consent_declined");
      (e as any).cause = err;
      throw e;
    }
    throw err;
  }
  const cred = GoogleAuthProvider.credentialFromResult(result);
  const token = cred?.accessToken;
  if (!token) {
    const e = new Error("consent_declined");
    throw e;
  }
  cachedToken = token;
  return token;
};

// Base64url-encode a UTF-8 string for the Gmail API `raw` field.
const b64urlEncode = (s: string): string => {
  // btoa() only handles latin-1; encode UTF-8 first to be safe with
  // non-ASCII names in subjects/bodies.
  const utf8 = unescape(encodeURIComponent(s));
  return btoa(utf8).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

interface SendOpts {
  auth: Auth;
  to: string;
  subject: string;
  body: string;
  // The signed-in user's email is used as the From header — Gmail will
  // reject any other From value (the SMTP envelope is set by Google).
  fromEmail: string;
  fromName?: string;
}

const buildRfc2822 = ({ to, subject, body, fromEmail, fromName }: SendOpts) => {
  const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
  ].join("\r\n");
};

export const sendGmailMessage = async (opts: SendOpts): Promise<void> => {
  const { auth } = opts;
  if (!isGoogleUser(auth.currentUser)) {
    throw new Error("not_google_user");
  }
  let token = cachedToken;
  if (!token) {
    token = await requestGmailScope(auth);
  }
  const raw = b64urlEncode(buildRfc2822(opts));
  let res = await fetch(SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });
  // Token expired or scope was previously denied — re-prompt once.
  if (res.status === 401 || res.status === 403) {
    cachedToken = null;
    token = await requestGmailScope(auth);
    res = await fetch(SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    });
  }
  if (!res.ok) {
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      /* ignore */
    }
    const e = new Error("send_failed");
    (e as any).cause = parsed;
    (e as any).status = res.status;
    throw e;
  }
};

// Build a mailto: URL fallback that opens the device's mail client with
// recipient/subject/body pre-filled. Always available regardless of
// Gmail scope.
export const buildMailtoUrl = (
  to: string,
  subject: string,
  body: string,
): string => {
  // mailto: clients expect RFC 3986 percent-encoding for the query
  // string. URLSearchParams uses application/x-www-form-urlencoded
  // which encodes spaces as `+` — that shows up as literal `+` in
  // Gmail's compose pane (since mailto doesn't apply form decoding).
  // encodeURIComponent emits %20 for spaces, which mailto handlers
  // decode correctly.
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;
};
