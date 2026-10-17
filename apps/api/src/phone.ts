import { createHash } from "node:crypto";
import type {
  PhoneNumberType,
  PhoneProvisioningStatus,
} from "@nearby/shared";
import { getFirebaseAdmin, isFirebaseConfigured } from "./firebase.js";

/** Production only: texts started per user, and per destination number, each hour. */
const VERIFY_START_LIMIT = 5;
/** Production only: code submissions per user each hour. */
const VERIFY_CHECK_LIMIT = 5;
const HOUR_MS = 60 * 60 * 1000;

export type PhoneStatus = {
  phoneNumber: string | null;
  phoneNumberType: PhoneNumberType | null;
  phoneVerified: boolean;
  twilioPhoneNumberSid: string | null;
  phoneProvisioningStatus: PhoneProvisioningStatus;
  phoneCreatedAt: number | null;
};

export function publicPhoneStatus(status: PhoneStatus) {
  const { twilioPhoneNumberSid: _privateSid, ...safe } = status;
  return safe;
}

export class PhoneError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "phone_error",
  ) {
    super(message);
  }
}

type PrivatePhoneDoc = PhoneStatus & {
  pendingPhoneNumber?: string | null;
  provisioningError?: string | null;
  updatedAt: number;
};

const emptyStatus: PhoneStatus = {
  phoneNumber: null,
  phoneNumberType: null,
  phoneVerified: false,
  twilioPhoneNumberSid: null,
  phoneProvisioningStatus: "NONE",
  phoneCreatedAt: null,
};

const mockPhones = new Map<string, PrivatePhoneDoc>();
const mockClaims = new Map<string, string>();
const mockLimits = new Map<string, { count: number; expiresAt: number }>();
const mockProvisionFailures = new Set<string>();

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizePhoneNumber(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  const normalized =
    trimmed.startsWith("+") ? `+${digits}` : digits.length === 10 ? `+1${digits}` : "";
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    throw new PhoneError("Enter a valid phone number including country code");
  }
  return normalized;
}

function twilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_VERIFY_SERVICE_SID,
  );
}

function mockMode(): boolean {
  return process.env.TWILIO_MOCK === "true";
}

async function twilioRequest<T>(
  path: string,
  body?: URLSearchParams,
  method = "POST",
): Promise<T> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) throw new PhoneError("Twilio is not configured", 503);
  const host = path.startsWith("/v2/") ? "https://verify.twilio.com" : "https://api.twilio.com";
  const response = await fetch(`${host}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body,
  });
  const payload = (await response.json().catch(() => ({}))) as T & {
    message?: string;
  };
  if (!response.ok) {
    throw new PhoneError(payload.message ?? "Twilio request failed", 502, "twilio_error");
  }
  return payload;
}

function verificationLimitsEnforced(): boolean {
  return process.env.NODE_ENV === "production";
}

function noteDevelopmentAttempt(action: string): void {
  const bucket = Math.floor(Date.now() / HOUR_MS);
  const key = `${action}:${bucket}`;
  const current = mockLimits.get(key);
  const count = (current?.count ?? 0) + 1;
  mockLimits.set(key, { count, expiresAt: (bucket + 1) * HOUR_MS });
  console.info(`phone ${action} attempt ${count} (development, no limit)`);
}

async function consumeLimit(
  scope: string,
  action: string,
  limit: number,
): Promise<void> {
  if (!verificationLimitsEnforced()) {
    noteDevelopmentAttempt(action);
    return;
  }
  const bucket = Math.floor(Date.now() / HOUR_MS);
  const key = hash(`${scope}:${action}:${bucket}`);
  if (!isFirebaseConfigured()) {
    const current = mockLimits.get(key);
    if (current && current.count >= limit) {
      throw new PhoneError("Too many attempts. Try again later.", 429, "rate_limited");
    }
    mockLimits.set(key, {
      count: (current?.count ?? 0) + 1,
      expiresAt: (bucket + 1) * HOUR_MS,
    });
    return;
  }
  const db = getFirebaseAdmin().firestore();
  const ref = db.collection("rateLimits").doc(key);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = Number(snap.data()?.count ?? 0);
    if (count >= limit) {
      throw new PhoneError("Too many attempts. Try again later.", 429, "rate_limited");
    }
    tx.set(ref, {
      scope,
      action,
      count: count + 1,
      expiresAt: (bucket + 1) * HOUR_MS,
    });
  });
}

export async function getPhoneStatus(uid: string): Promise<PhoneStatus> {
  if (!isFirebaseConfigured()) {
    const row = mockPhones.get(uid);
    return row ? { ...emptyStatus, ...row } : { ...emptyStatus };
  }
  const snap = await getFirebaseAdmin()
    .firestore()
    .collection("userPrivate")
    .doc(uid)
    .get();
  return snap.exists
    ? { ...emptyStatus, ...(snap.data() as Partial<PhoneStatus>) }
    : { ...emptyStatus };
}

export async function startPhoneVerification(uid: string, rawPhone: string) {
  const phoneNumber = normalizePhoneNumber(rawPhone);
  const existing = await getPhoneStatus(uid);
  if (
    existing.phoneNumberType === "NEARBY_ASSIGNED" &&
    existing.phoneProvisioningStatus === "ACTIVE"
  ) {
    throw new PhoneError(
      "Contact support before changing an assigned number",
      409,
      "assigned_number_change_requires_support",
    );
  }
  if (!mockMode() && !twilioConfigured()) {
    throw new PhoneError("Twilio Verify is not configured", 503, "twilio_not_configured");
  }
  if (verificationLimitsEnforced()) {
    await consumeLimit(uid, "verify-start", VERIFY_START_LIMIT);
    await consumeLimit(`phone:${phoneNumber}`, "verify-start", VERIFY_START_LIMIT);
  } else {
    noteDevelopmentAttempt("verify-start");
  }
  if (mockMode()) {
    if (isFirebaseConfigured()) {
      await getFirebaseAdmin()
        .firestore()
        .collection("userPrivate")
        .doc(uid)
        .set(
          {
            pendingPhoneNumber: phoneNumber,
            phoneProvisioningStatus: "VERIFYING",
            updatedAt: Date.now(),
          },
          { merge: true },
        );
    } else {
      mockPhones.set(uid, {
        ...(mockPhones.get(uid) ?? emptyStatus),
        pendingPhoneNumber: phoneNumber,
        phoneProvisioningStatus: "VERIFYING",
        updatedAt: Date.now(),
      });
    }
    return { status: "pending" as const, mock: true };
  }
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID!;
  await twilioRequest(
    `/v2/Services/${encodeURIComponent(serviceSid)}/Verifications`,
    new URLSearchParams({ To: phoneNumber, Channel: "sms" }),
  );
  await getFirebaseAdmin()
    .firestore()
    .collection("userPrivate")
    .doc(uid)
    .set(
      {
        pendingPhoneNumber: phoneNumber,
        phoneProvisioningStatus: "VERIFYING",
        updatedAt: Date.now(),
      },
      { merge: true },
    );
  return { status: "pending" as const, mock: false };
}

export async function checkPhoneVerification(uid: string, code: string) {
  if (!/^\d{4,10}$/.test(code.trim())) {
    throw new PhoneError("Enter the verification code");
  }
  if (verificationLimitsEnforced()) {
    await consumeLimit(uid, "verify-check", VERIFY_CHECK_LIMIT);
  } else {
    noteDevelopmentAttempt("verify-check");
  }

  if (!isFirebaseConfigured()) {
    const row = mockPhones.get(uid);
    if (!row?.pendingPhoneNumber) throw new PhoneError("Start verification first");
    if (code !== "000000") throw new PhoneError("That code is invalid or expired", 400, "invalid_code");
    const claim = hash(row.pendingPhoneNumber);
    const owner = mockClaims.get(claim);
    if (owner && owner !== uid) throw new PhoneError("That number is already in use", 409, "phone_in_use");
    if (row.phoneNumberType === "PERSONAL" && row.phoneNumber) {
      mockClaims.delete(hash(row.phoneNumber));
    }
    mockClaims.set(claim, uid);
    const now = Date.now();
    mockPhones.set(uid, {
      ...row,
      phoneNumber: row.pendingPhoneNumber,
      phoneNumberType: "PERSONAL",
      phoneVerified: true,
      twilioPhoneNumberSid: null,
      phoneProvisioningStatus: "ACTIVE",
      phoneCreatedAt: now,
      pendingPhoneNumber: null,
      updatedAt: now,
    });
    return getPhoneStatus(uid);
  }

  const db = getFirebaseAdmin().firestore();
  const privateRef = db.collection("userPrivate").doc(uid);
  const before = await privateRef.get();
  const pending = String(before.data()?.pendingPhoneNumber ?? "");
  if (!pending) throw new PhoneError("Start verification first");

  if (mockMode()) {
    if (code !== "000000") throw new PhoneError("That code is invalid or expired", 400, "invalid_code");
  } else {
    const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID!;
    const result = await twilioRequest<{ status?: string }>(
      `/v2/Services/${encodeURIComponent(serviceSid)}/VerificationCheck`,
      new URLSearchParams({ To: pending, Code: code.trim() }),
    );
    if (result.status !== "approved") {
      throw new PhoneError("That code is invalid or expired", 400, "invalid_code");
    }
  }

  const newClaimRef = db.collection("phoneNumberClaims").doc(hash(pending));
  const userRef = db.collection("users").doc(uid);
  await db.runTransaction(async (tx) => {
    const [privateSnap, claimSnap] = await Promise.all([
      tx.get(privateRef),
      tx.get(newClaimRef),
    ]);
    const data = privateSnap.data() ?? {};
    const owner = String(claimSnap.data()?.uid ?? "");
    if (owner && owner !== uid) {
      throw new PhoneError("That number is already in use", 409, "phone_in_use");
    }
    const oldPhone =
      data.phoneNumberType === "PERSONAL" ? String(data.phoneNumber ?? "") : "";
    const oldClaimRef =
      oldPhone && oldPhone !== pending
        ? db.collection("phoneNumberClaims").doc(hash(oldPhone))
        : null;
    const oldClaimSnap = oldClaimRef ? await tx.get(oldClaimRef) : null;
    const now = Date.now();
    tx.set(newClaimRef, { uid, phoneNumber: pending, claimedAt: now });
    if (oldClaimRef && oldClaimSnap?.data()?.uid === uid) tx.delete(oldClaimRef);
    tx.set(
      privateRef,
      {
        phoneNumber: pending,
        phoneNumberType: "PERSONAL",
        phoneVerified: true,
        twilioPhoneNumberSid: null,
        phoneProvisioningStatus: "ACTIVE",
        phoneCreatedAt: now,
        pendingPhoneNumber: null,
        provisioningError: null,
        updatedAt: now,
      },
      { merge: true },
    );
    tx.set(userRef, { phoneOnboardingRequired: false, updatedAt: now }, { merge: true });
  });
  return getPhoneStatus(uid);
}

export function phoneProvisioningQuote() {
  return {
    currency: "USD",
    monthly: Number(process.env.TWILIO_NUMBER_MONTHLY_USD ?? "1.40"),
    estimateOnly: true,
    note: "Taxes, carrier fees, and registration costs may apply. In-app Nearby messages are free of Twilio SMS charges.",
    purchasesEnabled: process.env.TWILIO_ENABLE_PHONE_PURCHASES === "true",
  };
}

type IncomingNumber = { sid: string; phone_number: string };

async function acquireTwilioNumber(uid: string): Promise<IncomingNumber> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID!;
  const friendlyName = `nearby-user-${uid}`;
  const existing = await twilioRequest<{ incoming_phone_numbers?: IncomingNumber[] }>(
    `/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers.json?FriendlyName=${encodeURIComponent(friendlyName)}&PageSize=1`,
    undefined,
    "GET",
  );
  if (existing.incoming_phone_numbers?.[0]) return existing.incoming_phone_numbers[0];

  const country = process.env.TWILIO_NUMBER_COUNTRY ?? "US";
  const available = await twilioRequest<{ available_phone_numbers?: IncomingNumber[] }>(
    `/2010-04-01/Accounts/${accountSid}/AvailablePhoneNumbers/${country}/Local.json?SmsEnabled=true&PageSize=1`,
    undefined,
    "GET",
  );
  const candidate = available.available_phone_numbers?.[0]?.phone_number;
  if (!candidate) throw new PhoneError("No SMS-capable numbers are available", 409, "number_unavailable");
  return twilioRequest<IncomingNumber>(
    `/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers.json`,
    new URLSearchParams({ PhoneNumber: candidate, FriendlyName: friendlyName }),
  );
}

export async function provisionNearbyNumber(uid: string, confirmed: boolean) {
  if (!confirmed) throw new PhoneError("Confirm the monthly charge before provisioning");
  if (
    !mockMode() &&
    (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN)
  ) {
    throw new PhoneError("Twilio phone provisioning is not configured", 503, "twilio_not_configured");
  }
  if (!mockMode() && process.env.TWILIO_ENABLE_PHONE_PURCHASES !== "true") {
    throw new PhoneError("Phone number purchases are disabled", 503, "purchases_disabled");
  }
  const current = await getPhoneStatus(uid);
  if (
    current.phoneNumberType === "NEARBY_ASSIGNED" &&
    current.phoneProvisioningStatus === "ACTIVE"
  ) {
    return current;
  }

  if (!isFirebaseConfigured()) {
    if (current.phoneProvisioningStatus === "PROCESSING") {
      throw new PhoneError("Provisioning is already in progress", 409, "provisioning_in_progress");
    }
    if (
      process.env.TWILIO_MOCK_PROVISION_FAILURE_ONCE === "true" &&
      !mockProvisionFailures.has(uid)
    ) {
      mockProvisionFailures.add(uid);
      mockPhones.set(uid, {
        ...(mockPhones.get(uid) ?? emptyStatus),
        phoneProvisioningStatus: "FAILED",
        provisioningError: "Mock provisioning failure",
        updatedAt: Date.now(),
      });
      throw new PhoneError("Mock provisioning failure", 502, "twilio_error");
    }
    const suffix = String(parseInt(hash(uid).slice(0, 6), 16) % 10_000).padStart(4, "0");
    const now = Date.now();
    if (current.phoneNumberType === "PERSONAL" && current.phoneNumber) {
      mockClaims.delete(hash(current.phoneNumber));
    }
    mockPhones.set(uid, {
      ...emptyStatus,
      phoneNumber: `+1555000${suffix}`,
      phoneNumberType: "NEARBY_ASSIGNED",
      phoneVerified: true,
      twilioPhoneNumberSid: `PNMOCK${hash(uid).slice(0, 12)}`,
      phoneProvisioningStatus: "ACTIVE",
      phoneCreatedAt: now,
      updatedAt: now,
    });
    return getPhoneStatus(uid);
  }

  const db = getFirebaseAdmin().firestore();
  const privateRef = db.collection("userPrivate").doc(uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(privateRef);
    const data = snap.data() ?? {};
    if (
      data.phoneNumberType === "NEARBY_ASSIGNED" &&
      data.phoneProvisioningStatus === "ACTIVE"
    ) return;
    if (data.phoneProvisioningStatus === "PROCESSING") {
      throw new PhoneError("Provisioning is already in progress", 409, "provisioning_in_progress");
    }
    tx.set(
      privateRef,
      { phoneProvisioningStatus: "PROCESSING", provisioningError: null, updatedAt: Date.now() },
      { merge: true },
    );
  });

  try {
    const purchased = mockMode()
      ? {
          sid: `PNMOCK${hash(uid).slice(0, 12)}`,
          phone_number: `+1555000${String(parseInt(hash(uid).slice(0, 6), 16) % 10_000).padStart(4, "0")}`,
        }
      : await acquireTwilioNumber(uid);
    const phoneNumber = normalizePhoneNumber(purchased.phone_number);
    const phoneClaimRef = db.collection("phoneNumberClaims").doc(hash(phoneNumber));
    const sidClaimRef = db.collection("twilioSidClaims").doc(purchased.sid);
    const userRef = db.collection("users").doc(uid);
    await db.runTransaction(async (tx) => {
      const [phoneClaim, sidClaim, privateSnap] = await Promise.all([
        tx.get(phoneClaimRef),
        tx.get(sidClaimRef),
        tx.get(privateRef),
      ]);
      for (const snap of [phoneClaim, sidClaim]) {
        const owner = String(snap.data()?.uid ?? "");
        if (owner && owner !== uid) {
          throw new PhoneError("The assigned number is already claimed", 409, "phone_in_use");
        }
      }
      const oldPersonalPhone =
        privateSnap.data()?.phoneNumberType === "PERSONAL"
          ? String(privateSnap.data()?.phoneNumber ?? "")
          : "";
      const oldClaimRef =
        oldPersonalPhone && oldPersonalPhone !== phoneNumber
          ? db.collection("phoneNumberClaims").doc(hash(oldPersonalPhone))
          : null;
      const oldClaim = oldClaimRef ? await tx.get(oldClaimRef) : null;
      const now = Date.now();
      tx.set(phoneClaimRef, { uid, phoneNumber, claimedAt: now });
      tx.set(sidClaimRef, { uid, phoneNumber, claimedAt: now });
      if (oldClaimRef && oldClaim?.data()?.uid === uid) tx.delete(oldClaimRef);
      tx.set(
        privateRef,
        {
          phoneNumber,
          phoneNumberType: "NEARBY_ASSIGNED",
          phoneVerified: true,
          twilioPhoneNumberSid: purchased.sid,
          phoneProvisioningStatus: "ACTIVE",
          phoneCreatedAt: now,
          provisioningError: null,
          updatedAt: now,
        },
        { merge: true },
      );
      tx.set(userRef, { phoneOnboardingRequired: false, updatedAt: now }, { merge: true });
    });
    return getPhoneStatus(uid);
  } catch (error) {
    await privateRef.set(
      {
        phoneProvisioningStatus: "FAILED",
        provisioningError: error instanceof Error ? error.message.slice(0, 200) : "Failed",
        updatedAt: Date.now(),
      },
      { merge: true },
    );
    throw error;
  }
}

export function resetPhoneMocksForTest() {
  mockPhones.clear();
  mockClaims.clear();
  mockLimits.clear();
  mockProvisionFailures.clear();
}
