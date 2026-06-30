import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        base: "#07070D",
        surface: {
          DEFAULT: "#0F0F1A",
          elevated: "#16162A",
        },
        line: {
          DEFAULT: "#1F1F33",
          accent: "#2A2A47",
        },
        ink: {
          DEFAULT: "#F4F4F8",
          muted: "#A8A8B8",
          subtle: "#6B6B7D",
        },
        brand: {
          purple: "#A855F7",
          "purple-deep": "#7C3AED",
          cyan: "#22D3EE",
          "cyan-deep": "#06B6D4",
        },
        signal: {
          success: "#10B981",
          warning: "#F59E0B",
          danger: "#EF4444",
        },
        // Fantasy position palette: one distinct hue per positional group, used to
        // color-code drafted picks (board + list) and position tags (rosters). Chosen
        // to read clearly on the near-black base and to stay clear of the reserved
        // brand colors (purple = "your pick", cyan = "on the clock") so position hue
        // never reads as a state signal. Canonical source: lib/on-the-clock/position-colors.ts.
        position: {
          qb: "#F87171",
          rb: "#34D399",
          wr: "#60A5FA",
          te: "#FBBF24",
          k: "#F472B6",
          def: "#94A3B8",
        },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "-apple-system", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        DEFAULT: "8px",
        card: "12px",
        modal: "16px",
      },
      backgroundImage: {
        beacon: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
      },
      transitionDuration: {
        DEFAULT: "180ms",
      },
      transitionTimingFunction: {
        DEFAULT: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
