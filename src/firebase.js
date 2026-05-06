import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";

const fallbackConfig = {
  apiKey: "AIzaSyCaPhBAIcJt0IudO0QfwOc8qoWh9kpD7F4",
  authDomain: "lineupgenerator-79159.firebaseapp.com",
  projectId: "lineupgenerator-79159",
  storageBucket: "lineupgenerator-79159.firebasestorage.app",
  messagingSenderId: "533055070205",
  appId: "1:533055070205:web:cbb800519529449f3f0394",
};

const _hostFirebaseConfig =
  (typeof window !== "undefined" && window.__firebase_config) || null;
const firebaseConfig = _hostFirebaseConfig
  ? JSON.parse(_hostFirebaseConfig)
  : fallbackConfig;

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Coaches use this app at fields with poor cell service. Initialize Firestore
// with IndexedDB-backed persistence so cached data and pending writes survive
// offline periods and reloads. Falls back to in-memory cache if the browser
// blocks IndexedDB (e.g. private mode, multi-tab without shared workers).
let _db;
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

const _hostAppId = (typeof window !== "undefined" && window.__app_id) || null;
export const appId = _hostAppId || "baseball_lineup_v1";
