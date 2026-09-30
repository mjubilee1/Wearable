import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

type FirestoreDoc = {
  id: string;
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
};

type FirestoreDocRef = {
  get: () => Promise<FirestoreDoc>;
  set: (
    data: Record<string, unknown>,
    options?: { merge?: boolean },
  ) => Promise<void>;
  update: (data: Record<string, unknown>) => Promise<void>;
};

type FirestoreCollection = {
  doc: (id: string) => FirestoreDocRef;
  get: () => Promise<{ docs: FirestoreDoc[] }>;
};

type AdminApp = {
  auth: () => {
    verifyIdToken: (
      token: string,
    ) => Promise<{ uid: string; email?: string }>;
  };
  firestore: () => {
    collection: (name: string) => FirestoreCollection;
  };
};

let adminApp: AdminApp | null = null;
let configured: boolean | null = null;

function loadServiceAccount(): object | null {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (inline) {
    try {
      return JSON.parse(inline) as object;
    } catch {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON");
    }
  }

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath && existsSync(credPath)) {
    return JSON.parse(readFileSync(credPath, "utf8")) as object;
  }

  return null;
}

export function isFirebaseConfigured(): boolean {
  if (configured !== null) return configured;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  try {
    configured = Boolean(projectId && loadServiceAccount());
  } catch {
    configured = false;
  }
  return configured;
}

export function getFirebaseAdmin(): AdminApp {
  if (adminApp) return adminApp;
  if (!isFirebaseConfigured()) {
    throw new Error("Firebase Admin is not configured");
  }

  const require = createRequire(import.meta.url);
  const admin = require("firebase-admin") as {
    apps: unknown[];
    initializeApp: (opts: {
      credential: unknown;
      projectId?: string;
    }) => AdminApp;
    credential: {
      cert: (serviceAccount: object) => unknown;
    };
  };

  if (admin.apps.length) {
    adminApp = admin.apps[0] as AdminApp;
    return adminApp;
  }

  const serviceAccount = loadServiceAccount();
  if (!serviceAccount) {
    throw new Error("Firebase Admin is not configured");
  }

  adminApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID,
  });

  return adminApp;
}
