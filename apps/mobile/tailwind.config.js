/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        'move-bg': '#F5F4F0',
        'move-card': '#FFFFFF',
        'move-dark': '#111111',
        'move-accent': '#C8F000',
        'move-accent-dim': '#9DB800',
        'move-text-secondary': '#6B6861',
        'move-text-muted': '#9A9890',
        'move-border': '#E8E6E0',
      },
      fontFamily: {
        barlow: ['BarlowCondensed_900Black'],
        dmsans: ['DMSans_400Regular'],
        'dmsans-medium': ['DMSans_500Medium'],
        'dmsans-bold': ['DMSans_700Bold'],
      },
    },
  },
  plugins: [],
}
