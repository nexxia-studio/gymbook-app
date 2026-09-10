// GYM-336 — Demande expresse d'exécution anticipée : la version du LIBELLÉ.
//
// 🔴 CETTE CONSTANTE ET LE LIBELLÉ i18n NE FONT QU'UN. La version est transmise au serveur
// avec le consentement et finit dans `payments.early_performance_consent_version`, une
// colonne à valeur probante. Elle ne certifie rien d'autre que CECI : le texte exact que le
// membre avait sous les yeux quand il a coché.
//
// ⚠️ SI TU MODIFIES `early_performance.consent_label` (fr.json ET en.json), INCRÉMENTE
// CETTE VALEUR DANS LE MÊME COMMIT. Sans quoi deux libellés différents seraient enregistrés
// sous le même identifiant, et aucune demande ancienne ne serait plus rattachable à son
// texte — c'est exactement le défaut que LEGAL_VERSION corrige pour les CGV, à l'échelle
// d'une phrase.
//
// ⚠️ CE N'EST PAS `LEGAL_VERSION`, ET LES DEUX NE DOIVENT PAS ÊTRE CONFONDUES.
// `LEGAL_VERSION` (constants/legal/meta.ts) versionne les CGV entières et passera à 2.0
// avec GYM-330. Celle-ci ne versionne QUE la phrase de la case à cocher, qui vit à l'écran
// de paiement et non dans le contrat. Elles bougent pour des raisons différentes, à des
// rythmes différents.
export const EARLY_PERFORMANCE_CONSENT_VERSION = '1'

// La clé du libellé que la version ci-dessus certifie. Nommée ici pour que la constante et
// son texte se lisent au même endroit — et pour qu'une recherche sur l'une trouve l'autre.
export const EARLY_PERFORMANCE_CONSENT_I18N_KEY = 'early_performance.consent_label'
