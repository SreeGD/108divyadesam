import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// Site URL is used for sitemap + canonical/hreflang tags. Override at deploy time.
export default defineConfig({
  site: process.env.SITE_URL ?? "https://108divyadesam.example.org",
  trailingSlash: "ignore",
  build: { format: "directory" },
  integrations: [sitemap()],
});
