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

/**
 * Longueur du numéro NATIONAL (chiffres significatifs, 0 de tête retiré), par indicatif.
 * `min` est le seuil de validation ; `max` ne sert qu'à reconnaître un indicatif tapé
 * sans « + » (voir plus bas). Le Luxembourg a des fixes à 6 chiffres.
 */
const LONGUEURS: Record<string, { min: number; max: number }> = {
  '32': { min: 8, max: 9 },
  '33': { min: 8, max: 9 },
  '31': { min: 8, max: 9 },
  '352': { min: 6, max: 9 },
}
/** Indicatif hors liste : on ne sait pas où il s'arrête, on compte tous les chiffres. */
export const TELEPHONE_MIN_CHIFFRES = 8

/**
 * Caractères invisibles et marques de direction. Un numéro copié depuis les contacts iOS
 * arrive enveloppé de U+202A … U+202C et séparé par des espaces insécables : rien de
 * visible à l'écran, et un refus « numéro invalide » que le membre ne peut pas comprendre.
 */
const INVISIBLES = /[\u200E\u200F\u202A-\u202E\u2066-\u2069\u00A0\uFEFF]/g

function sansZeroNational(indicatif: string, national: string): string {
  return AVEC_ZERO_NATIONAL.has(indicatif) ? national.replace(/^0/, '') : national
}
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
  const brut = (saisie ?? '').replace(INVISIBLES, ' ').trim()
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
    // 🔴 L'INDICATIF TAPÉ SANS « + ». « 32 470 12 34 56 » porte déjà le 32 : l'ajouter une
    // seconde fois donnerait +3232470123456, un numéro bien formé et faux. Si la saisie
    // commence par l'indicatif de la salle ET que le reste a la longueur d'un numéro de ce
    // pays, c'est un numéro international auquel il ne manque que le « + ».
    const reste = compact.startsWith(indicatif) ? sansZeroNational(indicatif, compact.slice(indicatif.length)) : null
    const { min, max } = LONGUEURS[indicatif]
    chiffres = reste !== null && reste.length >= min && reste.length <= max
      ? compact
      : indicatif + compact
  }

  // Les chiffres SIGNIFICATIFS sont ceux du numéro national, 0 de tête retiré. Pour un
  // indicatif hors liste, on ne sait pas où il s'arrête : on compte alors tout.
  const national = indicatif ? sansZeroNational(indicatif, chiffres.slice(indicatif.length)) : chiffres
  const minimum = indicatif ? LONGUEURS[indicatif].min : TELEPHONE_MIN_CHIFFRES

  if (!/[1-9]/.test(national)) return { ok: false, raison: 'invalide' }
  if (national.length < minimum) return { ok: false, raison: 'trop_court' }

  const complet = (indicatif ?? '') + national
  if (complet.length > TELEPHONE_MAX_CHIFFRES) return { ok: false, raison: 'invalide' }
  return { ok: true, e164: `+${complet}` }
}

/** Clé i18n du message d'erreur — l'écran la traduit, cette fonction ne connaît pas `t`. */
export function cleErreurTelephone(raison: RaisonTelephoneInvalide): string {
  return `phone_validation.${raison}`
}

export type TelephoneAEnregistrer =
  /** Champ non touché : le numéro NE DOIT PAS figurer dans l'UPDATE. */
  | { type: 'inchange'; aVerifier: boolean }
  | { type: 'modifie'; e164: string }
  | { type: 'refus'; raison: RaisonTelephoneInvalide }

/**
 * 🔴 ON NE RÉÉCRIT JAMAIS UN NUMÉRO QUE LE MEMBRE N'A PAS TOUCHÉ.
 *
 * Normaliser à chaque enregistrement du profil transformait un numéro existant sans que
 * personne l'ait demandé : « 6504992804 » (américain, saisi sans indicatif, réel en prod)
 * devenait +326504992804 chez une salle belge dès que le membre corrigeait son adresse.
 * Un numéro bien formé, faux, et l'original perdu.
 *
 * La normalisation ne s'applique donc qu'à un champ MODIFIÉ dans la session d'édition.
 * Un numéro existant non conforme est SIGNALÉ (`aVerifier`) et ne bloque rien.
 *
 * `initial` est la valeur LUE en base (`''` si vide) ; `null` si elle n'a pas pu être lue —
 * dans ce cas seul un champ rempli compte comme une modification.
 */
export function telephonePourEnregistrement(
  saisie: string,
  initial: string | null,
  pays?: string | null,
): TelephoneAEnregistrer {
  const modifie = initial === null ? saisie.trim() !== '' : saisie !== initial
  if (!modifie) return { type: 'inchange', aVerifier: !estTelephoneConforme(initial) }
  const tel = normaliserTelephone(saisie, pays)
  return tel.ok ? { type: 'modifie', e164: tel.e164 } : { type: 'refus', raison: tel.raison }
}

/** Vide (rien à vérifier) ou déjà au format international valide. */
export function estTelephoneConforme(numero: string | null | undefined): boolean {
  const n = (numero ?? '').trim()
  if (!n) return true
  return n.startsWith('+') && normaliserTelephone(n).ok
}
