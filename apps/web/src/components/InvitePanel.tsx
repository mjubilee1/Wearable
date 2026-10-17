"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_PHONE_COUNTRY,
  inviteJoinMessage,
  toE164Phone,
  type PhoneCountryCode,
} from "@nearby/shared";
import { PhoneNumberField } from "@/components/PhoneNumberField";
import { useAuth } from "@/lib/auth-context";
import { createInvite } from "@/lib/phone-messaging";

export function InvitePanel() {
  const { user } = useAuth();
  const [link, setLink] = useState<string | null>(null);
  const [country, setCountry] = useState<PhoneCountryCode>(DEFAULT_PHONE_COUNTRY);
  const [national, setNational] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void user
      .getIdToken()
      .then(createInvite)
      .then(({ code }) => {
        if (!cancelled) setLink(`${window.location.origin}/invite/${code}`);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not create an invite");
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function copyLink() {
    if (!link) return;
    setError(null);
    try {
      await navigator.clipboard.writeText(link);
      setNotice("Link copied.");
    } catch {
      setError("Could not copy the link.");
    }
  }

  async function shareLink() {
    if (!link) return;
    setError(null);
    const message = inviteJoinMessage(link);
    if (navigator.share) {
      try {
        await navigator.share({ text: message, url: link });
        return;
      } catch {
        // A cancelled share is not a failure. Fall through to copy.
      }
    }
    await copyLink();
  }

  function textLink() {
    if (!link) return;
    const e164 = toE164Phone(country, national);
    if (!e164) {
      setError("Enter their mobile number, or share the link instead.");
      return;
    }
    setError(null);
    const body = encodeURIComponent(inviteJoinMessage(link));
    window.location.href = `sms:${e164}?&body=${body}`;
  }

  return (
    <div className="border-t border-black/5 px-3 py-4">
      <p className="text-sm font-semibold text-ink">Invite someone</p>
      <p className="mt-1 text-sm text-muted">
        They create an account from your link, then you can message them here. Nearby does not send the conversation.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={!link}
          onClick={() => void copyLink()}
          className="rounded-2xl bg-teal px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          Copy link
        </button>
        <button
          type="button"
          disabled={!link}
          onClick={() => void shareLink()}
          className="rounded-2xl border border-black/10 px-3 py-2 text-sm font-semibold text-ink disabled:opacity-60"
        >
          Share link
        </button>
      </div>
      <div className="mt-4">
        <PhoneNumberField
          country={country}
          national={national}
          onChange={(next) => {
            setCountry(next.country);
            setNational(next.national);
            setError(null);
          }}
        />
        <button
          type="button"
          disabled={!link}
          onClick={textLink}
          className="mt-3 w-full rounded-2xl border border-black/10 px-3 py-2 text-sm font-semibold text-ink disabled:opacity-60"
        >
          Text the link
        </button>
      </div>
      {notice ? <p className="mt-3 text-sm text-teal">{notice}</p> : null}
      {error ? <p className="mt-3 text-sm text-coral">{error}</p> : null}
    </div>
  );
}
