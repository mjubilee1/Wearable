/** Full-bleed place atmosphere for the marketing hero. Server-rendered SVG. */
export function PlaceHeroScene() {
  return (
    <svg
      className="landing-place-scene absolute inset-0 h-full w-full"
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0.2" y2="1">
          <stop offset="0%" stopColor="#c5d4df" />
          <stop offset="55%" stopColor="#e4ece8" />
          <stop offset="100%" stopColor="#d7e0d4" />
        </linearGradient>
        <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8fa392" />
          <stop offset="100%" stopColor="#5f7364" />
        </linearGradient>
        <linearGradient id="path" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#b7b1a4" />
          <stop offset="100%" stopColor="#9d9688" />
        </linearGradient>
      </defs>

      <rect width="1440" height="900" fill="url(#sky)" />

      {/* Distant block silhouette */}
      <g className="landing-place-far" fill="#6d7f8c" opacity="0.35">
        <rect x="40" y="290" width="120" height="220" />
        <rect x="180" y="240" width="90" height="270" />
        <rect x="290" y="310" width="150" height="200" />
        <rect x="1180" y="260" width="100" height="250" />
        <rect x="1300" y="300" width="140" height="210" />
      </g>

      {/* Mid trees */}
      <g className="landing-place-trees" fill="#3f5a48">
        <ellipse cx="220" cy="470" rx="70" ry="95" />
        <ellipse cx="310" cy="490" rx="55" ry="75" />
        <ellipse cx="1080" cy="460" rx="80" ry="110" />
        <ellipse cx="1185" cy="500" rx="60" ry="80" />
        <rect x="210" y="545" width="14" height="70" fill="#2c3d32" />
        <rect x="300" y="545" width="12" height="55" fill="#2c3d32" />
        <rect x="1070" y="545" width="16" height="75" fill="#2c3d32" />
        <rect x="1175" y="555" width="12" height="55" fill="#2c3d32" />
      </g>

      {/* Ground and path */}
      <path
        d="M0 560 C360 520 720 600 1440 540 L1440 900 L0 900 Z"
        fill="url(#ground)"
      />
      <path
        d="M520 900 C610 720 700 640 760 560 C820 640 900 740 980 900 Z"
        fill="url(#path)"
        opacity="0.9"
      />

      {/* Near foliage framing */}
      <g className="landing-place-near" fill="#24362c" opacity="0.85">
        <ellipse cx="-20" cy="720" rx="180" ry="220" />
        <ellipse cx="1460" cy="700" rx="200" ry="240" />
        <ellipse cx="90" cy="820" rx="120" ry="140" />
        <ellipse cx="1350" cy="840" rx="140" ry="150" />
      </g>
    </svg>
  );
}
