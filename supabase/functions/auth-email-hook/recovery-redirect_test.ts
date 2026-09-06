// GYM-313 — BANC DE LA RÉÉCRITURE DE `redirect_to`.
//
//     deno test supabase/functions/auth-email-hook/recovery-redirect_test.ts
//
// ⚠️ AUCUNE DÉPENDANCE, ET C'EST DÉLIBÉRÉ. Le dépôt n'a pas d'`import_map` ni de
// `deno.json` côté functions, et `deno.lock` ne connaît que deux modules distants
// (`supabase-js`, `standardwebhooks`). Tirer `jsr:@std/assert` pour trois égalités
// ajouterait une entrée au lock et exigerait le réseau pour lancer un banc qui teste une
// fonction PURE. L'assertion locale tient en six lignes et tourne hors-ligne.
//
// ⚠️ CE BANC NE COUVRE QUE LA FONCTION PURE, et il ne peut pas en couvrir plus :
// `index.ts` appelle `Deno.serve()` au chargement du module — l'importer démarrerait un
// serveur. C'est la raison pour laquelle la réécriture vit dans son propre fichier.
import { recoveryRedirectTo, type RecoveryRedirectConfig } from './recovery-redirect.ts'

function assertEquals(actual: string, expected: string, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}\n  attendu : ${expected}\n  obtenu  : ${actual}`)
  }
}

// Les valeurs de production, telles que `index.ts` les compose (cf. DASHBOARD_URL).
const CONFIG: RecoveryRedirectConfig = {
  webResetBase: 'https://app.viniz.app/reset-password',
  relayHost: 'links.viniz.app',
}

// ─────────────────────────────────────────────────────────────────────────────────────
// 1. LE CAS QUI CORRIGE L'INCIDENT — recovery sur le relais
// ─────────────────────────────────────────────────────────────────────────────────────
Deno.test('recovery : le relais est réécrit vers la page web, slug en query', () => {
  assertEquals(
    recoveryRedirectTo('https://links.viniz.app/dopamine/reset-password', 'recovery', CONFIG),
    'https://app.viniz.app/reset-password?gym=dopamine',
    'le lien Dopamine doit finir sur la page web',
  )
})

Deno.test('recovery : la règle vaut pour toute salle, pas pour Dopamine en dur', () => {
  // Le MÊME chemin de code, un slug différent : c'est la contrainte multi-tenant du lot.
  assertEquals(
    recoveryRedirectTo('https://links.viniz.app/studio-kama/reset-password', 'recovery', CONFIG),
    'https://app.viniz.app/reset-password?gym=studio-kama',
    'une salle quelconque doit être traitée comme Dopamine',
  )
  assertEquals(
    recoveryRedirectTo(
      'https://links.viniz.app/studio-yoga-test-1/reset-password',
      'recovery',
      CONFIG,
    ),
    'https://app.viniz.app/reset-password?gym=studio-yoga-test-1',
    'un slug à tirets et chiffres doit passer intact',
  )
})

Deno.test('recovery : la query d\'origine survit, le slug du chemin gagne', () => {
  assertEquals(
    recoveryRedirectTo(
      'https://links.viniz.app/studio-kama/reset-password?source=email&gym=autre',
      'recovery',
      CONFIG,
    ),
    'https://app.viniz.app/reset-password?source=email&gym=studio-kama',
    'les paramètres existants sont reportés et `gym` vient du chemin',
  )
})

Deno.test('recovery : un slug à échapper reste une valeur de query valide', () => {
  // Un slug est censé être une chaîne d'URL simple ; s'il ne l'est pas, `searchParams`
  // encode — il ne fabrique pas un second paramètre.
  assertEquals(
    recoveryRedirectTo('https://links.viniz.app/a%26b/reset-password', 'recovery', CONFIG),
    'https://app.viniz.app/reset-password?gym=a%26b',
    'le slug est encodé, jamais interprété',
  )
})

// ─────────────────────────────────────────────────────────────────────────────────────
// 2. LES AUTRES TYPES D'EMAIL — INTOUCHÉS
// ─────────────────────────────────────────────────────────────────────────────────────
Deno.test('les autres types traversent sans être touchés', () => {
  // Leurs pages d'arrivée lisent le fragment de GoTrue et fonctionnent ; les réécrire
  // casserait quatre parcours pour en réparer un.
  for (const type of ['signup', 'invite', 'magiclink', 'email_change', 'reauthentication']) {
    const raw = 'https://links.viniz.app/dopamine/reset-password'
    assertEquals(recoveryRedirectTo(raw, type, CONFIG), raw, `le type ${type} doit être intact`)
  }
})

Deno.test('signup sur sa propre cible reste intact', () => {
  const raw = 'https://links.viniz.app/dopamine/confirm'
  assertEquals(recoveryRedirectTo(raw, 'signup', CONFIG), raw, 'la cible de confirmation ne bouge pas')
})

// ─────────────────────────────────────────────────────────────────────────────────────
// 3. IDEMPOTENCE — une surface qui finalise déjà n'est pas réécrite
// ─────────────────────────────────────────────────────────────────────────────────────
Deno.test('idempotence : la page web n\'est pas réécrite', () => {
  const raw = 'https://app.viniz.app/reset-password'
  assertEquals(recoveryRedirectTo(raw, 'recovery', CONFIG), raw, 'le lien gérant ne bouge pas')
})

Deno.test('idempotence : un lien DÉJÀ réécrit repasse inchangé', () => {
  const raw = 'https://app.viniz.app/reset-password?gym=dopamine'
  assertEquals(recoveryRedirectTo(raw, 'recovery', CONFIG), raw, 'pas de double réécriture')
})

Deno.test('idempotence : la barre oblique finale ne crée pas de différence', () => {
  const raw = 'https://app.viniz.app/reset-password/'
  assertEquals(recoveryRedirectTo(raw, 'recovery', CONFIG), raw, 'même page, même verdict')
})

// ─────────────────────────────────────────────────────────────────────────────────────
// 4. LES FORMES INATTENDUES — TOUTES RETOMBENT SUR LE COMPORTEMENT ACTUEL
// ─────────────────────────────────────────────────────────────────────────────────────
Deno.test('URL inattendue : rien n\'est réécrit, rien ne lève', () => {
  const inchangés = [
    // Pas une URL du tout — le cas qui ferait lever `new URL`.
    'pas-une-url',
    '',
    // Le bon hôte, mais pas cette page.
    'https://links.viniz.app/dopamine/bookings',
    'https://links.viniz.app/dopamine/confirm-waitlist',
    // Un seul segment : ce n'est pas la forme `/<slug>/reset-password`.
    'https://links.viniz.app/reset-password',
    // Trois segments : pas davantage.
    'https://links.viniz.app/dopamine/reset-password/etape-2',
    // Le bon chemin, un hôte étranger : on ne réécrit que le relais qu'on connaît.
    'https://exemple.test/dopamine/reset-password',
    // Le bon hôte et le bon chemin, mais pas en https.
    'http://links.viniz.app/dopamine/reset-password',
    // La Site URL nue, valeur de repli de `verifyUrl` quand `redirect_to` est vide.
    'https://app.viniz.app',
  ]
  for (const raw of inchangés) {
    assertEquals(recoveryRedirectTo(raw, 'recovery', CONFIG), raw, `« ${raw} » doit être intact`)
  }
})

Deno.test('config illisible : on retombe sur la valeur d\'origine', () => {
  // Si `DASHBOARD_URL` était mal posée, le hook ne doit pas échouer — il doit se comporter
  // comme avant ce lot. C'est le pire cas assumé du module.
  const raw = 'https://links.viniz.app/dopamine/reset-password'
  const cassée: RecoveryRedirectConfig = { webResetBase: 'pas-une-url', relayHost: 'links.viniz.app' }
  assertEquals(recoveryRedirectTo(raw, 'recovery', cassée), raw, 'une base illisible ne casse rien')
})

// ─────────────────────────────────────────────────────────────────────────────────────
// 5. L'APERÇU DU LIEN FINAL — CE QUE LE MEMBRE REÇOIT VRAIMENT
// ─────────────────────────────────────────────────────────────────────────────────────
// Ce test compose le lien COMPLET comme `verifyUrl` le fait, pour deux salles. Il est ici
// et pas seulement dans la recette pour que la recette ne puisse pas dériver du code : si
// la forme du lien change, ce banc casse.
Deno.test('aperçu : le lien complet de l\'email, pour deux salles', () => {
  const SUPABASE_URL = 'https://abcdefghijklm.supabase.co'
  const lien = (redirectTo: string) => {
    const params = new URLSearchParams({
      token: 'pkce_2f1c9b0e',
      type: 'recovery',
      redirect_to: recoveryRedirectTo(redirectTo, 'recovery', CONFIG),
    })
    return `${SUPABASE_URL}/auth/v1/verify?${params.toString()}`
  }

  assertEquals(
    lien('https://links.viniz.app/dopamine/reset-password'),
    'https://abcdefghijklm.supabase.co/auth/v1/verify?token=pkce_2f1c9b0e&type=recovery' +
      '&redirect_to=https%3A%2F%2Fapp.viniz.app%2Freset-password%3Fgym%3Ddopamine',
    'aperçu Dopamine',
  )

  assertEquals(
    lien('https://links.viniz.app/studio-yoga-test-1/reset-password'),
    'https://abcdefghijklm.supabase.co/auth/v1/verify?token=pkce_2f1c9b0e&type=recovery' +
      '&redirect_to=https%3A%2F%2Fapp.viniz.app%2Freset-password%3Fgym%3Dstudio-yoga-test-1',
    'aperçu Studio Yoga Test 1',
  )
})
