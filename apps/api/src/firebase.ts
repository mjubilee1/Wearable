import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

type FirestoreDoc = {
  id: string;
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
};

type FirestoreCollection = {
  doc: (id: string) => { get: () => Promise<FirestoreDoc> };
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

export function isFirebaseConfigured(): boolean {
  if (configured !== null) return configured;

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  configured = Boolean(projectId && credPath && existsSync(credPath));
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

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS!;
  const serviceAccount = JSON.parse(readFileSync(credPath, "utf8")) as object;

  adminApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID,
  });

  return adminApp;
}
