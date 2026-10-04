import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import {
  SEED_PROFILES,
  compatibilityScore,
  isNearbyPlus,
  mockFacilitate,
  normalizeDeviceId,
  vibeCaption,
  walkByScore,
  type ClipSightingPost,
  type MatchProfile,
  type UserProfile,
} from "@nearby/shared";
import { verifyAuth } from "./auth.js";
import {
  createCheckoutSession,
  createPortalSession,
  handleStripeWebhook,
  isStripeConfigured,
  isStripeWebhookConfigured,
} from "./billing.js";
import { facilitateMatch } from "./facilitate.js";
import { getFirebaseAdmin, isFirebaseConfigured } from "./firebase.js";
import { listClipSightingsForUser, recordClipSighting } from "./sightings.js";

// Load apps/api/.env whether started from repo root or apps/api
const apiDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
loadEnv({ path: resolve(apiDir, ".env") });

const app = new Hono();
const port = Number(process.env.PORT ?? 4000);

function seedAsProfiles(): UserProfile[] {
  const now = Date.now();
  return SEED_PROFILES.map((profile) => ({
    ...profile,
    createdAt: now,
    updatedAt: now,
  }));
}

function demoSelf(authUid: string, email?: string): UserProfile {
  const now = Date.now();
  return {
    id: authUid,
    email: email ?? "",
    name: "You",
    age: 28,
    role: "Explorer",
    interests: ["Coffee walks", "Indie film"],
    avatarHue: 180,
    initials: "Y",
    bio: "Trying Nearby in demo mode.",
    lookingFor: "New friends",
    vibes: ["Curious", "Chill"],
    prompts: [],
    photoUrl: null,
    deviceId: null,
    plan: "free",
    subscriptionStatus: "none",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    createdAt: now,
    updatedAt: now,
  };
}

async function loadProfile(uid: string): Promise<UserProfile | null> {
  if (!isFirebaseConfigured()) {
    const seed = seedAsProfiles().find((p) => p.id === uid);
    if (seed) return seed;
    return null;
  }
  const snap = await getFirebaseAdmin()
    .firestore()
    .collection("users")
    .doc(uid)
    .get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() ?? {}) } as UserProfile;
}

async function loadAllProfiles(): Promise<UserProfile[]> {
  if (!isFirebaseConfigured()) return seedAsProfiles();
  const snap = await getFirebaseAdmin().firestore().collection("users").get();
  return snap.docs.map(
    (doc) => ({ id: doc.id, ...(doc.data() ?? {}) }) as UserProfile,
  );
}

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return "http://localhost:3000";
      if (
        origin.startsWith("http://localhost:") ||
        origin.startsWith("http://127.0.0.1:") ||
        origin.endsWith(".vercel.app") ||
        origin === process.env.WEB_ORIGIN
      ) {
        return origin;
      }
      return "http://localhost:3000";
    },
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "nearby-api",
    firebase: isFirebaseConfigured(),
    llm: Boolean(process.env.OPENAI_API_KEY),
    stripe: isStripeConfigured(),
    stripeWebhook: isStripeWebhookConfigured(),
  }),
);

/** Stripe webhook — raw body required for signature verification. */
app.post("/v1/billing/webhook", async (c) => {
  if (!isStripeWebhookConfigured()) {
    return c.json({ error: "Webhook secret not configured" }, 503);
  }
  const signature = c.req.header("stripe-signature");
  if (!signature) return c.json({ error: "Missing stripe-signature" }, 400);

  const rawBody = await c.req.text();
  try {
    await handleStripeWebhook(rawBody, signature);
    return c.json({ received: true });
  } catch (err) {
    console.error("[billing] webhook error", err);
    return c.json(
      {
        error: err instanceof Error ? err.message : "Webhook failed",
      },
      400,
    );
  }
});

app.post("/v1/billing/checkout", async (c) => {
  if (!isStripeConfigured()) {
    return c.json({ error: "Billing not configured" }, 503);
  }
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);

  const profile =
    (await loadProfile(auth.uid)) ?? demoSelf(auth.uid, auth.email);
  if (isNearbyPlus(profile)) {
    return c.json({ error: "Already on Nearby+" }, 409);
  }

  try {
    const session = await createCheckoutSession({
      uid: auth.uid,
      email: auth.email ?? profile.email,
      stripeCustomerId: profile.stripeCustomerId,
    });
    return c.json(session);
  } catch (err) {
    console.error("[billing] checkout error", err);
    return c.json(
      { error: err instanceof Error ? err.message : "Checkout failed" },
      500,
    );
  }
});

app.post("/v1/billing/portal", async (c) => {
  if (!isStripeConfigured()) {
    return c.json({ error: "Billing not configured" }, 503);
  }
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);

  const profile = await loadProfile(auth.uid);
  if (!profile?.stripeCustomerId) {
    return c.json({ error: "No billing account yet" }, 404);
  }

  try {
    const session = await createPortalSession({
      stripeCustomerId: profile.stripeCustomerId,
    });
    return c.json(session);
  } catch (err) {
    console.error("[billing] portal error", err);
    return c.json(
      { error: err instanceof Error ? err.message : "Portal failed" },
      500,
    );
  }
});

app.get("/v1/matches", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);

  const self =
    (await loadProfile(auth.uid)) ?? demoSelf(auth.uid, auth.email);
  const others = (await loadAllProfiles()).filter((p) => p.id !== self.id);

  const matches: MatchProfile[] = others
    .map((other) => {
      const score = compatibilityScore(self, other);
      return {
        ...other,
        score,
        vibeCaption: vibeCaption(other.name, score),
      };
    })
    .sort((a, b) => b.score - a.score);

  return c.json({
    matches,
    mode: isFirebaseConfigured() ? "firebase" : "mock",
  });
});

app.get("/v1/me", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);

  const profile =
    (await loadProfile(auth.uid)) ?? demoSelf(auth.uid, auth.email);
  return c.json({
    profile,
    mode: isFirebaseConfigured() ? "firebase" : "mock",
  });
});

/**
 * Phone posts a foreground BLE sighting (manufacturer-matched clip only).
 * Body: { remoteClipId, rssi, timestamp } — no names, no interests.
 */
app.post("/v1/ble/sightings", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);

  const body = (await c.req.json().catch(() => null)) as ClipSightingPost | null;
  const remoteClipId = normalizeDeviceId(String(body?.remoteClipId ?? ""));
  const rssi = Number(body?.rssi);
  const timestamp = Number(body?.timestamp ?? Date.now());

  if (!remoteClipId) return c.json({ error: "remoteClipId required" }, 400);
  if (!Number.isFinite(rssi) || rssi > 0 || rssi < -120) {
    return c.json({ error: "rssi out of range" }, 400);
  }
  if (!Number.isFinite(timestamp)) {
    return c.json({ error: "timestamp required" }, 400);
  }

  const reporter =
    (await loadProfile(auth.uid)) ?? demoSelf(auth.uid, auth.email);

  try {
    const record = await recordClipSighting({
      reporterUserId: auth.uid,
      reporter,
      remoteClipId,
      rssi,
      timestamp,
      allProfiles: await loadAllProfiles(),
    });
    return c.json({
      remoteClipId: record.remoteClipId,
      rssi: record.rssi,
      timestamp: record.timestamp,
      close: record.close,
      green: record.green,
      mode: isFirebaseConfigured() ? "firebase" : "mock",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to record";
    if (message.includes("own clip")) {
      return c.json({ error: message }, 400);
    }
    return c.json({ error: message }, 400);
  }
});

/** Debug feed: last BLE reports this user posted. No names. */
app.get("/v1/ble/sightings", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);

  const reports = await listClipSightingsForUser(auth.uid);
  return c.json({
    reports,
    mode: isFirebaseConfigured() ? "firebase" : "mock",
  });
});

/** Resolve a wearable short ID (A1B2 / NB-A1B2) to a user profile + score. */
app.get("/v1/devices/:deviceId", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);

  const deviceId = normalizeDeviceId(c.req.param("deviceId"));
  if (!deviceId) return c.json({ error: "Invalid device id" }, 400);

  const bandRaw = Number(c.req.query("band") ?? 2);
  const band = (bandRaw === 0 || bandRaw === 1 ? bandRaw : 2) as 0 | 1 | 2;

  const self =
    (await loadProfile(auth.uid)) ?? demoSelf(auth.uid, auth.email);
  const other = (await loadAllProfiles()).find(
    (p) => normalizeDeviceId(String(p.deviceId ?? "")) === deviceId,
  );

  if (!other) {
    return c.json({ error: "No profile linked to device", deviceId }, 404);
  }

  const score = walkByScore(self, other, band);
  return c.json({
    deviceId,
    proximityBand: band,
    score,
    vibeCaption: vibeCaption(other.name, score),
    profile: other,
    mode: isFirebaseConfigured() ? "firebase" : "mock",
  });
});

app.post("/v1/facilitate", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);

  const body = (await c.req.json().catch(() => null)) as {
    otherId?: string;
  } | null;
  const otherId = body?.otherId?.trim();
  if (!otherId) return c.json({ error: "otherId required" }, 400);

  const self =
    (await loadProfile(auth.uid)) ?? demoSelf(auth.uid, auth.email);
  const other = await loadProfile(otherId);

  if (!other) {
    const seed = seedAsProfiles().find((p) => p.id === otherId);
    if (!seed) return c.json({ error: "Other profile not found" }, 404);
    const result = await facilitateMatch(self, seed);
    return c.json(result);
  }

  const result = await facilitateMatch(self, other);
  return c.json(result);
});

/** Dev helper: mock facilitate without auth profile lookup. */
app.post("/v1/facilitate/preview", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    otherId?: string;
  } | null;
  const otherId = body?.otherId ?? "seed-maya";
  const self = demoSelf("preview-user");
  const other =
    seedAsProfiles().find((p) => p.id === otherId) ?? seedAsProfiles()[0];
  return c.json(mockFacilitate(self, other));
});

console.log(`Nearby API listening on http://localhost:${port}`);
serve({ fetch: app.fetch, port, createServer });
