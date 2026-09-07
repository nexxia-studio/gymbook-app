// ╔═══════════════════════════════════════════════════════════════════════════════════════╗
// ║  🔴 GYM-273 — LA TÉLÉMÉTRIE DE PAIEMENT PART DU SERVEUR, PAS DE L'APP.                ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════╝
//
// ─────────────────────────────────────────────────────────────────────────────────────
// LE FAIT, MESURÉ LE 07/09 SUR 45 JOURS
// ─────────────────────────────────────────────────────────────────────────────────────
//   payment_initiated : 68 événements
//   payment_completed :  3 événements      ← et aucun avant le 30/08
//   paiements réellement `paid` en base : 44 (39 checkout + 5 renouvellements)
//
// Soit ~7 % de captation. Le taux de conversion — la métrique dont dépend le modèle
// économique — était donc immesurable, et les six doubles prélèvements de GYM-317 sont
// passés inaperçus là où un entonnoir les aurait montrés d'un coup d'œil.
//
// LA CAUSE, LUE DANS LE CODE ET NON SUPPOSÉE. `apps/mobile/app/payment/success.tsx`
// émettait l'événement depuis une BOUCLE DE POLL qui ne tourne que pendant que le membre
// regarde l'écran de retour. Il fallait donc que trois choses se produisent, dans l'ordre :
// que l'app soit rouverte après le passage chez Mollie, que le membre atterrisse sur
// `/payment/success`, et que le poll observe `status = 'paid'` avant son délai d'abandon.
// Aucune n'est garantie — redirection navigateur, app tuée, paiement conclu sur un autre
// appareil. Et un RENOUVELLEMENT n'a par nature aucun écran : les 5 renouvellements de la
// période ne pouvaient produire aucun événement, jamais.
//
// Le webhook, lui, est le SEUL endroit qui sait qu'un paiement a abouti. C'est de là que
// l'événement part désormais.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// 🔴 RÈGLE ABSOLUE : CE MODULE NE PEUT PAS FAIRE ÉCHOUER UN WEBHOOK
// ═════════════════════════════════════════════════════════════════════════════════════
// Un euro encaissé ne se perd pas pour une télémétrie. Tout est avalé : clé absente,
// réseau coupé, PostHog en panne, réponse illisible. La fonction ne LÈVE JAMAIS et ne rend
// rien d'exploitable — l'appelant ne peut donc pas se tromper en oubliant un `catch`.
//
// ⚠️ ELLE POSE AUSSI UN DÉLAI D'ABANDON. Sans lui, un PostHog qui ne répond pas
// retiendrait le webhook jusqu'au timeout de la plateforme, et Mollie considérerait
// l'appel en échec — donc le rejouerait. Une télémétrie muette est un désagrément ; une
// télémétrie qui fait rejouer des webhooks de paiement est un incident.
//
// ⚠️ WEB CRYPTO ET NON `node:crypto`. Le second exige `@types/node`, que le dépôt n'a pas
// (aucun `deno.json` ni `node_modules` côté functions) : `deno run` passait, mais
// `deno check` échouait — « Could not find a matching package for 'npm:@types/node' » —
// et ce gate est celui de tout le dossier (cf. GYM-238). `crypto.subtle` est standard,
// présent dans le runtime, et n'ajoute aucune dépendance.

/** Endpoint d'ingestion. EU Cloud, comme le mobile (`lib/analytics.ts`). */
const DEFAULT_HOST = 'https://eu.i.posthog.com'

/** Au-delà, on abandonne l'envoi et on rend la main au webhook. */
const TIMEOUT_MS = 3000

/**
 * 🔴 LA CLÉ VIENT DE L'ENVIRONNEMENT, JAMAIS DU CODE.
 *
 * C'est le jeton de projet PostHog (`phc_…`), write-only et public par nature — il voyage
 * déjà dans chaque bundle mobile. Le versionner ici n'aurait pourtant rien à voir avec sa
 * sensibilité : il désigne le PROJET, et l'écrire en dur interdirait d'en changer sans
 * redéployer huit fonctions.
 *
 * ⚠️ ABSENTE → TOUT DEVIENT NO-OP, silencieusement, exactement comme dans
 * `apps/mobile/lib/analytics.ts`. Le code doit tourner sans la variable.
 */
const POSTHOG_KEY = Deno.env.get('POSTHOG_KEY')
const POSTHOG_HOST = Deno.env.get('POSTHOG_HOST') ?? DEFAULT_HOST

// ─────────────────────────────────────────────────────────────────────────────────────
// 🔴 `environment` — OBLIGATOIRE, ET DÉDUIT PLUTÔT QUE CONFIGURÉ
// ─────────────────────────────────────────────────────────────────────────────────────
// Sans cette propriété, l'événement rejoint les 1 475 `environment = null` qui polluent
// déjà le projet — et le filtre documenté du dépôt (`environment IS NOT staging`) ne peut
// pas les distinguer d'un test.
//
// ⚠️ ELLE N'EST PAS UNE VARIABLE D'ENVIRONNEMENT À POSER, ET C'EST DÉLIBÉRÉ. Une variable
// qu'il faut penser à définir sur chaque projet, et dont l'oubli ne se voit qu'en lisant
// les analyses trois semaines plus tard, reproduirait exactement le défaut qu'on corrige.
// C'est la leçon que `app.config.ts` a déjà tirée pour les coordonnées Sentry : « une
// source, qui ne peut pas manquer à l'appel ».
//
// `SUPABASE_URL` est injectée par la plateforme dans TOUTE Edge Function : elle ne peut
// pas manquer, et elle identifie le projet sans ambiguïté.
const PROD_PROJECT_REF = 'fcjupgvmjkqztxtwymdb'

/**
 * Environnement d'exécution, déduit du projet Supabase courant.
 *
 * ⚠️ LE REPLI EST `staging`, ET C'EST LE SENS SÛR. Un projet inconnu ne peut être qu'un
 * banc d'essai ou une branche : l'étiqueter `production` gonflerait la métrique de
 * conversion avec des tests, et un chiffre légèrement faux se lit exactement comme un
 * chiffre juste. L'inverse — un jour où la production changerait de projet — se voit
 * immédiatement : les paiements cesseraient d'apparaître, et cette constante est la
 * première chose qu'on relirait.
 */
export function analyticsEnvironment(): 'production' | 'staging' {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  return url.includes(PROD_PROJECT_REF) ? 'production' : 'staging'
}

/**
 * UUID DÉTERMINISTE à partir d'une graine — c'est la clé d'idempotence de l'événement.
 *
 * PostHog déduplique sur le quadruplet (`uuid`, `event`, `timestamp`, `distinct_id`) :
 * « Events that share the same uuid, event name, timestamp, and distinct_id are treated
 * as duplicates » (docs.posthog.com/docs/data/events#event-deduplication). Les quatre
 * doivent donc être STABLES d'un rejeu à l'autre — d'où cette dérivation, et d'où le
 * `timestamp` pris sur l'horodatage Mollie plutôt que sur `now()` (cf. `captureServerEvent`).
 *
 * Forme UUIDv8 (version 8 = « custom », réservée aux dérivations propriétaires par la
 * RFC 9562) : c'est exactement ce que ceci est — un UUID calculé, pas tiré au sort. Le
 * marquer v4 laisserait croire à de l'aléatoire.
 */
export async function deterministicUuid(seed: string): Promise<string> {
  const octets = new TextEncoder().encode(seed)
  const condensat = await crypto.subtle.digest('SHA-256', octets)
  const h = Array.from(new Uint8Array(condensat))
    .map((o) => o.toString(16).padStart(2, '0'))
    .join('')
  // Nibble 12 = version (8), nibble 16 = variante (10xx → 8/9/a/b) : les deux champs que
  // la RFC 9562 impose, posés sur un condensat par ailleurs inchangé.
  const v8 = h.slice(0, 12) + '8' + h.slice(13, 16) +
    ((parseInt(h[16], 16) & 0x3 | 0x8).toString(16)) + h.slice(17, 32)
  return `${v8.slice(0, 8)}-${v8.slice(8, 12)}-${v8.slice(12, 16)}-${v8.slice(16, 20)}-${v8.slice(20, 32)}`
}

export interface ServerEvent {
  /** Nom de l'événement, aligné sur ceux du mobile. */
  event: string
  /**
   * 🔴 L'UUID SUPABASE DU MEMBRE, ET RIEN D'AUTRE.
   *
   * Le mobile appelle `posthog.identify(userId)` avec l'UUID Supabase
   * (`apps/mobile/lib/analytics.ts`) — vérifié sur les données du 07/09 : 143 événements
   * sur 143 portent un `distinct_id` en forme d'UUID. Employer ici un identifiant Mollie,
   * un email ou un id de paiement fabriquerait une SECONDE personne pour le même membre,
   * et l'entonnoir `payment_initiated` → `payment_completed` ne se refermerait jamais.
   */
  distinctId: string
  /**
   * Horodatage de l'ÉVÉNEMENT MÉTIER, pas de son traitement. Doit être stable d'un rejeu
   * à l'autre, sans quoi la déduplication ne mord pas.
   */
  timestamp: string
  /** Graine de l'UUID déterministe — typiquement l'identifiant de paiement Mollie. */
  dedupeSeed: string
  /** ⚠️ AUCUNE DONNÉE PERSONNELLE. Montants, types, identifiants techniques uniquement. */
  properties: Record<string, string | number | boolean | null>
}

/**
 * Envoie un événement à PostHog. Best-effort de bout en bout, JAMAIS bloquant.
 *
 * Rend `void` et non un booléen : offrir un résultat inviterait un appelant à en tirer une
 * conséquence, et il n'y en a aucune à tirer — un webhook de paiement ne change pas de
 * comportement parce qu'une télémétrie n'est pas partie.
 */
export async function captureServerEvent(e: ServerEvent): Promise<void> {
  if (!POSTHOG_KEY) return

  try {
    const controller = new AbortController()
    const minuterie = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const res = await fetch(`${POSTHOG_HOST}/i/v0/e/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          api_key: POSTHOG_KEY,
          event: e.event,
          distinct_id: e.distinctId,
          timestamp: e.timestamp,
          uuid: await deterministicUuid(e.dedupeSeed),
          properties: {
            ...e.properties,
            // ⚠️ APRÈS L'ÉTALEMENT, DONC NON SURCHARGEABLES. `environment` est la propriété
            // dont l'absence a rendu 1 475 événements inexploitables : aucun appelant ne
            // doit pouvoir l'omettre, ni l'écraser par inadvertance.
            environment: analyticsEnvironment(),
            // Distingue, dans PostHog, ce qui vient du serveur de ce que les builds
            // mobiles antérieures à ce lot continueront d'envoyer un temps.
            source: 'server',
          },
        }),
      })
      if (!res.ok) {
        console.warn('[posthog] ingestion refusée (non bloquant):', res.status, e.event)
      }
    } finally {
      clearTimeout(minuterie)
    }
  } catch (err) {
    // Réseau, abandon sur délai, JSON illisible : rien de tout cela ne concerne le webhook.
    console.warn('[posthog] envoi impossible (non bloquant):', e.event,
      (err as Error)?.name ?? 'erreur')
  }
}
