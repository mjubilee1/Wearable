import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0F172A",
        }}
      >
        <svg width="180" height="180" viewBox="0 0 64 64">
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
      </div>
    ),
    { ...size },
  );
}
