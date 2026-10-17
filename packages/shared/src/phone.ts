import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  getExampleNumber,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";
import examples from "libphonenumber-js/mobile/examples";

export type PhoneCountryCode = CountryCode;

export type PhoneCountry = {
  iso: PhoneCountryCode;
  name: string;
  callingCode: string;
};

export const DEFAULT_PHONE_COUNTRY: PhoneCountryCode = "US";

function regionName(iso: string): string {
  const DisplayNames = Intl.DisplayNames;
  if (typeof DisplayNames !== "function") return iso;
  try {
    return new DisplayNames(["en"], { type: "region" }).of(iso) ?? iso;
  } catch {
    return iso;
  }
}

let countries: PhoneCountry[] | null = null;

export function listPhoneCountries(): PhoneCountry[] {
  if (countries) return countries;
  countries = getCountries()
    .map((iso) => ({
      iso,
      name: regionName(iso),
      callingCode: getCountryCallingCode(iso),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
  return countries;
}

export function phonePlaceholder(country: PhoneCountryCode): string {
  return getExampleNumber(country, examples)?.formatNational() ?? "";
}

/** Format what the person typed into the national pattern for the selected country. */
export function applyNationalPhoneInput(
  country: PhoneCountryCode,
  raw: string,
): { country: PhoneCountryCode; national: string } {
  const trimmed = raw.trim();
  if (trimmed.startsWith("+")) {
    const parsed = parsePhoneNumberFromString(trimmed);
    if (parsed?.country) {
      return {
        country: parsed.country,
        national: nationalFormat(parsed.country, parsed.nationalNumber),
      };
    }
  }
  return { country, national: nationalFormat(country, raw) };
}

/** E.164 for the API, or null when the number is not valid for that country. */
export function toE164Phone(country: PhoneCountryCode, national: string): string | null {
  const parsed = parsePhoneNumberFromString(national, country);
  if (!parsed?.isValid()) return null;
  return parsed.number;
}

function nationalFormat(country: PhoneCountryCode, raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  const callingCode = getCountryCallingCode(country);
  if (digits.startsWith(callingCode)) {
    const international = parsePhoneNumberFromString(`+${digits}`);
    if (international?.country === country && international.nationalNumber) {
      return new AsYouType(country).input(international.nationalNumber);
    }
  }
  return new AsYouType(country).input(digits);
}
