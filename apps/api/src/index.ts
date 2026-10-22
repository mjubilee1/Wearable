import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import {
  SEED_PROFILES,
  compatibilityScore,
  hasProAccess,
  mockFacilitate,
  isDeviceLocation,
  isGeoPoint,
  normalizeDeviceId,
  turnNeedsDeviceLocation,
  vibeCaption,
  walkByScore,
  type ClipSightingPost,
  type MatchProfile,
  type UserProfile,
} from "@nearby/shared";
import {
  clearAgentHistory,
  deleteAgentMemory,
  deleteAgentNote,
  getAgentUsage,
  listAgentHistory,
  listAgentMemories,
  listAgentNotes,
  runAgentTurn,
} from "./agent.js";
import {
  accountAccessFromHeader,
  isEmailVerificationExempt,
  verifyAuth,
} from "./auth.js";
import {
  createCheckoutSession,
  createPortalSession,
  handleStripeWebhook,
  isStripeConfigured,
  isStripeWebhookConfigured,
  referralSummary,
  stripeCustomerIdForProfile,
} from "./billing.js";
import { LimitReachedError } from "./limits.js";
import { consumeDemoTry, runDemoTurn } from "./demo.js";
import { facilitateMatch } from "./facilitate.js";
import { getFirebaseAdmin, isFirebaseConfigured } from "./firebase.js";
import { acceptInvite, createInvite, InviteError } from "./invites.js";
import { deleteAllMemories } from "./memories.js";
import {
  buildGoogleAuthUrl,
  disconnectGoogleCalendar,
  getGoogleCalendarStatus,
  handleGoogleCalendarCallback,
  isGoogleCalendarConfigured,
} from "./connectors/google-calendar.js";
import { listClipSightingsForUser, recordClipSighting } from "./sightings.js";
import { joinWaitlist } from "./waitlist.js";
import {
  VoiceMemoAccessError,
  createVoiceMemo,
  decideVoiceMemoAction,
  deleteVoiceMemo,
  listVoiceMemos,
  transcribeAudio,
} from "./voice-memos.js";
import {
  PhoneError,
  checkPhoneVerification,
  getPhoneStatus,
  phoneProvisioningQuote,
  provisionNearbyNumber,
  publicPhoneStatus,
  startPhoneVerification,
} from "./phone.js";
import {
  MessagingError,
  blockConversationUser,
  listConversations,
  listMessages,
  reportConversationUser,
  sendMessage,
  startConversation,
} from "./messaging.js";
import {
  SpatialError,
  deleteContributions,
  getSensorConsent,
  getSpatialSnapshot,
  startSensorSession,
  stopSensorSession,
  submitObservation,
  updateSensorConsent,
} from "./spatial.js";
import {
  PlaceError,
  getSpatialPlaceById,
  nearbyPlaces,
  parseNearbyPlaceQuery,
  placeIngestionMetrics,
  searchLocations,
  syncConfiguredPilotPlaces,
} from "./places.js";
import {
  ObservationError,
  answerSpatialQuery,
  getObservationSubmission,
  getPlaceInsights,
  observationMetrics,
  submitImageObservation,
  submitObservationFeedback,
  subscribePlaceInsights,
} from "./observation-pipeline.js";
import { streamSSE } from "hono/streaming";

// Load apps/api/.env whether started from repo root or apps/api
const apiDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
loadEnv({ path: resolve(apiDir, ".env") });

const app = new Hono();
const port = Number(process.env.PORT ?? 4000);
const billingEnabled = process.env.BILLING_ENABLED === "true";

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
        origin === "https://nearbyhello.com" ||
        origin === "https://www.nearbyhello.com" ||
        origin === process.env.WEB_ORIGIN
      ) {
        return origin;
      }
      return "http://localhost:3000";
    },
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use("*", async (c, next) => {
  if (!c.req.path.startsWith("/v1/")) return next();
  const block = await accountAccessFromHeader(
    c.req.header("Authorization"),
    isEmailVerificationExempt(c.req.method, c.req.path),
  );
  if (!block) return next();
  return c.json({ error: block.error }, block.status);
});

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "nearby-api",
    firebase: isFirebaseConfigured(),
    llm: Boolean(process.env.OPENAI_API_KEY),
    stripe: isStripeConfigured(),
    billingEnabled,
    places: {
      provider: "openstreetmap",
      overpassConfigured: true,
      metrics: placeIngestionMetrics,
    },
    observations: {
      visionConfigured: Boolean(process.env.OPENAI_API_KEY),
      visionMode: process.env.OPENAI_API_KEY ? "openai" : "fixture",
      metrics: observationMetrics,
    },
    stripeWebhook: isStripeWebhookConfigured(),
    googleCalendar: isGoogleCalendarConfigured(),
    twilioVerify: Boolean(process.env.TWILIO_VERIFY_SERVICE_SID),
    twilioPurchasesEnabled:
      process.env.TWILIO_ENABLE_PHONE_PURCHASES === "true",
  }),
);

function spatialFailure(c: Context, error: unknown) {
  const status =
    error instanceof SpatialError ||
    error instanceof PlaceError ||
    error instanceof ObservationError
      ? error.status
      : 500;
  return c.json(
    {
      code:
        error instanceof SpatialError ||
        error instanceof PlaceError ||
        error instanceof ObservationError
          ? error.code
          : "spatial_error",
      error: error instanceof Error ? error.message : "Spatial request failed",
    },
    status as 400,
  );
}

function spatialQuery(c: Context) {
  const latitude = Number(c.req.query("latitude"));
  const longitude = Number(c.req.query("longitude"));
  const accuracyMeters = c.req.query("accuracyMeters");
  const location = {
    latitude,
    longitude,
    ...(accuracyMeters ? { accuracyMeters: Number(accuracyMeters) } : {}),
  };
  if (!isGeoPoint(location)) {
    throw new SpatialError("Valid latitude and longitude query parameters are required.");
  }
  const requestedMode = c.req.query("mode");
  const mode: "demo" | "community" | "personal" =
    requestedMode === "demo" || requestedMode === "community"
      ? requestedMode
      : "personal";
  return { location, mode };
}

app.get("/v1/spatial/consent", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  return c.json({ consent: await getSensorConsent(auth.uid) });
});

app.patch("/v1/spatial/consent", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const body = (await c.req.json().catch(() => null)) as
    | Partial<Record<"location" | "sound" | "motion" | "bluetooth", boolean>>
    | null;
  if (!body || typeof body !== "object") {
    return c.json({ error: "Consent settings are required." }, 400);
  }
  return c.json({ consent: await updateSensorConsent(auth.uid, body) });
});

app.post("/v1/spatial/sessions", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const body = (await c.req.json().catch(() => null)) as {
    consent?: Partial<Record<"location" | "sound" | "motion" | "bluetooth", boolean>>;
    enabledSensors?: Array<"location" | "sound" | "motion" | "bluetooth">;
  } | null;
  try {
    const session = await startSensorSession(auth.uid, {
      consent: body?.consent ?? {},
      enabledSensors: Array.isArray(body?.enabledSensors)
        ? body.enabledSensors
        : [],
    });
    return c.json({ session }, 201);
  } catch (error) {
    return spatialFailure(c, error);
  }
});

app.patch("/v1/spatial/sessions/:sessionId", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  try {
    return c.json({
      session: await stopSensorSession(auth.uid, c.req.param("sessionId")),
    });
  } catch (error) {
    return spatialFailure(c, error);
  }
});

app.post("/v1/spatial/observations", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return c.json({ error: "Observation body is required." }, 400);
  }
  try {
    return c.json(
      {
        observation: await submitObservation(
          auth.uid,
          body as Parameters<typeof submitObservation>[1],
        ),
      },
      201,
    );
  } catch (error) {
    return spatialFailure(c, error);
  }
});

app.get("/v1/spatial/zones", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  try {
    const { location, mode } = spatialQuery(c);
    const snapshot = await getSpatialSnapshot(auth.uid, location, mode);
    return c.json({ zones: [snapshot.zone], mode: snapshot.mode });
  } catch (error) {
    return spatialFailure(c, error);
  }
});

app.get("/v1/spatial/aggregates", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  try {
    const { location, mode } = spatialQuery(c);
    const snapshot = await getSpatialSnapshot(auth.uid, location, mode);
    return c.json({
      zone: snapshot.zone,
      mode: snapshot.mode,
      aggregates: snapshot.aggregates,
      generatedAt: snapshot.generatedAt,
    });
  } catch (error) {
    return spatialFailure(c, error);
  }
});

app.get("/v1/spatial/patterns", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  try {
    const { location, mode } = spatialQuery(c);
    const snapshot = await getSpatialSnapshot(auth.uid, location, mode);
    return c.json({
      zone: snapshot.zone,
      mode: snapshot.mode,
      patterns: snapshot.patterns,
      generatedAt: snapshot.generatedAt,
    });
  } catch (error) {
    return spatialFailure(c, error);
  }
});

app.get("/v1/spatial/places/nearby", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  try {
    const query = parseNearbyPlaceQuery({
      latitude: c.req.query("latitude"),
      longitude: c.req.query("longitude"),
      lat: c.req.query("lat"),
      lng: c.req.query("lng"),
      radiusMeters: c.req.query("radiusMeters"),
      radius: c.req.query("radius"),
      category: c.req.query("category"),
      page: c.req.query("page"),
      limit: c.req.query("limit"),
    });
    return c.json(await nearbyPlaces(auth.uid, query));
  } catch (error) {
    return spatialFailure(c, error);
  }
});

app.get("/v1/spatial/places/search", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  try {
    return c.json({
      results: await searchLocations(auth.uid, c.req.query("q") ?? ""),
    });
  } catch (error) {
    return spatialFailure(c, error);
  }
});

app.post("/v1/internal/spatial/places/sync", async (c) => {
  const configuredSecret = process.env.SPATIAL_SYNC_SECRET;
  if (
    !configuredSecret ||
    c.req.header("x-spatial-sync-secret") !== configuredSecret
  ) {
    return c.json({ error: "Not found" }, 404);
  }
  try {
    return c.json({
      ok: true,
      placeCount: await syncConfiguredPilotPlaces(),
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    return spatialFailure(c, error);
  }
});

app.post("/v1/spatial/observations", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const body = (await c.req.json().catch(() => null)) as
    | Parameters<typeof submitImageObservation>[1]
    | null;
  if (!body) return c.json({ error: "Observation body is required." }, 400);
  try {
    return c.json(
      { submission: await submitImageObservation(auth.uid, body) },
      202,
    );
  } catch (error) {
    return spatialFailure(c, error);
  }
});

app.get("/v1/spatial/observations/:id", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  try {
    return c.json({
      submission: await getObservationSubmission(auth.uid, c.req.param("id")),
    });
  } catch (error) {
    return spatialFailure(c, error);
  }
});

app.get("/v1/spatial/places/:id", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  try {
    const place = await getSpatialPlaceById(c.req.param("id"));
    if (!place) return c.json({ error: "Place not found." }, 404);
    const insights = await getPlaceInsights(place.id);
    return c.json({ place, insights: insights.insights, generatedAt: insights.generatedAt });
  } catch (error) {
    return spatialFailure(c, error);
  }
});

app.get("/v1/spatial/places/:id/insights", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  try {
    return c.json(await getPlaceInsights(c.req.param("id")));
  } catch (error) {
    return spatialFailure(c, error);
  }
});

app.get("/v1/spatial/places/:id/insights/stream", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const placeId = c.req.param("id");
  return streamSSE(c, async (stream) => {
    const snapshot = await getPlaceInsights(placeId);
    await stream.writeSSE({
      event: "snapshot",
      data: JSON.stringify(snapshot),
    });
    const unsubscribe = subscribePlaceInsights(placeId, (insight) => {
      void stream.writeSSE({
        event: "insight",
        data: JSON.stringify(insight),
      });
    });
    const heartbeat = setInterval(() => {
      void stream.writeSSE({ event: "ping", data: "{}" });
    }, 15_000);
    await new Promise<void>((resolve) => {
      stream.onAbort(() => {
        clearInterval(heartbeat);
        unsubscribe();
        resolve();
      });
    });
  });
});

app.post("/v1/spatial/query", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const body = (await c.req.json().catch(() => null)) as {
    question?: string;
    location?: { latitude?: number; longitude?: number };
    radiusMeters?: number;
  } | null;
  if (!body?.question || !body.location) {
    return c.json({ error: "question and location are required." }, 400);
  }
  try {
    return c.json(
      await answerSpatialQuery(
        auth.uid,
        body.question,
        {
          latitude: Number(body.location.latitude),
          longitude: Number(body.location.longitude),
        },
        body.radiusMeters,
      ),
    );
  } catch (error) {
    return spatialFailure(c, error);
  }
});

app.post("/v1/spatial/insights/feedback", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const body = (await c.req.json().catch(() => null)) as {
    insightId?: string;
    helpful?: boolean;
    note?: string;
  } | null;
  try {
    await submitObservationFeedback(auth.uid, {
      insightId: String(body?.insightId ?? ""),
      helpful: body?.helpful === true,
      note: body?.note,
    });
    return c.json({ ok: true });
  } catch (error) {
    return spatialFailure(c, error);
  }
});

app.delete("/v1/spatial/contributions", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  try {
    return c.json({ deleted: await deleteContributions(auth.uid) });
  } catch (error) {
    return spatialFailure(c, error);
  }
});

/** Public marketing waitlist. Body: { email, source? } */
app.post("/v1/waitlist", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    email?: string;
    source?: string;
  } | null;

  try {
    const record = await joinWaitlist({
      email: String(body?.email ?? ""),
      source: body?.source,
    });
    return c.json({
      ok: true,
      email: record.email,
      alreadyJoined: record.alreadyJoined,
      mode: isFirebaseConfigured() ? "firebase" : "mock",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed";
    return c.json({ error: message }, 400);
  }
});

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

/** Checkout is not verification-exempt. Unverified password accounts get 403. */
app.post("/v1/billing/checkout", async (c) => {
  if (!billingEnabled) return c.json({ error: "Billing is not available." }, 404);
  if (!isStripeConfigured()) {
    return c.json({ error: "Billing not configured" }, 503);
  }
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);

  const profile =
    (await loadProfile(auth.uid)) ?? demoSelf(auth.uid, auth.email);
  if (hasProAccess(profile)) {
    return c.json({ error: "Already on Pro" }, 409);
  }

  const body = (await c.req.json().catch(() => null)) as {
    interval?: string;
    promoCode?: string | null;
    referralCode?: string | null;
  } | null;
  const interval = body?.interval === "year" ? "year" : "month";

  try {
    const session = await createCheckoutSession({
      uid: auth.uid,
      email: auth.email ?? profile.email,
      stripeCustomerId: profile.stripeCustomerId,
      stripeCustomerIdTest: profile.stripeCustomerIdTest,
      stripeCustomerIdLive: profile.stripeCustomerIdLive,
      interval,
      promoCode:
        typeof body?.promoCode === "string" ? body.promoCode : null,
      referralCode:
        (typeof body?.referralCode === "string"
          ? body.referralCode
          : profile.referredByCode) ?? null,
    });
    return c.json(session);
  } catch (err) {
    console.error("[billing] checkout error", err);
    return c.json({ error: "Couldn't start checkout, try again." }, 500);
  }
});

app.get("/v1/referrals", async (c) => {
  if (!billingEnabled) return c.json({ error: "Billing is not available." }, 404);
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const summary = await referralSummary(auth.uid);
  if (!summary) {
    return c.json({ error: "Referrals are available on Pro" }, 403);
  }
  return c.json(summary);
});

app.post("/v1/billing/portal", async (c) => {
  if (!billingEnabled) return c.json({ error: "Billing is not available." }, 404);
  if (!isStripeConfigured()) {
    return c.json({ error: "Billing not configured" }, 503);
  }
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);

  const profile = await loadProfile(auth.uid);
  const customerId = profile ? stripeCustomerIdForProfile(profile) : null;
  if (!customerId) {
    return c.json({ error: "No billing account yet" }, 404);
  }

  try {
    const session = await createPortalSession({
      stripeCustomerId: customerId,
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

app.get("/v1/connectors/google/calendar", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  return c.json(await getGoogleCalendarStatus(auth.uid));
});

app.get("/v1/connectors/google/calendar/start", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  try {
    const next = c.req.query("next") === "demo" ? "demo" : undefined;
    return c.json({ url: buildGoogleAuthUrl(auth.uid, next) });
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Google Calendar is not configured",
      },
      400,
    );
  }
});

/** Browser redirect from Google — no Bearer header. */
app.get("/v1/connectors/google/calendar/callback", async (c) => {
  const redirectTo = await handleGoogleCalendarCallback({
    code: c.req.query("code"),
    state: c.req.query("state"),
    error: c.req.query("error"),
  });
  return c.redirect(redirectTo, 302);
});

app.delete("/v1/connectors/google/calendar", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  await disconnectGoogleCalendar(auth.uid);
  return c.json({ ok: true });
});

app.post("/v1/agent", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (body && typeof body === "object" && (body as { demo?: unknown }).demo === true) {
    const text = (body as { text?: unknown }).text;
    if (typeof text !== "string" || !text.trim()) {
      return c.json({ error: "Say or type a task first" }, 400);
    }
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    const identifier =
      forwarded ||
      c.req.header("cf-connecting-ip") ||
      c.req.header("x-real-ip") ||
      "local-demo";
    const limit = await consumeDemoTry(identifier);
    if (!limit.allowed) {
      return c.json(
        {
          code: "demo_limit_reached",
          error: "Connect your Google to make it real",
          remaining: 0,
        },
        429,
      );
    }
    return c.json({ ...runDemoTurn(text), remaining: limit.remaining });
  }
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  try {
    return c.json(await runAgentTurn(auth.uid, body));
  } catch (error) {
    if (error instanceof LimitReachedError) {
      return c.json(
        {
          code: error.code,
          feature: error.feature,
          resetAt: error.resetAt,
        },
        402,
      );
    }
    const message = error instanceof Error ? error.message : "Failed";
    console.error("[agent]", message);
    return c.json({ error: message }, 400);
  }
});

app.post("/v1/agent/speech", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json().catch(() => null);
  const audioBase64 =
    body && typeof body === "object"
      ? (body as { audioBase64?: unknown }).audioBase64
      : null;
  const timeZone =
    body && typeof body === "object"
      ? (body as { timeZone?: unknown }).timeZone
      : undefined;
  const location =
    body && typeof body === "object"
      ? (body as { location?: unknown }).location
      : undefined;
  if (typeof audioBase64 !== "string" || audioBase64.length < 100) {
    return c.json({ error: "Missing audio" }, 400);
  }
  if (audioBase64.length > 8_000_000) {
    return c.json({ error: "Audio is too long" }, 400);
  }
  try {
    const bytes = Buffer.from(audioBase64, "base64");
    const file = new File([bytes], "turn.wav", { type: "audio/wav" });
    const { text } = await transcribeAudio(file);
    const deviceLocation = isDeviceLocation(location) ? location : null;
    if (turnNeedsDeviceLocation(text) && !deviceLocation) {
      return c.json({ code: "location_required", text }, 409);
    }
    const turn = await runAgentTurn(auth.uid, {
      text,
      timeZone: typeof timeZone === "string" ? timeZone : undefined,
      location: deviceLocation ?? undefined,
    });
    return c.json({ ...turn, text });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed";
    console.error("[agent-speech]", message);
    return c.json({ error: message }, 400);
  }
});

app.get("/v1/agent/memories", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const memories = await listAgentMemories(auth.uid, c.req.query("q") ?? "");
  return c.json({ memories });
});

app.get("/v1/agent/notes", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const notes = await listAgentNotes(auth.uid);
  return c.json({ notes });
});

app.get("/v1/agent/history", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const timeZone = c.req.query("timeZone") ?? undefined;
  const [history, usage] = await Promise.all([
    listAgentHistory(auth.uid),
    getAgentUsage(auth.uid, timeZone),
  ]);
  return c.json({ history, usage });
});

app.delete("/v1/agent/history", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  await clearAgentHistory(auth.uid);
  return c.json({ ok: true });
});

app.get("/v1/agent/usage", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  return c.json({
    usage: await getAgentUsage(auth.uid, c.req.query("timeZone") ?? undefined),
  });
});

app.get("/v1/voice-memos", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  return c.json(await listVoiceMemos(auth.uid));
});

app.post("/v1/voice-memos", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  try {
    const form = await c.req.formData();
    const audio = form.get("audio");
    if (!(audio instanceof File)) {
      return c.json({ error: "Audio file required" }, 400);
    }
    const claimedDurationSeconds = Number(form.get("durationSeconds"));
    const timeZone = String(form.get("timeZone") ?? "");
    return c.json(
      await createVoiceMemo(auth.uid, {
        audio,
        claimedDurationSeconds,
        timeZone,
      }),
      201,
    );
  } catch (error) {
    if (error instanceof VoiceMemoAccessError) {
      return c.json(
        {
          code: error.code,
          error: error.message,
          pricingUrl: "/pricing",
        },
        error.code === "pro_required" ? 403 : 429,
      );
    }
    const message = error instanceof Error ? error.message : "Voice memo failed";
    console.error("[voice-memo]", message);
    return c.json({ error: message }, 400);
  }
});

app.patch("/v1/voice-memos/:memoId/actions/:actionId", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const body = (await c.req.json().catch(() => null)) as {
    decision?: string;
    details?: unknown;
    timeZone?: string;
  } | null;
  if (body?.decision !== "confirm" && body?.decision !== "skip") {
    return c.json({ error: "Decision must be confirm or skip" }, 400);
  }
  try {
    const action = await decideVoiceMemoAction(auth.uid, {
      memoId: c.req.param("memoId"),
      actionId: c.req.param("actionId"),
      decision: body.decision,
      details: body.details,
      timeZone: body.timeZone,
    });
    return c.json({ action });
  } catch (error) {
    if (error instanceof VoiceMemoAccessError) {
      return c.json(
        { code: error.code, error: error.message, pricingUrl: "/pricing" },
        403,
      );
    }
    const message = error instanceof Error ? error.message : "Action failed";
    return c.json({ error: message }, 400);
  }
});

app.delete("/v1/voice-memos/:memoId", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const deleted = await deleteVoiceMemo(auth.uid, c.req.param("memoId"));
  return deleted
    ? c.json({ ok: true })
    : c.json({ error: "Voice memo not found" }, 404);
});

app.delete("/v1/agent/memories/:id", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const id = c.req.param("id").trim();
  if (!id) return c.json({ error: "Missing memory id" }, 400);
  await deleteAgentMemory(auth.uid, id);
  return c.json({ ok: true });
});

app.delete("/v1/agent/memories", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  await deleteAllMemories(auth.uid);
  return c.json({ ok: true });
});

app.delete("/v1/agent/notes/:id", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const id = c.req.param("id").trim();
  if (!id) return c.json({ error: "Missing note id" }, 400);
  await deleteAgentNote(auth.uid, id);
  return c.json({ ok: true });
});

app.get("/v1/phone", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  return c.json({
    phone: publicPhoneStatus(await getPhoneStatus(auth.uid)),
    quote: phoneProvisioningQuote(),
  });
});

app.post("/v1/phone/verify/start", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const body = (await c.req.json().catch(() => null)) as {
    phoneNumber?: string;
  } | null;
  try {
    return c.json(
      await startPhoneVerification(auth.uid, String(body?.phoneNumber ?? "")),
      202,
    );
  } catch (error) {
    const status = error instanceof PhoneError ? error.status : 500;
    return c.json(
      {
        code: error instanceof PhoneError ? error.code : "phone_error",
        error: error instanceof Error ? error.message : "Verification failed",
      },
      status as 400,
    );
  }
});

app.post("/v1/phone/verify/check", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const body = (await c.req.json().catch(() => null)) as { code?: string } | null;
  try {
    return c.json({
      phone: publicPhoneStatus(
        await checkPhoneVerification(auth.uid, String(body?.code ?? "")),
      ),
    });
  } catch (error) {
    const status = error instanceof PhoneError ? error.status : 500;
    return c.json(
      {
        code: error instanceof PhoneError ? error.code : "phone_error",
        error: error instanceof Error ? error.message : "Verification failed",
      },
      status as 400,
    );
  }
});

app.post("/v1/phone/provision", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const body = (await c.req.json().catch(() => null)) as {
    confirmMonthlyCharge?: boolean;
  } | null;
  try {
    return c.json({
      phone: publicPhoneStatus(
        await provisionNearbyNumber(
          auth.uid,
          body?.confirmMonthlyCharge === true,
        ),
      ),
    });
  } catch (error) {
    const status = error instanceof PhoneError ? error.status : 500;
    return c.json(
      {
        code: error instanceof PhoneError ? error.code : "phone_error",
        error: error instanceof Error ? error.message : "Provisioning failed",
      },
      status as 400,
    );
  }
});

app.post("/v1/invites", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  try {
    return c.json(await createInvite(auth.uid));
  } catch (error) {
    const status = error instanceof InviteError ? error.status : 500;
    return c.json(
      {
        code: error instanceof InviteError ? error.code : "invite_error",
        error: error instanceof Error ? error.message : "Could not create an invite",
      },
      status as 400,
    );
  }
});

app.post("/v1/invites/:code/accept", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  try {
    return c.json(await acceptInvite(auth.uid, c.req.param("code")));
  } catch (error) {
    const status = error instanceof InviteError ? error.status : 500;
    return c.json(
      {
        code: error instanceof InviteError ? error.code : "invite_error",
        error: error instanceof Error ? error.message : "Could not accept that invite",
      },
      status as 400,
    );
  }
});

app.get("/v1/conversations", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  try {
    return c.json({ conversations: await listConversations(auth.uid) });
  } catch (error) {
    const status = error instanceof MessagingError ? error.status : 500;
    return c.json(
      {
        code: error instanceof MessagingError ? error.code : "messaging_error",
        error: error instanceof Error ? error.message : "Could not load conversations",
      },
      status as 400,
    );
  }
});

app.post("/v1/conversations", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const body = (await c.req.json().catch(() => null)) as {
    recipientId?: string;
  } | null;
  try {
    return c.json(
      {
        conversation: await startConversation(
          auth.uid,
          String(body?.recipientId ?? ""),
        ),
      },
      201,
    );
  } catch (error) {
    const status = error instanceof MessagingError ? error.status : 500;
    return c.json(
      {
        code: error instanceof MessagingError ? error.code : "messaging_error",
        error: error instanceof Error ? error.message : "Could not start chat",
      },
      status as 400,
    );
  }
});

app.get("/v1/conversations/:conversationId/messages", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  try {
    return c.json({
      messages: await listMessages(auth.uid, c.req.param("conversationId")),
    });
  } catch (error) {
    const status = error instanceof MessagingError ? error.status : 500;
    return c.json(
      { error: error instanceof Error ? error.message : "Could not load messages" },
      status as 400,
    );
  }
});

app.post("/v1/conversations/:conversationId/messages", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const body = (await c.req.json().catch(() => null)) as {
    content?: string;
  } | null;
  try {
    return c.json(
      {
        message: await sendMessage(
          auth.uid,
          c.req.param("conversationId"),
          String(body?.content ?? ""),
        ),
      },
      201,
    );
  } catch (error) {
    const status = error instanceof MessagingError ? error.status : 500;
    return c.json(
      {
        code: error instanceof MessagingError ? error.code : "messaging_error",
        error: error instanceof Error ? error.message : "Could not send message",
      },
      status as 400,
    );
  }
});

app.post("/v1/conversations/:conversationId/block", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  try {
    return c.json(
      await blockConversationUser(auth.uid, c.req.param("conversationId")),
    );
  } catch (error) {
    const status = error instanceof MessagingError ? error.status : 500;
    return c.json(
      { error: error instanceof Error ? error.message : "Could not block user" },
      status as 400,
    );
  }
});

app.post("/v1/conversations/:conversationId/report", async (c) => {
  const auth = await verifyAuth(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const body = (await c.req.json().catch(() => null)) as { reason?: string } | null;
  try {
    return c.json(
      await reportConversationUser(
        auth.uid,
        c.req.param("conversationId"),
        String(body?.reason ?? ""),
      ),
    );
  } catch (error) {
    const status = error instanceof MessagingError ? error.status : 500;
    return c.json(
      { error: error instanceof Error ? error.message : "Could not report user" },
      status as 400,
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
