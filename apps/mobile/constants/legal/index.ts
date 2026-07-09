// GYM-46 — contenu légal PROVISOIRE. Contenu définitif : GYM-109.
//
// Le markdown est exporté comme simple chaîne (modules `.ts`) et consommé en prop par
// le composant générique `LegalScreen`. Metro (Expo) ne sait pas importer un `.md` comme
// chaîne sans transformer/dépendance dédiée, et l'app RN est gelée pour la QA — on garde
// donc le markdown dans des modules typés, trivialement remplaçables plus tard par une
// source DB (il suffira de brancher `getLegalDoc` sur une requête, la prop ne change pas).
import { cguFr } from './cgu.fr'
import { cguEn } from './cgu.en'
import { privacyFr } from './privacy.fr'
import { privacyEn } from './privacy.en'

export const LEGAL_VERSION = '0.1-draft'
// Date de version du TEXTE (pas la date courante) : figée tant que le contenu provisoire
// n'a pas été remplacé (GYM-109).
export const LEGAL_UPDATED_AT = '2026-07-06'

export type LegalKind = 'cgu' | 'privacy'
export type LegalLang = 'fr' | 'en'

const DOCS: Record<LegalKind, Record<LegalLang, string>> = {
  cgu: { fr: cguFr, en: cguEn },
  privacy: { fr: privacyFr, en: privacyEn },
}

export function getLegalDoc(kind: LegalKind, lang: LegalLang): string {
  return DOCS[kind][lang] ?? DOCS[kind].fr
}
