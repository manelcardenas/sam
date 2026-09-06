import type { Metadata, Viewport } from "next";

import { UserProvider } from "@/components/auth/UserProvider";
import { Arimo, Fraunces } from "next/font/google";
import "./globals.css";

// Arimo — metrically compatible with Helvetica/Arial, so the whole app reads
// as Helvetica. Used across headings + body; weight provides the contrast.
const arimo = Arimo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

// Fraunces — the scrapbook voice. A warm, slightly wonky old-style serif used
// only where SAM is telling you about a meal: review quotes, the big score
// numerals, and section eyebrows. Deliberately narrow in scope — the UI stays
// Arimo, so the serif reads as "handwriting in the journal" rather than a
// second UI font competing with the first.
// Loaded as a variable font: `axes` and an explicit `weight` list are mutually
// exclusive in next/font, and keeping the axes gives the full weight range plus
// SOFT (rounder terminals) and WONK (the swashier italic) — which is the warmth
// that makes it read as handwriting rather than a second UI font.
const fraunces = Fraunces({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["SOFT", "WONK"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SAM — Cook & Dine",
  description:
    "SAM the border collie fetches your food world: cook at home or find somewhere to eat out.",
  // iOS ignores the web manifest's `display: "standalone"`. Chrome-less launch
  // from the home screen comes from the apple-mobile-web-app-capable meta tag,
  // which Next emits from this block. Without it, app/manifest.ts fixes the
  // Android install and iOS still opens in a Safari tab with the address bar.
  appleWebApp: {
    capable: true,
    title: "SAM",
    statusBarStyle: "default", // keeps the cream page showing through the status bar
  },
  other: {
    // Next 15 emits only the modern `mobile-web-app-capable`. Safari has read
    // that since iOS 16.4, but older iOS still needs the apple-prefixed tag —
    // and "the icon is missing on my iPhone" is exactly the bug being fixed
    // here, so both ship.
    "apple-mobile-web-app-capable": "yes",
  },
  // NOTE: do not add an `icons` key. Declaring it replaces Next's file-convention
  // detection wholesale, which silently drops the <link rel="apple-touch-icon">
  // generated from app/apple-icon.png — i.e. it reintroduces this exact bug.
  // The icons come from app/icon.svg and app/apple-icon.png; the manifest
  // (app/manifest.ts) carries the Android raster sizes.
};

export const viewport: Viewport = {
  // Matches the manifest theme_color so the browser chrome tints to the brand.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FBF7EF" },
    { media: "(prefers-color-scheme: dark)", color: "#1C1914" },
  ],
  // Cover the notch: the shell already pads for env(safe-area-inset-bottom),
  // and standalone mode needs this to reach the screen edges.
  viewportFit: "cover",
};

// Set the theme class before first paint so there's no flash of the wrong mode.
const themeScript = `
(function(){try{
  var stored = localStorage.getItem('sam-theme');
  var dark = stored ? stored === 'dark'
    : window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (dark) document.documentElement.classList.add('dark');
}catch(e){}})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${arimo.variable} ${fraunces.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="antialiased min-h-screen bg-bg text-fg">
        {/* Holds the signed-in profile for the whole session, so pages stop
            re-fetching /users/me on every mount. */}
        <UserProvider>{children}</UserProvider>
      </body>
    </html>
  );
}
