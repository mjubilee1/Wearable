import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const deployedAt = new Date();

  return [
    {
      url: SITE_URL,
      lastModified: deployedAt,
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
