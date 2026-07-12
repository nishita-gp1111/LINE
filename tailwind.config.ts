import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#17202a",
        paper: "#f4f1eb",
        line: "#d8d2c8",
        moss: "#2e6b5b",
        coral: "#a84f48"
      }
    }
  },
  plugins: []
};

export default config;
