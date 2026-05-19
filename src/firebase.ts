import { initializeApp, FirebaseOptions } from "firebase/app";
import { browserLocalPersistence, getAuth, setPersistence } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  Firestore,
} from "firebase/firestore";
import { getStorage, FirebaseStorage } from "firebase/storage";

declare global {
  interface Window {
    __firebase_config?: string;
    __app_id?: string;
  }
}

const fallbackConfig: FirebaseOptions = {
  apiKey: "AIzaSyCaPhBAIcJt0IudO0QfwOc8qoWh9kpD7F4",
  authDomain: "lineupgenerator-79159.firebaseapp.com",
  projectId: "lineupgenerator-79159",
  storageBucket: "lineupgenerator-79159.firebasestorage.app",
  messagingSenderId: "533055070205",
  appId: "1:533055070205:web:cbb800519529449f3f0394",
};

const _hostFirebaseConfig =
  (typeof window !== "undefined" && window.__firebase_config) || null;
const parsedHostFirebaseConfig: FirebaseOptions | null = _hostFirebaseConfig
  ? (JSON.parse(_hostFirebaseConfig) as FirebaseOptions)
  : null;

const isLocalHost = (hostname: string): boolean =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";

const runtimeHostname =
  typeof window !== "undefined" ? window.location.hostname : "";
const shouldOverrideAuthDomain =
  !parsedHostFirebaseConfig?.authDomain &&
  runtimeHostname &&
  !isLocalHost(runtimeHostname);

const firebaseConfig: FirebaseOptions = parsedHostFirebaseConfig
  ? parsedHostFirebaseConfig
  : shouldOverrideAuthDomain
    ? { ...fallbackConfig, authDomain: runtimeHostname }
    : fallbackConfig;

if (typeof window !== "undefined") {
  console.info("[firebase] auth bootstrap", {
    host: runtimeHostname || null,
    authDomain: firebaseConfig.authDomain || null,
    usingInjectedConfig: Boolean(parsedHostFirebaseConfig),
  });
}

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

void setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn("Auth local persistence unavailable, falling back:", err);
});

// Coaches use this app at fields with poor cell service. Initialize Firestore
// with IndexedDB-backed persistence so cached data and pending writes survive
// offline periods and reloads. Falls back to in-memory cache if the browser
// blocks IndexedDB (e.g. private mode, multi-tab without shared workers).
let _db: Firestore;
try {
  _db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  });
} catch (err) {
  console.warn("Firestore persistent cache unavailable, falling back:", err);
  _db = getFirestore(app);
}
export const db = _db;

// Storage backs player photo uploads. Photos are stored under
// `teams/{teamId}/players/{playerId}.jpg`. Storage rules should restrict
// writes to team members; reads are public-ish (anyone with the URL).
export const storage: FirebaseStorage = getStorage(app);

const _hostAppId = (typeof window !== "undefined" && window.__app_id) || null;
export const appId = _hostAppId || "baseball_lineup_v1";
