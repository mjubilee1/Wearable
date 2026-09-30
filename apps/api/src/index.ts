import { createServer } from "node:http";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import {
  SEED_PROFILES,
  compatibilityScore,
  vibeCaption,
  type MatchProfile,
  type UserProfile,
} from "@nearby/shared";
import { verifyAuth } from "./auth.js";
import { getFirebaseAdmin, isFirebaseConfigured } from "./firebase.js";

const app = new Hono();
const port = Number(process.env.PORT ?? 4000);

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: ["http://localhost:3000", "http://localhost:8081"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "nearby-api",
    firebase: isFirebaseConfigured(),
  }),
);

app.get("/v1/matches", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);

  if (!isFirebaseConfigured()) {
    const now = Date.now();
    const self: UserProfile = {
      id: auth.uid,
      email: auth.email ?? "",
      name: "You",
      age: 0,
      role: "",
      interests: ["Coffee walks", "Indie film"],
      avatarHue: 180,
      initials: "Y",
      createdAt: now,
      updatedAt: now,
    };

    const matches: MatchProfile[] = SEED_PROFILES.map((profile) => {
      const other = { ...profile, createdAt: now, updatedAt: now };
      const score = compatibilityScore(self, other);
      return { ...other, score, vibeCaption: vibeCaption(other.name, score) };
    }).sort((a, b) => b.score - a.score);

    return c.json({ matches, mode: "mock" });
  }

  const admin = getFirebaseAdmin();
  const db = admin.firestore();
  const selfSnap = await db.collection("users").doc(auth.uid).get();
  if (!selfSnap.exists) {
    return c.json({ error: "Profile not found" }, 404);
  }

  const self = { id: selfSnap.id, ...(selfSnap.data() ?? {}) } as UserProfile;
  const snap = await db.collection("users").get();
  const matches: MatchProfile[] = snap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() ?? {}) }) as UserProfile)
    .filter((other) => other.id !== self.id)
    .map((other) => {
      const score = compatibilityScore(self, other);
      return {
        ...other,
        score,
        vibeCaption: vibeCaption(other.name, score),
      };
    })
    .sort((a, b) => b.score - a.score);

  return c.json({ matches, mode: "firebase" });
});

app.get("/v1/me", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);

  if (!isFirebaseConfigured()) {
    return c.json({
      profile: {
        id: auth.uid,
        email: auth.email ?? "",
        name: "Demo User",
        age: 28,
        role: "Explorer",
        interests: ["Coffee walks"],
        avatarHue: 180,
        initials: "DU",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      mode: "mock",
    });
  }

  const admin = getFirebaseAdmin();
  const snap = await admin.firestore().collection("users").doc(auth.uid).get();
  if (!snap.exists) return c.json({ error: "Profile not found" }, 404);
  return c.json({ profile: snap.data(), mode: "firebase" });
});

console.log(`Nearby API listening on http://localhost:${port}`);
serve({ fetch: app.fetch, port, createServer });
