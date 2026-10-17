"use client";

import { useEffect, useState } from "react";
import { DEFAULT_PHONE_COUNTRY, toE164Phone, type PhoneCountryCode } from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
import { PhoneNumberField } from "@/components/PhoneNumberField";
import {
  checkPhoneVerification,
  getPhone,
  provisionPhone,
  startPhoneVerification,
  type PhoneQuote,
  type PhoneStatus,
} from "@/lib/phone-messaging";

export function PhoneSetup({
  compact = false,
  onComplete,
}: {
  compact?: boolean;
  onComplete?: (phone: PhoneStatus) => void;
}) {
  const { user, refreshProfile } = useAuth();
  const [status, setStatus] = useState<PhoneStatus | null>(null);
  const [quote, setQuote] = useState<PhoneQuote | null>(null);
  const [choice, setChoice] = useState<"personal" | "assigned" | null>(null);
  const [country, setCountry] = useState<PhoneCountryCode>(DEFAULT_PHONE_COUNTRY);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    void user.getIdToken().then(getPhone).then(({ phone: value, quote: valueQuote }) => {
      setStatus(value);
      setQuote(valueQuote);
      if (value.phoneVerified) onComplete?.(value);
    }).catch((err) => setError(err instanceof Error ? err.message : "Could not load phone settings"));
    // onComplete is intentionally not a dependency; loading is keyed to the signed-in user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function token() {
    if (!user) throw new Error("Sign in first");
    return user.getIdToken();
  }

  async function sendCode() {
    setBusy(true);
    setError(null);
    const e164 = toE164Phone(country, phone);
    if (!e164) {
      setError("Enter a valid mobile number for this country.");
      setBusy(false);
      return;
    }
    try {
      await startPhoneVerification(await token(), e164);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send code");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    setBusy(true);
    setError(null);
    try {
      const result = await checkPhoneVerification(await token(), code);
      await refreshProfile();
      setStatus(result.phone);
      setChoice(null);
      onComplete?.(result.phone);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not verify code");
    } finally {
      setBusy(false);
    }
  }

  async function provision() {
    if (!window.confirm(`Confirm an estimated $${quote?.monthly.toFixed(2) ?? "1.40"}/month phone-number charge?`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await provisionPhone(await token());
      await refreshProfile();
      setStatus(result.phone);
      setChoice(null);
      onComplete?.(result.phone);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not assign a number");
    } finally {
      setBusy(false);
    }
  }

  if (status?.phoneVerified && !choice) {
    return (
      <section className="rounded-3xl border border-black/5 bg-card p-5 shadow-sm">
        <p className="text-sm font-bold text-ink">Phone number</p>
        <p className="mt-2 text-lg font-semibold text-ink">{status.phoneNumber}</p>
        <p className="mt-1 text-sm text-muted">
          {status.phoneNumberType === "PERSONAL" ? "Personal · verified" : "Nearby-assigned · active"}
        </p>
        {status.phoneNumberType === "PERSONAL" ? (
          <button
            type="button"
            onClick={() => {
              setChoice("personal");
              setSent(false);
              setCode("");
            }}
            className="mt-4 text-sm font-semibold text-teal"
          >
            Change number securely
          </button>
        ) : (
          <p className="mt-3 text-xs text-muted">
            Contact support before changing an assigned number so it is not released or reassigned accidentally.
          </p>
        )}
      </section>
    );
  }

  return (
    <section className={compact ? "" : "rounded-3xl border border-black/5 bg-card p-5 shadow-sm"}>
      <h2 className="text-xl font-bold text-ink">Choose Your Phone Number</h2>
      <p className="mt-2 text-sm text-muted">
        Your personal number stays private. Either choice uses the same in-app messaging.
      </p>

      {!choice ? (
        <div className="mt-5 grid gap-3">
          <button
            type="button"
            onClick={() => setChoice("personal")}
            className="rounded-2xl border border-black/10 p-4 text-left hover:border-teal"
          >
            <span className="block text-sm font-bold text-ink">Use my existing number</span>
            <span className="mt-1 block text-sm text-muted">Verify it with a one-time SMS code.</span>
          </button>
          <button
            type="button"
            onClick={() => setChoice("assigned")}
            className="rounded-2xl border border-black/10 p-4 text-left hover:border-teal"
          >
            <span className="block text-sm font-bold text-ink">Get a Nearby number</span>
            <span className="mt-1 block text-sm text-muted">
              Estimated ${quote?.monthly.toFixed(2) ?? "1.40"}/month, plus taxes and carrier fees.
            </span>
          </button>
        </div>
      ) : null}

      {choice === "personal" ? (
        <div className="mt-5 space-y-3">
          {!sent ? (
            <>
              <PhoneNumberField
                country={country}
                national={phone}
                onChange={(next) => {
                  setCountry(next.country);
                  setPhone(next.national);
                }}
              />
              <button type="button" disabled={busy} onClick={sendCode} className="w-full rounded-2xl bg-teal px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
                {busy ? "Sending…" : "Send verification code"}
              </button>
            </>
          ) : (
            <>
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-ink">Verification code</span>
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  className="w-full rounded-2xl border border-black/10 px-4 py-3 text-sm outline-none ring-teal/30 focus:ring-2"
                />
              </label>
              <button type="button" disabled={busy} onClick={verifyCode} className="w-full rounded-2xl bg-teal px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
                {busy ? "Checking…" : "Verify number"}
              </button>
            </>
          )}
        </div>
      ) : null}

      {choice === "assigned" ? (
        <div className="mt-5 rounded-2xl bg-surface p-4">
          <p className="text-sm text-ink">
            Estimated <strong>${quote?.monthly.toFixed(2) ?? "1.40"}/month</strong>. This confirmation may purchase a real Twilio number only when purchases are enabled by an operator.
          </p>
          <p className="mt-2 text-xs text-muted">{quote?.note}</p>
          <button type="button" disabled={busy} onClick={provision} className="mt-4 w-full rounded-2xl bg-teal px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
            {busy ? "Assigning…" : "Confirm and assign number"}
          </button>
        </div>
      ) : null}

      {choice ? (
        <button type="button" disabled={busy} onClick={() => setChoice(null)} className="mt-3 text-sm font-semibold text-muted">
          Back
        </button>
      ) : null}
      {error ? <p className="mt-3 rounded-2xl bg-coral-soft px-3 py-2 text-sm text-coral">{error}</p> : null}
    </section>
  );
}
