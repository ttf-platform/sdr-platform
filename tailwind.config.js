/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  safelist: [
    // Tag color palette — classes built dynamically, must be safelisted
    'bg-gray-100',   'text-gray-700',   'border-gray-200',   'bg-gray-400',
    'bg-blue-50',    'text-blue-700',   'border-blue-200',   'bg-blue-500',
    'bg-green-50',   'text-green-700',  'border-green-200',  'bg-green-500',
    'bg-purple-50',  'text-purple-700', 'border-purple-200', 'bg-purple-500',
    'bg-orange-50',  'text-orange-700', 'border-orange-200', 'bg-orange-500',
    'bg-red-50',     'text-red-700',    'border-red-200',    'bg-red-500',
    'bg-yellow-50',  'text-yellow-700', 'border-yellow-200', 'bg-yellow-500',
    'bg-pink-50',    'text-pink-700',   'border-pink-200',   'bg-pink-500',
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
  plugins: [require('@tailwindcss/typography')],
}