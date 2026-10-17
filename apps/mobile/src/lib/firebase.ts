import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, type Auth, type Persistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

function createFirebaseApp() {
  if (getApps().length) return getApp();
  return initializeApp(firebaseConfig);
}

const app = createFirebaseApp();

function createAuth(): Auth {
  if (Platform.OS === "web") {
    return getAuth(app);
  }

  // Metro aliases firebase/auth to the React Native build. The browser build
  // keeps the session in memory, so reopening the app looks signed out.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const rnAuth = require("@firebase/auth") as {
    getAuth: (firebaseApp: typeof app) => Auth;
    initializeAuth: (
      firebaseApp: typeof app,
      deps: { persistence: Persistence },
    ) => Auth;
    getReactNativePersistence: (storage: typeof AsyncStorage) => Persistence;
  };

  try {
    return rnAuth.initializeAuth(app, {
      persistence: rnAuth.getReactNativePersistence(AsyncStorage),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/already/i.test(message)) return rnAuth.getAuth(app);
    throw error;
  }
}

export const auth = createAuth();
export const db = getFirestore(app);
export const storage = getStorage(app);
export default app;
