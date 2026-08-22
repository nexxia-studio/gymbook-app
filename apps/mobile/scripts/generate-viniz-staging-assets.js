/**
 * GYM-258 — génère les images de la variante « Viniz Staging » (icône, adaptive icon,
 * splash) à partir des assets Viniz récupérés du dépôt viniz-site.
 *
 * ⚠️ AUCUNE DÉPENDANCE AJOUTÉE. sharp n'est pas installé dans ce projet (le commentaire en
 * tête de generate-icons.js le disait déjà) et l'ajouter pour trois images serait payer un
 * binaire natif à chaque install et à chaque build EAS. Tout passe donc par `zlib`, qui est
 * dans Node : décodage PNG (inflate + défiltrage), composition, ré-encodage (deflate).
 *
 * ⚠️ NE TOUCHE À AUCUN ASSET DOPAMINE. Lit et écrit exclusivement sous assets/viniz/.
 *
 * Usage : node scripts/generate-viniz-staging-assets.js
 */
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const DIR = path.join(__dirname, '..', 'assets', 'viniz')
const VIOLET = [0x48, 0x27, 0xb4] // #4827B4 — violet de marque Viniz
const LIME = [0xc8, 0xff, 0x3d]   // #C8FF3D — lime de marque

// ── PNG ─────────────────────────────────────────────────────────────────────────
function readPng(file) {
  const d = fs.readFileSync(file)
  let i = 8, idat = [], w, h, bitDepth, colorType
  while (i < d.length) {
    const len = d.readUInt32BE(i)
    const type = d.toString('ascii', i + 4, i + 8)
    const data = d.subarray(i + 8, i + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4)
      bitDepth = data[8]; colorType = data[9]
      if (data[12] !== 0) throw new Error('PNG entrelacé non géré')
      if (bitDepth !== 8) throw new Error('profondeur ' + bitDepth + ' non gérée')
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    i += 12 + len
  }
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const nch = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]
  if (!nch) throw new Error('colorType ' + colorType + ' non géré (palette ?)')
  const stride = w * nch
  const out = Buffer.alloc(h * stride)
  let prev = Buffer.alloc(stride), p = 0
  for (let y = 0; y < h; y++) {
    const f = raw[p++]
    const line = Buffer.from(raw.subarray(p, p + stride)); p += stride
    for (let x = 0; x < stride; x++) {
      const a = x >= nch ? line[x - nch] : 0
      const b = prev[x]
      const c = x >= nch ? prev[x - nch] : 0
      let add = 0
      if (f === 1) add = a
      else if (f === 2) add = b
      else if (f === 3) add = (a + b) >> 1
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c)
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      line[x] = (line[x] + add) & 255
    }
    line.copy(out, y * stride); prev = line
  }
  // normalisation en RGBA
  const px = Buffer.alloc(w * h * 4)
  for (let j = 0; j < w * h; j++) {
    if (colorType === 6) out.copy(px, j * 4, j * 4, j * 4 + 4)
    else if (colorType === 2) { out.copy(px, j * 4, j * 3, j * 3 + 3); px[j * 4 + 3] = 255 }
    else if (colorType === 0) { px.fill(out[j], j * 4, j * 4 + 3); px[j * 4 + 3] = 255 }
    else { px.fill(out[j * 2], j * 4, j * 4 + 3); px[j * 4 + 3] = out[j * 2 + 1] }
  }
  return { w, h, px }
}

function writePng(file, w, h, px) {
  const raw = Buffer.alloc(h * (1 + w * 3))
  let o = 0
  for (let y = 0; y < h; y++) {
    raw[o++] = 0 // aucun filtre : ces images sont de grands aplats, deflate fait le travail
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4
      raw[o++] = px[s]; raw[o++] = px[s + 1]; raw[o++] = px[s + 2]
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(td) >>> 0 : crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 2 // 8 bits, RGB opaque — pas d'alpha : iOS remplit en noir sinon
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]))
}

// CRC32 de secours pour les Node sans zlib.crc32.
let CRC_TABLE = null
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      CRC_TABLE[n] = c
    }
  }
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

// ── composition ─────────────────────────────────────────────────────────────────
function solid(w, h, rgb) {
  const px = Buffer.alloc(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    px[i * 4] = rgb[0]; px[i * 4 + 1] = rgb[1]; px[i * 4 + 2] = rgb[2]; px[i * 4 + 3] = 255
  }
  return px
}

/** Dessine `src` mis à l'échelle (plus proche voisin, sources déjà nettes) dans `dst`. */
function drawScaled(dst, dw, src, sw, sh, dx, dy, tw, th) {
  for (let y = 0; y < th; y++) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / th))
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(sw - 1, Math.floor((x * sw) / tw))
      const s = (sy * sw + sx) * 4
      const a = src[s + 3] / 255
      if (a === 0) continue
      const d = ((dy + y) * dw + (dx + x)) * 4
      for (let c = 0; c < 3; c++) dst[d + c] = Math.round(src[s + c] * a + dst[d + c] * (1 - a))
    }
  }
}

// Fonte bitmap 5×7, uniquement les lettres de « STAGING ». Une police embarquée de six
// glyphes coûte moins qu'une dépendance de rendu de texte, et le rendu est déterministe.
const GLYPHS = {
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01110'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
}

function drawText(dst, dw, text, x0, y0, scale, rgb, spacing) {
  let x = x0
  for (const ch of text) {
    const g = GLYPHS[ch]
    if (!g) { x += (5 + spacing) * scale; continue }
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 5; c++) {
        if (g[r][c] !== '1') continue
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const d = ((y0 + r * scale + sy) * dw + (x + c * scale + sx)) * 4
            dst[d] = rgb[0]; dst[d + 1] = rgb[1]; dst[d + 2] = rgb[2]; dst[d + 3] = 255
          }
        }
      }
    }
    x += (5 + spacing) * scale
  }
  return x - spacing * scale
}

function textWidth(text, scale, spacing) {
  return text.length * (5 + spacing) * scale - spacing * scale
}

/**
 * Icône 1024×1024 : fond violet plein (l'icône source est déjà opaque, mais un fond
 * explicite garantit qu'aucune transparence ne subsiste — iOS la remplirait en noir),
 * marque Viniz centrée, bandeau « STAGING » en bas.
 *
 * Le bandeau est DISCRET mais lisible : on ne doit jamais confondre les deux apps sur un
 * écran d'accueil, et c'est précisément le rôle de ce lot.
 */
function buildIcon(srcIcon, size, { safeRatio = 1 } = {}) {
  const px = solid(size, size, VIOLET)
  const band = Math.round(size * 0.19)
  // La marque occupe la zone au-dessus du bandeau. `safeRatio` rétrécit l'ensemble pour
  // l'adaptive icon Android, dont le lanceur ne garantit que le cercle central à 66 %.
  const artBox = Math.round((size - band) * 0.82 * safeRatio)
  const ax = Math.round((size - artBox) / 2)
  const ay = Math.round((size - band - artBox) / 2)
  drawScaled(px, size, srcIcon.px, srcIcon.w, srcIcon.h, ax, ay, artBox, artBox)

  // Bandeau : lime sur violet, le couple de la marque, contraste très élevé.
  const bandTop = size - band
  for (let y = bandTop; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = (y * size + x) * 4
      px[d] = LIME[0]; px[d + 1] = LIME[1]; px[d + 2] = LIME[2]; px[d + 3] = 255
    }
  }
  const label = 'STAGING'
  const scale = Math.max(1, Math.round(size / 145))
  const spacing = 2
  const tw = textWidth(label, scale, spacing)
  drawText(px, size, label, Math.round((size - tw) / 2), bandTop + Math.round((band - 7 * scale) / 2), scale, VIOLET, spacing)
  return px
}

/** Splash : fond violet, logo Viniz centré sur ~45 % de la largeur. */
function buildSplash(srcLogo, w, h) {
  const px = solid(w, h, VIOLET)
  const box = Math.round(Math.min(w, h) * 0.45)
  drawScaled(px, w, srcLogo.px, srcLogo.w, srcLogo.h,
    Math.round((w - box) / 2), Math.round((h - box) / 2), box, box)
  return px
}

// ── exécution ───────────────────────────────────────────────────────────────────
const icon = readPng(path.join(DIR, 'icon-512.png'))
const logo = readPng(path.join(DIR, 'viniz-logo.png'))

const targets = [
  ['icon-staging.png', 1024, buildIcon(icon, 1024)],
  ['adaptive-icon-staging.png', 1024, buildIcon(icon, 1024, { safeRatio: 0.72 })],
]
for (const [name, size, px] of targets) {
  writePng(path.join(DIR, name), size, size, px)
  console.log('  écrit', name, size + 'x' + size)
}
writePng(path.join(DIR, 'splash-staging.png'), 1284, 2778, buildSplash(logo, 1284, 2778))
console.log('  écrit splash-staging.png 1284x2778')
