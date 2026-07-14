// Contenu légal v1 PUBLIABLE (privacy + CGV). Sources de vérité :
// docs/legal/politique-confidentialite-v1.md et docs/legal/cgv-v1.md (corps publiables).
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

// Version + date : ré-exportées depuis le module feuille `meta` (les textes l'importent
// aussi — le sortir d'ici évite un cycle d'imports).
export { LEGAL_VERSION, LEGAL_UPDATED_AT } from './meta'

export type LegalKind = 'cgu' | 'privacy'
export type LegalLang = 'fr' | 'en'

const DOCS: Record<LegalKind, Record<LegalLang, string>> = {
  cgu: { fr: cguFr, en: cguEn },
  privacy: { fr: privacyFr, en: privacyEn },
}

export function getLegalDoc(kind: LegalKind, lang: LegalLang): string {
  return DOCS[kind][lang] ?? DOCS[kind].fr
}
