// nativewind が require するため tailwind.config.js を置く。
// 実体は geek-v4 側を参照する — content scan も geek-v4 をターゲット。
const path = require('path');
const geekV4 = path.resolve(__dirname, '../geek-v4');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    path.join(geekV4, 'app/**/*.{ts,tsx}'),
    path.join(geekV4, 'components/**/*.{ts,tsx}'),
    './app/**/*.{ts,tsx}',
  ],
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
