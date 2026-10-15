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
  delete: () => Promise<void>;
};

type FirestoreTransaction = {
  get: (ref: FirestoreDocRef) => Promise<FirestoreDoc>;
  set: (
    ref: FirestoreDocRef,
    data: Record<string, unknown>,
    options?: { merge?: boolean },
  ) => FirestoreTransaction;
};

type FirestoreQuery = {
  where: (field: string, op: string, value: unknown) => FirestoreQuery;
  orderBy: (field: string, direction?: "asc" | "desc") => FirestoreQuery;
  limit: (n: number) => FirestoreQuery;
  get: () => Promise<{ docs: FirestoreDoc[] }>;
};

type FirestoreCollection = FirestoreQuery & {
  doc: (id: string) => FirestoreDocRef;
};

type AdminApp = {
  auth: () => {
    verifyIdToken: (token: string) => Promise<{
      uid: string;
      email?: string;
      email_verified?: boolean;
      firebase?: { sign_in_provider?: string };
    }>;
    getUser: (uid: string) => Promise<{
      metadata: { creationTime: string };
    }>;
  };
  firestore: () => {
    collection: (name: string) => FirestoreCollection;
    runTransaction: <T>(
      update: (transaction: FirestoreTransaction) => Promise<T>,
    ) => Promise<T>;
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
    firestore: () => {
      settings: (settings: { ignoreUndefinedProperties?: boolean }) => void;
    };
  };

  if (!admin.apps.length) {
    const serviceAccount = loadServiceAccount();
    if (!serviceAccount) {
      throw new Error("Firebase Admin is not configured");
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
  }

  // Notes and reminders omit `when` when there is no time. Firestore throws
  // if that key is present and undefined.
  admin.firestore().settings({ ignoreUndefinedProperties: true });

  adminApp = admin.apps[0] as AdminApp;
  return adminApp;
}
