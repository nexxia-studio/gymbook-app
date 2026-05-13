/**
 * Generate PWA placeholder icons as SVG → inlined into HTML for generation.
 * Since we can't use canvas/sharp without native deps, generate SVGs
 * that can be used directly, and create simple PNG placeholders via Expo assets.
 */
const fs = require('fs')
const path = require('path')

function generateSvgIcon(size) {
  const fontSize = Math.round(size * 0.5)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#111111" rx="${Math.round(size * 0.2)}"/>
  <text x="50%" y="52%" text-anchor="middle" dominant-baseline="central"
    fill="#FFFFFF" font-family="Arial Black, sans-serif" font-weight="900" font-size="${fontSize}">D</text>
</svg>`
}

const iconsDir = path.join(__dirname, '..', 'public', 'icons')
const splashDir = path.join(__dirname, '..', 'public', 'splash')

// Generate icon SVGs (browsers accept SVG as icon src)
fs.writeFileSync(path.join(iconsDir, 'icon-192.svg'), generateSvgIcon(192))
fs.writeFileSync(path.join(iconsDir, 'icon-512.svg'), generateSvgIcon(512))
fs.writeFileSync(path.join(iconsDir, 'apple-touch-icon.svg'), generateSvgIcon(180))

// Generate a splash SVG
const splashSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1170" height="2532" viewBox="0 0 1170 2532">
  <rect width="1170" height="2532" fill="#111111"/>
  <text x="585" y="1150" text-anchor="middle" fill="#FFFFFF"
    font-family="Arial Black, sans-serif" font-weight="900" font-size="200">D</text>
  <text x="585" y="1350" text-anchor="middle" fill="#FFFFFF"
    font-family="Arial Black, sans-serif" font-weight="900" font-size="60">DOPAMINE</text>
  <text x="585" y="1420" text-anchor="middle" fill="#9A9890"
    font-family="Arial, sans-serif" font-size="28" letter-spacing="8">PERFORMANCE CLUB</text>
</svg>`
fs.writeFileSync(path.join(splashDir, 'splash.svg'), splashSvg)

console.log('Icons and splash generated as SVG in public/')
console.log('For production, convert to PNG using an image tool or CI pipeline.')
