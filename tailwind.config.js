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
        primary: '#2C4A3E',
        'primary-light': '#7AAF8E',
        'primary-dark': '#1A2E24',
        background: '#F5F4F0',
        'gray-50': '#FAFAF9',
        'gray-100': '#F5F5F4',
        'gray-200': '#E7E5E4',
        'gray-300': '#D6D3D1',
        'gray-400': '#A8A29E',
        'gray-500': '#78716C',
        'gray-600': '#57534E',
        'gray-700': '#44403C',
        'gray-800': '#292524',
        'gray-900': '#1C1917',
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
      },
    },
  },
  plugins: [],
}