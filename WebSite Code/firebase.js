import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getDatabase,
  onValue,
  push,
  ref,
  remove,
  set,
  update,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBfJQvOf2PZlcyBoBjF6D20jzgDrqBigjA",
  authDomain: "automated-poultry-farming-stm.firebaseapp.com",
  databaseURL: "https://automated-poultry-farming-stm-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "automated-poultry-farming-stm",
  storageBucket: "automated-poultry-farming-stm.firebasestorage.app",
  messagingSenderId: "367174962973",
  appId: "1:367174962973:web:e260768e169fe9bbaa9bf4",
};

export const PATHS = {
  poultry: "Poultry",
  batches: "FarmManagement/batches",
  feeding: "FarmManagement/feeding",
  health: "FarmManagement/health",
  expenses: "FarmManagement/expenses",
  settings: "FarmManagement/settings",
  connected: ".info/connected",
};

const app = initializeApp(firebaseConfig);
export const database = getDatabase(app);
export const auth = getAuth(app);

export function subscribe(path, onData, onError) {
  return onValue(ref(database, path), (snapshot) => onData(snapshot.val(), snapshot), onError);
}

export async function createRecord(path, payload) {
  const recordRef = push(ref(database, path));
  const stamped = { ...payload, createdAt: payload.createdAt ?? Date.now(), updatedAt: Date.now() };
  await set(recordRef, stamped);
  return recordRef.key;
}

export function updateRecord(path, id, payload) {
  return update(ref(database, `${path}/${id}`), { ...payload, updatedAt: Date.now() });
}

export function deleteRecord(path, id) {
  return remove(ref(database, `${path}/${id}`));
}

export function saveSettings(payload) {
  return set(ref(database, PATHS.settings), { ...payload, updatedAt: Date.now() });
}

export async function initOptionalAuth() {
  try {
    await signInAnonymously(auth);
    return true;
  } catch (error) {
    console.warn("Anonymous auth unavailable:", error);
    return false;
  }
}

export { onAuthStateChanged };
