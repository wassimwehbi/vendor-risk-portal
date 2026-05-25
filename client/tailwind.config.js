/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Single muted "steel" accent used sparingly for primary actions/links.
        brand: {
          50: '#f4f6f9',
          100: '#e6eaf0',
          200: '#ccd4e0',
          500: '#5d6a82',
          600: '#44546a',
          700: '#374459',
          900: '#1f2733',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 23, 42, 0.04)',
      },
    },
  },
  plugins: [],
};
