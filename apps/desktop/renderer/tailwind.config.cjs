/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#f5f6f8",
        surface: "#ffffff",
        ink: "#202938",
        muted: "#717b8c",
        line: "#e5e8ed",
        accent: {
          50: "#f4f6ef",
          100: "#e8ecdf",
          200: "#d5ddc2",
          500: "#728154",
          600: "#606e46",
          700: "#4e593a"
        }
      },
      boxShadow: {
        panel: "0 1px 2px rgba(24, 33, 48, 0.03), 0 8px 28px rgba(24, 33, 48, 0.035)",
        dialog: "0 24px 80px rgba(24, 33, 48, 0.18)"
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ["SFMono-Regular", "Consolas", "Liberation Mono", "monospace"]
      }
    }
  },
  plugins: []
};
