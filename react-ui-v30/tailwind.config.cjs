/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { jakarta: ['Plus Jakarta Sans', 'Arial', 'sans-serif'] },
      colors: { vision: { indigo: '#4f46e5', purple: '#9333ea' } }
    }
  },
  plugins: []
};
