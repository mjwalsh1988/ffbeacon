import type { Config } from "tailwindcss";
import type { RecursiveKeyValuePair } from "tailwindcss/types/config";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    /**
     * `text-base` means one size of type and nothing else.
     *
     * The palette below names a colour `base` (the page background), and
     * Tailwind turns every colour into a `text-*` utility. That produced two
     * different rules called `.text-base`, and the colour one won inside a
     * breakpoint, so anything written `text-sm sm:text-base` went from readable
     * grey to #07070D against a #07070D page at the sm breakpoint: invisible
     * text, and only above one screen width, which is exactly the kind of bug
     * that survives review.
     *
     * Redefining `textColor` (outside `extend`, so it replaces rather than
     * merges) drops that one entry. Every other colour is still available as
     * `text-*`, and `bg-base` and `border-base` are untouched, because only the
     * text scale has a `base` of its own to collide with.
     */
    textColor: ({ theme }) => {
      const { base: _base, ...colors } = theme("colors") as Record<
        string,
        RecursiveKeyValuePair<string, string> | string
      >;
      return colors;
    },
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
          // Raised from #6B6B7D, which measured about 3.8:1 against the page
          // and failed AA everywhere it carried real text: the stat-tile labels
          // in the masthead, the one-line hints in the navigation drawer, and
          // the labels above the source and format controls. None of those are
          // large enough to qualify for the 3:1 allowance. #8A8A9C is about
          // 5.4:1 and still reads as the quietest tier of the three.
          subtle: "#8A8A9C",
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
