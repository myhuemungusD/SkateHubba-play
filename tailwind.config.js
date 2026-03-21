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
          glass: "rgba(20,20,20,0.6)",
        },
        border: {
          DEFAULT: "#2A2A2A",
          hover: "#3A3A3A",
          glow: "rgba(255,107,0,0.25)",
        },
        // Semantic text grays — replaces hardcoded hex values across components
        dim: "#999",      // secondary labels, sign-out text
        muted: "#888",    // body copy, descriptions, ghost-button text
        faint: "#666",    // tertiary labels, placeholders
        subtle: "#555",   // icons, disabled text, VS dividers
      },
      fontFamily: {
        display: ['"Bebas Neue"', "sans-serif"],
        body: ['"DM Sans"', "sans-serif"],
      },
      fontSize: {
        // Fluid type scale using clamp for responsive typography
        "fluid-xs": "clamp(0.7rem, 0.65rem + 0.25vw, 0.8rem)",
        "fluid-sm": "clamp(0.8rem, 0.75rem + 0.3vw, 0.95rem)",
        "fluid-base": "clamp(0.9rem, 0.85rem + 0.35vw, 1.1rem)",
        "fluid-lg": "clamp(1.1rem, 1rem + 0.5vw, 1.35rem)",
        "fluid-xl": "clamp(1.25rem, 1.1rem + 0.75vw, 1.75rem)",
        "fluid-2xl": "clamp(1.5rem, 1.2rem + 1.5vw, 2.5rem)",
        "fluid-3xl": "clamp(1.875rem, 1.5rem + 2vw, 3.25rem)",
        "fluid-4xl": "clamp(2.25rem, 1.75rem + 2.5vw, 4rem)",
        "fluid-hero": "clamp(2.75rem, 2rem + 3.5vw, 5rem)",
      },
      boxShadow: {
        "glow-sm": "0 0 15px rgba(255,107,0,0.15)",
        "glow-md": "0 0 30px rgba(255,107,0,0.12)",
        "glow-lg": "0 0 60px rgba(255,107,0,0.08)",
        "glow-green": "0 0 30px rgba(0,230,118,0.12)",
        "glow-red": "0 0 30px rgba(255,61,0,0.12)",
        "card": "0 1px 3px rgba(0,0,0,0.3), 0 8px 24px rgba(0,0,0,0.15)",
        "card-hover": "0 2px 8px rgba(0,0,0,0.4), 0 12px 40px rgba(0,0,0,0.2)",
        "glass": "0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05)",
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-mesh": "radial-gradient(at 40% 20%, rgba(255,107,0,0.06) 0px, transparent 50%), radial-gradient(at 80% 0%, rgba(255,61,0,0.04) 0px, transparent 50%), radial-gradient(at 0% 50%, rgba(0,230,118,0.03) 0px, transparent 50%)",
        "noise": "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E\")",
      },
      borderRadius: {
        "2xl": "1rem",
        "3xl": "1.5rem",
        "4xl": "2rem",
      },
      transitionTimingFunction: {
        "spring": "cubic-bezier(0.34, 1.56, 0.64, 1)",
        "smooth": "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};
