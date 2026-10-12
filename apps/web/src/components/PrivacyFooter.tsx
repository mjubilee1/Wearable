import { CONNECTOR_PRIVACY_LINE } from "@/lib/site";

export function PrivacyFooter() {
  return (
    <footer className="mt-8">
      <p className="max-w-xl text-xs leading-relaxed text-muted">
        {CONNECTOR_PRIVACY_LINE}
      </p>
    </footer>
  );
}
