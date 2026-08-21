/**
 * GYM-247 — chemin unique vers l'onglet Abonnement.
 *
 * Settings.tsx pilote ses onglets par un state local ; il lit désormais `?tab=` pour
 * qu'un lien puisse pointer directement sur l'un d'eux. Constante partagée plutôt que
 * chaîne recopiée : trois composants y renvoient, et une URL recopiée finit par diverger
 * de l'onglet qu'elle vise.
 */
export const SUBSCRIPTION_TAB = 'subscription'
export const SUBSCRIPTION_TAB_PATH = `/settings?tab=${SUBSCRIPTION_TAB}`
