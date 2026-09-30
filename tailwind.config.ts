import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#f4f7fa",
        foreground: "#142538",
        border: "#dbe3eb",
        muted: "#607287",
        primary: "#176ba3",
        "primary-foreground": "#ffffff",
      },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
} satisfies Config;
