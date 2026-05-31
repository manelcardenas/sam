import type { Metadata } from "next";
import { Arimo } from "next/font/google";
import "./globals.css";

// Arimo — metrically compatible with Helvetica/Arial, so the whole app reads
// as Helvetica. Used across headings + body; weight provides the contrast.
const arimo = Arimo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SAM — Cook & Dine",
  description:
    "SAM the border collie fetches your food world: cook at home or find somewhere to eat out.",
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
      className={`${arimo.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="antialiased min-h-screen bg-bg text-fg">{children}</body>
    </html>
  );
}
