import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} — Understand the space around you`,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/nearby",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0d9488",
    lang: "en",
    icons: [
      {
        src: "/favicon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
