/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        bg: '#0a0a0a',
        bg2: '#141414',
        bg3: '#1c1c1c',
        accent: '#7C6AF7',
      },
    },
  },
  plugins: [],
};
