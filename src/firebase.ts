import { initializeApp, FirebaseOptions } from "firebase/app";
import { browserLocalPersistence, getAuth, setPersistence } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  Firestore,
} from "firebase/firestore";
import { log } from "./utils/log";

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
let parsedHostFirebaseConfig: FirebaseOptions | null = null;
if (_hostFirebaseConfig) {
  try {
    parsedHostFirebaseConfig = JSON.parse(_hostFirebaseConfig) as FirebaseOptions;
  } catch (err) {
    log.warn("Invalid host-injected Firebase config; falling back to local config.", err);
  }
}

// Never infer authDomain from window.location.hostname. Firebase Auth
// redirect/popup flows require the project's configured auth domain unless a
// fully valid custom auth domain is explicitly provided by host-injected config.
const runtimeHostname =
  typeof window !== "undefined" ? window.location.hostname : "";

const firebaseConfig: FirebaseOptions = parsedHostFirebaseConfig
  ? parsedHostFirebaseConfig
  : fallbackConfig;

if (typeof window !== "undefined") {
  log.info("[firebase] auth bootstrap", {
    host: runtimeHostname || null,
    authDomain: firebaseConfig.authDomain || null,
    usingInjectedConfig: Boolean(parsedHostFirebaseConfig),
  });
}

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

void setPersistence(auth, browserLocalPersistence).catch((err) => {
  log.warn("Auth local persistence unavailable, falling back:", err);
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
  log.warn("Firestore persistent cache unavailable, falling back:", err);
  _db = getFirestore(app);
}
export const db = _db;

// Cloud Storage is intentionally NOT initialized — the app stays on the
// Firebase Spark plan, which doesn't include Cloud Storage. Player photos
// are persisted as 256×256 JPEG data URLs directly on the team document
// via cropImageTo256DataURL in src/components/shared.jsx.

const _hostAppId = (typeof window !== "undefined" && window.__app_id) || null;
export const appId = _hostAppId || "baseball_lineup_v1";
