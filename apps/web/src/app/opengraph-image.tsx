import { ImageResponse } from "next/og";

export const alt = "Nearby — Voice assistant that answers out loud";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0F172A",
          padding: "72px",
          color: "#ffffff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <svg width="72" height="72" viewBox="0 0 64 64">
            <rect width="64" height="64" rx="14" fill="#1E293B" />
            <path
              d="M16 46V26a8 8 0 0 1 16 0v20"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="6"
              strokeLinecap="round"
            />
            <path
              d="M43 28.3a7 7 0 0 1 0 11.4"
              fill="none"
              stroke="#2DD4BF"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <path
              d="M47.4 24a13 13 0 0 1 0 20"
              fill="none"
              stroke="#2DD4BF"
              strokeWidth="4"
              strokeLinecap="round"
              opacity="0.6"
            />
          </svg>
          <div style={{ fontSize: 36, fontWeight: 700, color: "#2DD4BF" }}>
            nearby
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 980 }}>
          <div
            style={{
              fontSize: 68,
              fontWeight: 700,
              letterSpacing: -2,
              lineHeight: 1.05,
            }}
          >
            Speak, and it answers out loud.
          </div>
          <div
            style={{
              marginTop: 28,
              fontSize: 30,
              lineHeight: 1.35,
              color: "#CBD5E1",
            }}
          >
            A voice assistant for calendar, notes, and reminders.
          </div>
        </div>
        <div style={{ fontSize: 26, color: "#2DD4BF" }}>nearbyhello.com</div>
      </div>
    ),
    { ...size },
  );
}
