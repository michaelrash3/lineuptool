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
      // Premium geometry — soft, modern radii (the old redesign used a harsh
      // 4px everywhere). Existing rounded-md/lg/xl/2xl/3xl utilities now resolve
      // to these app-wide without editing every call site. rounded-full is left
      // intact for genuine circles (avatars, spinners, pills).
      borderRadius: {
        DEFAULT: "10px",
        sm: "8px",
        md: "9px",
        lg: "12px",
        xl: "14px",
        "2xl": "18px",
        "3xl": "24px",
      },
    },
  },
  plugins: [],
};
