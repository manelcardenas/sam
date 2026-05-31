import type { Config } from "tailwindcss";

export default {
  // Manual theme switching (.dark on <html>), seeded from system pref + localStorage.
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── Theme-aware semantic tokens (CSS vars flip in .dark) ──
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        "surface-2": "rgb(var(--surface-2) / <alpha-value>)",
        fg: "rgb(var(--fg) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        // ── Fixed "Fetch!" brand duotone ──
        tomato: { DEFAULT: "#E4572E", 600: "#D24A24", 700: "#C8431F" },
        amber: { DEFAULT: "#F4A024", 600: "#E08E12", 700: "#C97A08" },
        ink: "#1A1A1A",
        cream: "#FBF7EF",
      },
      fontFamily: {
        display: ['var(--font-sans)', '"Helvetica Neue"', "Helvetica", "Arial", "sans-serif"],
        sans: ['var(--font-sans)', '"Helvetica Neue"', "Helvetica", "Arial", "sans-serif"],
      },
      borderRadius: {
        "4xl": "2rem",
      },
      boxShadow: {
        // Soft "stacked" shadow that gives cards a friendly, lifted feel.
        paw: "0 10px 30px -14px rgba(26,26,26,0.30)",
        pop: "0 2px 0 0 rgba(26,26,26,0.12)",
      },
      keyframes: {
        fetchIn: {
          "0%": { opacity: "0", transform: "translateY(14px) scale(.98)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        float: {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
        wag: {
          "0%,100%": { transform: "rotate(-9deg)" },
          "50%": { transform: "rotate(9deg)" },
        },
        pop: {
          "0%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.1)" },
          "100%": { transform: "scale(1)" },
        },
        bounceDot: {
          "0%,80%,100%": { transform: "translateY(0)", opacity: ".45" },
          "40%": { transform: "translateY(-9px)", opacity: "1" },
        },
      },
      animation: {
        // High-impact entrances; `both` keeps the start state before delay fires.
        "fetch-in": "fetchIn .5s cubic-bezier(.22,.9,.27,1) both",
        float: "float 4s ease-in-out infinite",
        wag: "wag .55s ease-in-out infinite",
        pop: "pop .3s ease-out",
        "bounce-dot": "bounceDot 1.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
