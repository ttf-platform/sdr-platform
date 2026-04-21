/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#F5F4F0',
        foreground: '#1C1A17',
        primary: '#2C4A3E',
        accent: '#7AAF8E',
        muted: 'rgba(28, 26, 23, 0.45)',
        border: 'rgba(28, 26, 23, 0.09)',
        card: '#FFFFFF',
      },
      fontFamily: {
        sans: ['DM Sans', 'sans-serif'],
      },
    },
  },
  plugins: [],
}