import {
  trustLabelCopy,
  trustLabelHint,
  type TrustLabel,
} from "@nearby/shared";

export function TrustBadge({
  label,
  showHint = false,
}: {
  label: TrustLabel;
  showHint?: boolean;
}) {
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span
        className={
          label === "verified"
            ? "text-xs font-medium text-ink"
            : label === "unavailable"
              ? "text-xs font-medium text-muted"
              : "text-xs font-medium text-muted"
        }
      >
        {trustLabelCopy(label)}
      </span>
      {showHint ? (
        <span className="text-xs text-muted">{trustLabelHint(label)}</span>
      ) : null}
    </span>
  );
}
