/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: '#0B0F17',
        surface: {
          DEFAULT: '#141A23',
          card: 'rgba(25, 33, 44, 0.6)',
          elevated: 'rgba(32, 42, 56, 0.75)',
          border: 'rgba(255, 255, 255, 0.08)',
        },
        brand: {
          samsung: '#1428A0',
          motorola: '#00142E',
          accent: '#3B82F6',
          dex: '#2B5BF7',
          readyfor: '#00A3E0',
        },
      },
      backdropBlur: {
        xs: '2px',
        glass: '16px',
        heavy: '24px',
      },
      boxShadow: {
        glass: '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
        glow: '0 0 20px -3px rgba(59, 130, 246, 0.4)',
        'glow-accent': '0 0 25px -2px rgba(43, 91, 247, 0.5)',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Display"',
          '"SF Pro Text"',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
}
