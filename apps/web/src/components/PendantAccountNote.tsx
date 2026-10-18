import { pendantDisplayName } from "@nearby/shared";

/** `nearby://` opens the installed iPhone app. Swap for a store URL later. */
const APP_LINK = process.env.NEXT_PUBLIC_APP_LINK?.trim() || "";

export function PendantAccountNote({
  pendantId,
  className = "text-sm text-muted",
}: {
  pendantId?: string | null;
  className?: string;
}) {
  if (pendantId) {
    return (
      <p className={className}>
        {pendantDisplayName(pendantId)} is saved on this account. The phone app
        connects to it.
      </p>
    );
  }

  return (
    <p className={className}>
      No pendant yet. Open the Nearby app on your iPhone and tap Add pendant.
      {APP_LINK ? (
        <>
          {" "}
          <a href={APP_LINK} className="font-semibold text-teal">
            Open the app
          </a>
        </>
      ) : null}
    </p>
  );
}
