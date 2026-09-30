import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  initializeAuth,
  type Auth,
  type Persistence,
} from "firebase/auth";
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

  try {
    // Available at runtime via @firebase/auth's "react-native" export condition.
    // Types ship in dist/rn only, so we load it dynamically.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rnAuth = require("@firebase/auth") as {
      getReactNativePersistence?: (
        storage: typeof AsyncStorage,
      ) => Persistence;
    };

    if (!rnAuth.getReactNativePersistence) {
      return getAuth(app);
    }

    return initializeAuth(app, {
      persistence: rnAuth.getReactNativePersistence(AsyncStorage),
    });
  } catch {
    return getAuth(app);
  }
}

export const auth = createAuth();
export const db = getFirestore(app);
export const storage = getStorage(app);
export default app;
