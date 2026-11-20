// GYM-387 — NORMALISATION ET VALIDATION DU TÉLÉPHONE. Fonction pure, sans dépendance.
//
// ⚠️ PAS DE LIBRAIRIE, ET C'EST UN CHOIX. `libphonenumber` pèse plusieurs centaines de Ko
// pour valider des plans de numérotation que le produit n'a pas à connaître : la salle veut
// un numéro qu'elle peut COMPOSER, pas un numéro certifié. On normalise donc la forme
// (+32470123456) et on refuse ce qui est manifestement trop court — rien de plus.
//
// ⚠️ CE FICHIER NE DOIT RIEN IMPORTER de l'app (ni supabase, ni i18n) : il est chargé seul
// par `tests/telephone.test.ts`.

/** Indicatif par pays de la salle (`nexxia_gyms.country`). Hors de cette liste : aucun
 *  préfixe automatique, l'indicatif est demandé au membre. */
const INDICATIFS: Record<string, string> = { BE: '32', FR: '33', LU: '352', NL: '31' }

/** Pays dont le numéro national s'écrit avec un 0 de tête qu'on ne compose pas depuis
 *  l'étranger. Le Luxembourg n'en a pas. */
const AVEC_ZERO_NATIONAL = new Set(['32', '33', '31'])

export const TELEPHONE_MIN_CHIFFRES = 8
/** E.164 : quinze chiffres au plus, indicatif compris. */
const TELEPHONE_MAX_CHIFFRES = 15

export type RaisonTelephoneInvalide = 'vide' | 'invalide' | 'indicatif_requis' | 'trop_court'

export type ResultatTelephone =
  | { ok: true; e164: string }
  | { ok: false; raison: RaisonTelephoneInvalide }

/** L'indicatif (sans « + ») du pays d'une salle, ou `null` s'il n'est pas dans la liste. */
export function indicatifDuPays(pays: string | null | undefined): string | null {
  if (!pays) return null
  return INDICATIFS[pays.trim().toUpperCase()] ?? null
}

/**
 * Rend le numéro au format international, ou la raison du refus.
 *
 * · « 0470 12 34 56 » + BE  → +32470123456
 * · « +32 (0)470 12-34-56 » → +32470123456 (le pays de la salle n'est pas consulté)
 * · « 0032 470 … »          → +32470…
 * · sans indicatif et sans pays connu → `indicatif_requis`
 */
export function normaliserTelephone(saisie: string | null | undefined, pays?: string | null): ResultatTelephone {
  const brut = (saisie ?? '').trim()
  if (!brut) return { ok: false, raison: 'vide' }

  // « (0) » est la façon d'écrire le 0 national à côté d'un indicatif : il ne se compose pas.
  const compact = brut.replace(/\(0\)/g, '').replace(/[\s.\-/()]/g, '')
  if (!/^\+?\d+$/.test(compact)) return { ok: false, raison: 'invalide' }

  let chiffres: string
  let indicatif: string | null = null

  if (compact.startsWith('+') || compact.startsWith('00')) {
    chiffres = compact.replace(/^(\+|00)/, '')
    indicatif = Object.values(INDICATIFS).find((i) => chiffres.startsWith(i)) ?? null
  } else {
    indicatif = indicatifDuPays(pays)
    if (!indicatif) return { ok: false, raison: 'indicatif_requis' }
    chiffres = indicatif + compact
  }

  // Les chiffres SIGNIFICATIFS sont ceux du numéro national, 0 de tête retiré. Pour un
  // indicatif hors liste, on ne sait pas où il s'arrête : on compte alors tout.
  let national = indicatif ? chiffres.slice(indicatif.length) : chiffres
  if (indicatif && AVEC_ZERO_NATIONAL.has(indicatif)) national = national.replace(/^0/, '')

  if (!/[1-9]/.test(national)) return { ok: false, raison: 'invalide' }
  if (national.length < TELEPHONE_MIN_CHIFFRES) return { ok: false, raison: 'trop_court' }

  const complet = (indicatif ?? '') + national
  if (complet.length > TELEPHONE_MAX_CHIFFRES) return { ok: false, raison: 'invalide' }
  return { ok: true, e164: `+${complet}` }
}

/** Clé i18n du message d'erreur — l'écran la traduit, cette fonction ne connaît pas `t`. */
export function cleErreurTelephone(raison: RaisonTelephoneInvalide): string {
  return `phone_validation.${raison}`
}
