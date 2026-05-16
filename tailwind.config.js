/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}", "./public/index.html"],
  theme: {
    extend: {
      colors: {
        team: {
          primary: "var(--team-primary)",
          secondary: "var(--team-secondary)",
          tertiary: "var(--team-tertiary)",
        },
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
        card: "0 4px 20px rgb(0 0 0 / 0.04)",
        inset: "inset 0 2px 4px rgb(0 0 0 / 0.05)",
      },
      borderRadius: {
        xl: "12px",
        "2xl": "16px",
        "3xl": "24px",
      },
    },
  },
  plugins: [],
};
