"use client";

import { useMemo } from "react";
import {
  applyNationalPhoneInput,
  listPhoneCountries,
  phonePlaceholder,
  type PhoneCountryCode,
} from "@nearby/shared";

export function PhoneNumberField({
  country,
  national,
  onChange,
}: {
  country: PhoneCountryCode;
  national: string;
  onChange: (next: { country: PhoneCountryCode; national: string }) => void;
}) {
  const countries = useMemo(() => listPhoneCountries(), []);

  return (
    <div className="space-y-3">
      <label className="block space-y-1.5">
        <span className="text-xs font-semibold text-ink">Country</span>
        <select
          value={country}
          onChange={(event) =>
            onChange(applyNationalPhoneInput(event.target.value as PhoneCountryCode, national))
          }
          className="w-full rounded-2xl border border-black/10 bg-card px-4 py-3 text-sm outline-none ring-teal/30 focus:ring-2"
        >
          {countries.map((item) => (
            <option key={item.iso} value={item.iso}>
              {item.name} (+{item.callingCode})
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1.5">
        <span className="text-xs font-semibold text-ink">Mobile number</span>
        <input
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          placeholder={phonePlaceholder(country)}
          value={national}
          onChange={(event) => onChange(applyNationalPhoneInput(country, event.target.value))}
          className="w-full rounded-2xl border border-black/10 bg-card px-4 py-3 text-sm outline-none ring-teal/30 focus:ring-2"
        />
      </label>
    </div>
  );
}
