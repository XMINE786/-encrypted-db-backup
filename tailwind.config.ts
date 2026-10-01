import type { Config } from "tailwindcss";

// Channel-based token: reads a "R G B" CSS variable so Tailwind's /opacity
// modifier keeps working, and the value can be swapped per theme (see globals.css).
const v = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // `white` flips to near-black in light mode, so headings + hairline
        // borders/surfaces (white/5, white/10…) adapt automatically.
        white: v("white"),
        base: {
          950: v("base-950"),
          900: v("base-900"),
          850: v("base-850"),
          800: v("base-800"),
          700: v("base-700"),
          600: v("base-600"),
        },
        brand: {
          50: v("brand-50"),
          100: v("brand-100"),
          200: v("brand-200"),
          300: v("brand-300"),
          400: v("brand-400"),
          500: v("brand-500"),
          600: v("brand-600"),
          700: v("brand-700"),
        },
        accent: {
          400: v("accent-400"),
          500: v("accent-500"),
        },
        // Merges with Tailwind's defaults — only the shades we theme are listed.
        slate: {
          100: v("slate-100"),
          200: v("slate-200"),
          300: v("slate-300"),
          400: v("slate-400"),
          500: v("slate-500"),
          600: v("slate-600"),
        },
        red: {
          300: v("red-300"),
          400: v("red-400"),
          500: v("red-500"),
        },
        emerald: {
          300: v("emerald-300"),
          400: v("emerald-400"),
          500: v("emerald-500"),
        },
        amber: {
          200: v("amber-200"),
          300: v("amber-300"),
          400: v("amber-400"),
          500: v("amber-500"),
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(59,109,255,0.15), 0 20px 60px -20px rgba(59,109,255,0.35)",
        card: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 20px 40px -24px rgba(0,0,0,0.7)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulsebar: {
          "0%,100%": { opacity: "0.4" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.3s ease-out both",
        pulsebar: "pulsebar 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
