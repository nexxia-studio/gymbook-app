#!/usr/bin/env node
// GYM-303 — 🔴 REND L'EMAIL VINIZ TEL QU'IL PARTIRA, POUR QU'ON LE RELISE AVANT DE DÉPLOYER.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// POURQUOI CE FICHIER EXISTE
// ═════════════════════════════════════════════════════════════════════════════════════
// `auth-email-hook` est BLOQUANT et ne sera déployé que par le cockpit : un gabarit cassé
// casse les inscriptions, et on ne s'en aperçoit qu'après. La seule façon de relire le
// rendu avant l'envoi est de le produire ici, avec le code du dépôt.
//
// ⚠️ IL N'IMITE RIEN. La coquille est `emailShell`, importée du module partagé et
// compilée depuis le dépôt ; l'identité Viniz (nom, couleurs, URL du mot-marque) et les
// couleurs du bouton sont LUES dans `auth-email-hook/index.ts`, pas recopiées. Si l'une
// des deux change, ce rendu change avec elle — un aperçu qui diverge de la source ne
// prouve rien, et rassure à tort.
//
// ⚠️ POURQUOI PAS UN IMPORT DIRECT DU HOOK : `index.ts` appelle `Deno.serve` et
// `Deno.env` au chargement. Il ne peut pas s'exécuter sous Node. On lit donc ses
// CONSTANTES dans le texte, et on rend avec le vrai gabarit.
//
// USAGE :  node scripts/rendu-email-viniz.mjs   → docs/ops/email-viniz-apercu.html
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const HOOK = join(ROOT, 'supabase/functions/auth-email-hook/index.ts')
const SORTIE = join(ROOT, 'docs/ops/email-viniz-apercu.html')

// ── 1. LES CONSTANTES DU HOOK, LUES DANS SA SOURCE ─────────────────────────────────
const src = readFileSync(HOOK, 'utf8')
const lire = (re, quoi) => {
  const m = src.match(re)
  if (!m) throw new Error(`introuvable dans auth-email-hook : ${quoi}`)
  return m[1]
}
const BRANDING = {
  name: lire(/const VINIZ_BRANDING: GymBranding = \{[\s\S]*?name: '([^']+)'/, 'name'),
  slug: '',
  address: null, postalCode: null, city: null, email: null, phone: null,
  logoUrl: lire(/const VINIZ_WORDMARK_PNG = '([^']+)'/, 'VINIZ_WORDMARK_PNG'),
  primaryColor: lire(/const VINIZ_BRANDING: GymBranding = \{[\s\S]*?primaryColor: '([^']+)'/, 'primaryColor'),
  secondaryColor: lire(/const VINIZ_BRANDING: GymBranding = \{[\s\S]*?secondaryColor: '([^']+)'/, 'secondaryColor'),
}
const CTA_BG = lire(/const VINIZ_CTA_BG = '([^']+)'/, 'VINIZ_CTA_BG')
const CTA_FG = lire(/const VINIZ_CTA_FG = '([^']+)'/, 'VINIZ_CTA_FG')
// Le `logoUrl` est câblé sur la constante : si quelqu'un le remet à `null`, on le dit.
const CABLE = /logoUrl: VINIZ_WORDMARK_PNG,/.test(src)

// ── 2. LA VRAIE COQUILLE ───────────────────────────────────────────────────────────
const out = mkdtempSync(join(tmpdir(), 'gym303-'))
try {
  execFileSync('npx', [
    'tsc', join(ROOT, 'supabase/functions/_shared/gym-branding.ts'),
    '--outDir', out, '--module', 'esnext', '--target', 'es2020', '--skipLibCheck',
    // ⚠️ `cwd` DANS apps/mobile, ET PAS À LA RACINE. À la racine, `npx tsc` tombe sur un
    // paquet homonyme (« This is not the tsc command you are looking for ») qui n'émet
    // rien et sort en succès : le script échouait ensuite sur un module introuvable, avec
    // un message qui ne désignait pas la cause.
  ], { cwd: join(ROOT, 'apps/mobile'), stdio: 'pipe' })
} catch { /* l'import de type depuis esm.sh ne résout pas hors Deno ; tsc émet quand même */ }
for (const f of readdirSync(out).filter((n) => n.endsWith('.js'))) {
  const p = join(out, f)
  // ⚠️ L'import `https://esm.sh/...` est un import de TYPE : tsc l'élide. S'il subsistait,
  // Node tenterait de le charger — on le retire explicitement plutôt que d'y compter.
  writeFileSync(p, readFileSync(p, 'utf8').replace(/^import .*https:\/\/esm\.sh.*$/gm, ''))
}
const { emailShell } = await import(pathToFileURL(join(out, 'gym-branding.js')).href)

// ── 3. LE MESSAGE — celui de `buildMessage`, branche `signup` / audience Viniz ──────
const p = (t) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3F3D39;">${t}</p>`
const html = emailShell(BRANDING, {
  title: 'Bienvenue sur Viniz',
  emoji: '👋',
  bodyHtml:
    p("Il ne reste qu'une étape : confirmer ton adresse email pour activer ton compte.")
    + p('Tu pourras ensuite créer ta salle, définir tes créneaux et ouvrir les réservations à tes membres.'),
  ctaLabel: 'Confirmer mon adresse',
  ctaUrl: 'https://exemple.invalid/confirmation-de-demonstration',
  ctaBg: CTA_BG,
  ctaFg: CTA_FG,
})

const bandeau = `<!--
  APERÇU GÉNÉRÉ — ne pas modifier à la main.
  Produit par apps/mobile/scripts/rendu-email-viniz.mjs à partir du code du dépôt.
  Mot-marque : ${BRANDING.logoUrl}
  Câblé sur VINIZ_WORDMARK_PNG dans le hook : ${CABLE ? 'oui' : 'NON — le logo ne partira pas'}
  Fond d'en-tête ${BRANDING.secondaryColor} · bouton ${CTA_FG} sur ${CTA_BG}
  Le lien du bouton est volontairement inerte (domaine .invalid).
-->
`
mkdirSync(dirname(SORTIE), { recursive: true })
writeFileSync(SORTIE, bandeau + html)

console.log(`\nAPERÇU ÉCRIT — ${SORTIE.replace(ROOT + '/', '')}`)
console.log(`  mot-marque      ${BRANDING.logoUrl}`)
console.log(`  câblé dans le hook  ${CABLE ? '✓ logoUrl: VINIZ_WORDMARK_PNG' : '✗ logoUrl n’est PAS câblé'}`)
console.log(`  en-tête ${BRANDING.secondaryColor}  ·  bouton ${CTA_FG} sur ${CTA_BG}`)
console.log(`  <img> rendue    ${/<img /.test(html) ? '✓ oui — le garde-fou isUsablePng a accepté l’URL' : '✗ non — repli texte'}`)
console.log(`  taille          ${html.length} caractères\n`)
if (!CABLE || !/<img /.test(html)) process.exit(1)
