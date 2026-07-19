/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/views/**/*.ejs',
    './app/public/js/**/*.js'
  ],
  theme: {
    extend: {
      colors: {
        wes: {
          50: '#f0f0ff', 100: '#e0e0ff', 200: '#c0c0ff', 300: '#a0a0ff',
          400: '#8080ff', 500: '#6C63FF', 600: '#5a52d5', 700: '#4841ab',
          800: '#363181', 900: '#242057', 950: '#12102b'
        }
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif']
      }
    }
  },
  plugins: []
};
