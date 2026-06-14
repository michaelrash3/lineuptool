/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}", "./public/index.html"],
  // Dark mode is driven by <html data-theme="dark"> (set before paint by the
  // inline script in public/index.html and managed by src/hooks/useTheme).
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        team: {
          primary: "var(--team-primary)",
          secondary: "var(--team-secondary)",
          tertiary: "var(--team-tertiary)",
        },
        // Semantic surface tokens — flip automatically in dark mode.
        app: "var(--app-bg)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        ink: "var(--ink)",
        "ink-2": "var(--ink-2)",
        "ink-3": "var(--ink-3)",
        line: "var(--line)",
        "line-strong": "var(--line-strong)",
        win: "var(--win)",
        "win-bg": "var(--win-bg)",
        loss: "var(--loss)",
        "loss-bg": "var(--loss-bg)",
        warnfg: "var(--warn-fg)",
        "warn-bg": "var(--warn-bg)",
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "Apple Color Emoji",
          "Segoe UI Emoji",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SF Mono",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      boxShadow: {
        card: "var(--shadow-card)",
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-xl)",
        "2xl": "var(--shadow-2xl)",
        glow: "var(--glow-primary)",
        "glow-strong": "var(--glow-primary-strong)",
        inset: "inset 0 2px 4px rgb(0 0 0 / 0.05)",
      },
      // Sharp, architectural geometry — crisp edges read as precise/expensive;
      // rounded "bubble" corners felt cheap/generic. Existing rounded-*
      // utilities resolve to these app-wide. rounded-full is left intact for
      // genuine circles (avatars, spinners).
      borderRadius: {
        DEFAULT: "3px",
        sm: "2px",
        md: "3px",
        lg: "4px",
        xl: "5px",
        "2xl": "6px",
        "3xl": "8px",
      },
    },
  },
  plugins: [],
};
