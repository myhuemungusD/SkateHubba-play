/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          orange: "#FF6B00",
          green: "#00E676",
          red: "#FF3D00",
        },
        surface: {
          DEFAULT: "#141414",
          alt: "#1A1A1A",
        },
        border: {
          DEFAULT: "#2A2A2A",
          hover: "#3A3A3A",
        },
      },
      fontFamily: {
        display: ['"Bebas Neue"', "sans-serif"],
        body: ['"DM Sans"', "sans-serif"],
      },
    },
  },
  plugins: [],
};
