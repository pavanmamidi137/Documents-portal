import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

/**
 * PWA setup (https://github.com/DuCanhGH/next-pwa).
 *
 * - Generates a manifest + service worker into `public/` at build time.
 * - `disable` keeps development mode untouched (no SW, no install prompts).
 * - The service worker ONLY caches static build assets and page shells. The
 *   Django API is cross-origin and never matched, so authenticated responses,
 *   JWT tokens (stored in localStorage, never in the SW) and user data are
 *   never cached - the app always talks to the live API.
 * - Requires HTTPS in production (browsers only install PWAs over HTTPS or
 *   localhost), which the Render deployment provides.
 */
const withPWA = withPWAInit({
  dest: "public",
  register: true,
  // Dev mode must behave exactly as before - no service worker, no caching.
  disable: process.env.NODE_ENV === "development",
  reloadOnOnline: false,
  // The web app manifest lives at public/manifest.webmanifest (v10+ of
  // next-pwa no longer generates it) and is linked via the root layout's
  // metadata - see src/app/layout.tsx.
  workboxOptions: {
    // Activate the new service worker as soon as it's installed so updates
    // apply immediately instead of waiting for the next load.
    skipWaiting: true,
    // Explicit allowlist: only static assets and page shells are ever stored.
    // Anything else (API calls, auth, external CDNs) goes straight to network.
    runtimeCaching: [
      {
        urlPattern: /\/_next\/static\/.*/i,
        handler: "StaleWhileRevalidate",
        options: { cacheName: "static-resources" },
      },
      {
        urlPattern: /\/_next\/image.*/i,
        handler: "CacheFirst",
        options: { cacheName: "next-images" },
      },
      {
        urlPattern: ({ request }) => request.mode === "navigate",
        handler: "NetworkFirst",
        options: { cacheName: "pages", networkTimeoutSeconds: 5 },
      },
    ],
  },
});

const nextConfig: NextConfig = {
  /*
   * Cloudflare Pages deployment (static export).
   *
   * The app is 100% client-side (JWT + axios against the Django API - no
   * server components, no API routes, no middleware), so it needs no Node
   * server at runtime. Setting EXPORT_STATIC=1 (Cloudflare Pages build env)
   * makes `next build` emit plain HTML/JS/CSS into out/ which Pages serves
   * from the edge. The Render deployment keeps working unchanged during the
   * migration because export is opt-in, not the default.
   */
  output: process.env.EXPORT_STATIC === "1" ? "export" : undefined,
  // Static export has no image-optimizer server - disable it (nothing uses
  // next/image today, but this keeps an export build safe if one is added).
  images: { unoptimized: true },
};

export default withPWA(nextConfig);
