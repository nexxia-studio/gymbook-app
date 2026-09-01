// GYM-313 — LE LIEN DE RÉINITIALISATION FINIT SUR LA SURFACE QUI SAIT LE FINIR.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// LE DÉFAUT MESURÉ EN PRODUCTION
// ─────────────────────────────────────────────────────────────────────────────────────
// Un membre demande une réinitialisation. `resetPasswordForEmail` passe un `redirectTo`
// construit par `apps/mobile/lib/gymUrls.ts` :
//
//     https://links.viniz.app/<slug>/reset-password
//
// GoTrue consomme le jeton, crée la session, puis REDIRIGE (302) vers cette URL en
// déposant les jetons dans le FRAGMENT. Deux choses se percutent alors :
//
//   1. l'AASA de `apps/links` déclare `/dopamine/*` pour l'app de Dopamine, et
//      `apps/mobile/app.config.ts` déclare `applinks:links.viniz.app` : l'iPhone
//      revendique donc cette URL et peut ouvrir l'app dessus ;
//   2. le fragment est fabriqué par Safari à partir de l'en-tête `Location` du 302 — il
//      n'accompagne PAS l'URL remise à l'app.
//
// L'app ouvre alors `app/dopamine/reset-password.tsx` SANS jetons, tombe dans la branche
// « aucun jeton, aucune session » et affiche « Lien invalide ou expiré » — avec un unique
// bouton « retour à la connexion ». Le jeton était pourtant valide : il a été consommé, la
// session a été créée. Le membre est dans un cul-de-sac, et rien n'atteint Sentry puisque
// c'est un état géré, pas une exception.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// CE QUE CE MODULE FAIT, ET RIEN D'AUTRE
// ─────────────────────────────────────────────────────────────────────────────────────
// Il réécrit le `redirect_to` des seuls emails `recovery` vers la surface web qui sait
// FINALISER — `app.viniz.app/reset-password`, la page `apps/dashboard/src/pages/
// ResetPassword.tsx`, qui porte un vrai formulaire et un renvoi de lien. Cette page est
// publique (hors `ProtectedRoute`, cf. `App.tsx`) et c'est déjà la cible des membres créés
// par `admin-create-member`. Aucun domaine n'est revendiqué par l'app pour elle : le lien
// ne peut plus être confisqué.
//
// 🔴 LE CONTEXTE DE SALLE PASSE PAR LA QUERY, JAMAIS PAR LE FRAGMENT. La page d'arrivée lit
// `?gym=<slug>` (GYM-303) pour choisir sa marque. Le mettre dans le fragment serait
// reproduire le défaut qu'on corrige — un fragment ne survit ni à un Universal Link, ni au
// 302 de GoTrue, qui écrase de toute façon le fragment avec ses propres jetons. La query,
// elle, traverse les deux.
//
// 🔴 LE SLUG VIENT DU CHEMIN, JAMAIS D'UNE CONSTANTE. La règle vaut pour TOUTE salle :
// `/studio-kama/reset-password` donne `?gym=studio-kama` par le même chemin de code que
// Dopamine. Aucun nom de client n'est écrit ici — c'est la contrainte multi-tenant du lot,
// et c'est aussi ce qui fait que la page de relais générique `_viniz/reset-password.html`
// et ce module disent la même chose.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// ⚠️ POURQUOI TOUT ÉCHEC RETOMBE SUR LA VALEUR D'ORIGINE
// ─────────────────────────────────────────────────────────────────────────────────────
// Ce module est appelé depuis un hook BLOQUANT : GoTrue ne se rabat jamais sur ses propres
// gabarits, et une exception ici ferait échouer la réinitialisation elle-même (voir l'en-
// tête de `index.ts`). La fonction ne peut donc PAS lever. Toute forme non reconnue — URL
// invalide, hôte étranger, chemin d'une autre forme, base de destination illisible — rend
// `rawRedirectTo` INCHANGÉ, c'est-à-dire le comportement d'aujourd'hui. Le pire cas de ce
// lot est « on n'a rien corrigé », jamais « on a cassé l'envoi ».
//
// Ce module est PUR et sans dépendance : aucun accès réseau, aucune lecture d'env, aucun
// journal. C'est ce qui le rend vérifiable au banc (`recovery-redirect_test.ts`), et c'est
// la seule raison pour laquelle la journalisation reste chez l'appelant.

/** Le segment terminal qui identifie une page de réinitialisation, ici et sur le relais. */
const RESET_PATH_SEGMENT = 'reset-password'

/** Le seul type d'email concerné. Les autres traversent ce module sans être touchés. */
const RECOVERY_ACTION = 'recovery'

export interface RecoveryRedirectConfig {
  /**
   * URL COMPLÈTE de la page web qui finalise, chemin compris
   * (`https://app.viniz.app/reset-password`). Complète et non « origine + chemin déduit » :
   * le chemin ne doit exister qu'à un seul endroit, et c'est l'appelant qui le compose
   * depuis `DASHBOARD_URL`, comme le fait déjà `admin-create-member`.
   */
  webResetBase: string
  /**
   * Hôte du relais d'Universal Links — celui que l'app revendique, donc le seul dont une
   * URL mérite d'être réécrite. Le reste est laissé intact : on ne réécrit que le défaut
   * qu'on a mesuré, pas tout ce qui y ressemble.
   */
  relayHost: string
}

/** Chemin sans barre oblique de bordure, pour comparer `/reset-password` et `/reset-password/`. */
function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/'
}

/**
 * Rend le `redirect_to` à écrire dans le lien de vérification.
 *
 * @param rawRedirectTo La valeur d'origine — déjà validée par GoTrue contre sa liste d'URL
 *                      autorisées avant l'appel du hook.
 * @param emailActionType `email_data.email_action_type` du payload signé.
 * @param config         Cible web et hôte du relais.
 * @returns L'URL réécrite pour `recovery` sur le relais, `rawRedirectTo` dans tous les
 *          autres cas. Ne lève jamais.
 */
export function recoveryRedirectTo(
  rawRedirectTo: string,
  emailActionType: string,
  config: RecoveryRedirectConfig,
): string {
  // ── 1. UN SEUL TYPE EST CONCERNÉ ────────────────────────────────────────────────────
  // `signup`, `invite`, `magiclink`, `email_change`, `reauthentication` gardent leur
  // destination : leurs pages d'arrivée (`/signup/confirmed`, `/welcome`) lisent le
  // fragment déposé par GoTrue et fonctionnent. Elles ne sont pas revendiquées par l'app.
  if (emailActionType !== RECOVERY_ACTION) return rawRedirectTo
  if (!rawRedirectTo) return rawRedirectTo

  try {
    const incoming = new URL(rawRedirectTo)
    const target = new URL(config.webResetBase)

    // ── 2. IDEMPOTENCE ────────────────────────────────────────────────────────────────
    // Le lien du GÉRANT vaut déjà `${origin}/reset-password` (`ForgotPassword.tsx`), et un
    // lien déjà réécrit repasserait ici si quelqu'un rejouait un envoi. Dans les deux cas
    // la destination est DÉJÀ la surface qui finalise : on n'y touche pas — surtout pas
    // pour lui ajouter un `?gym=` que son chemin ne porte pas.
    if (
      incoming.origin === target.origin &&
      normalizePath(incoming.pathname) === normalizePath(target.pathname)
    ) {
      return rawRedirectTo
    }

    // ── 3. EST-CE BIEN LE RELAIS QUE L'APP CONFISQUE ? ────────────────────────────────
    // Trois conditions, et il les faut toutes. `hostname` et non `host` : un port serait
    // une forme qu'on ne connaît pas, et l'inconnu ne se réécrit pas.
    if (incoming.protocol !== 'https:') return rawRedirectTo
    if (incoming.hostname.toLowerCase() !== config.relayHost.toLowerCase()) return rawRedirectTo

    // La forme du relais est EXACTEMENT `/<slug>/reset-password` : deux segments, le second
    // étant la page. `/dopamine/bookings`, `/reset-password` seul, ou un chemin plus profond
    // ne sont pas cette page — on les laisse.
    const segments = incoming.pathname.split('/').filter(Boolean)
    if (segments.length !== 2) return rawRedirectTo
    if (segments[1] !== RESET_PATH_SEGMENT) return rawRedirectTo

    // ⚠️ LE SEGMENT EST DÉCODÉ AVANT D'ÊTRE REPOSÉ EN QUERY, ET LE BANC L'A EXIGÉ.
    // `pathname` rend la forme ENCODÉE (`/a%26b/reset-password`) ; la passer telle quelle à
    // `searchParams.set`, qui encode à son tour, produisait `gym=a%2526b` — un slug que la
    // page d'arrivée aurait lu « a%26b » et n'aurait reconnu pour aucune salle. Un aller-
    // retour, un seul encodage. Un échappement malformé fait lever `decodeURIComponent`,
    // donc retomber sur la valeur d'origine : le contrat du module tient.
    const slug = decodeURIComponent(segments[0])
    if (!slug) return rawRedirectTo

    // ── 4. RÉÉCRITURE ─────────────────────────────────────────────────────────────────
    const rewritten = new URL(target.href)

    // La query d'origine est reportée avant `gym` : rien de ce que l'appelant avait mis
    // n'est perdu, et le slug du CHEMIN reste la source de vérité de la marque — c'est la
    // même règle que `_viniz/reset-password.html`, qui lit lui aussi le premier segment.
    for (const [key, value] of incoming.searchParams) {
      rewritten.searchParams.set(key, value)
    }
    rewritten.searchParams.set('gym', slug)

    // ⚠️ AUCUN FRAGMENT N'EST REPORTÉ, ET C'EST VOULU. GoTrue écrase le fragment de
    // `redirect_to` avec `#access_token=…&type=recovery` au moment du 302 : tout ce qu'on
    // y mettrait serait perdu, et le croire transmis est précisément l'erreur d'origine.
    return rewritten.href
  } catch {
    // URL illisible des deux côtés (`webResetBase` mal formée comprise) : comportement
    // d'aujourd'hui, sans exception. Un email au lien d'avant vaut mieux qu'aucun email.
    return rawRedirectTo
  }
}
