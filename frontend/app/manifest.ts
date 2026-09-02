import type { MetadataRoute } from "next";

// Required under `output: 'export'` — without it Next treats this metadata route
// as dynamic and the build fails rather than emitting a static file.
export const dynamic = "force-static";

/**
 * Web app manifest, emitted as a static manifest.webmanifest at build time
 * (works under `output: 'export'`).
 *
 * This drives the *Android* install: name, icons, chrome-less launch and the
 * splash colours. iOS reads almost none of it — notably it ignores
 * `display: "standalone"` entirely, taking chrome-less launch from the
 * `apple-mobile-web-app-capable` meta tag instead, which is set via
 * `metadata.appleWebApp` in app/layout.tsx. Both halves are needed.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SAM — Cook & Dine",
    short_name: "SAM",
    description:
      "SAM the border collie fetches your food world: cook at home or find somewhere to eat out.",
    start_url: "/dashboard",
    display: "standalone",
    orientation: "portrait",
    background_color: "#FBF7EF", // cream — matches the plate in icon.svg, so the splash doesn't flash white
    theme_color: "#E4572E", // tomato
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Separate maskable entry: Android crops adaptive icons to a circle, and the
      // "any" icons would lose SAM's ears to it.
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
