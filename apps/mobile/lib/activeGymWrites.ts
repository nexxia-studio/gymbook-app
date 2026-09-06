// GYM-292 — 🔴 « UNE ÉCRITURE EST-ELLE EN VOL ? »
//
// ═════════════════════════════════════════════════════════════════════════════════════
// LA RÈGLE DE RÉSOLUTION, ÉCRITE UNE FOIS POUR TOUTES
// ═════════════════════════════════════════════════════════════════════════════════════
// Deux chemins peuvent poser la salle active dans le store, et ils ne disent pas toujours
// la même chose au même instant :
//
//   · `refreshProfile()` LIT `profiles.gym_id` et applique ce que le serveur répond ;
//   · `switchGym()` ÉCRIT `profiles.gym_id` puis pose la salle confirmée.
//
// Le second est plus récent que le premier par construction — il vient de faire écrire le
// serveur. Mais une lecture partie AVANT l'écriture peut revenir APRÈS elle : elle
// rapporterait alors l'ancienne salle, et rétrograderait une bascule déjà réussie. Le
// membre verrait sa salle « revenir en arrière » toute seule.
//
// D'où la règle, et elle tient en une phrase :
//
//   🔴 LE SERVEUR FAIT FOI, SAUF SI UNE ÉCRITURE EST EN VOL.
//
// Tant qu'une écriture n'est pas retombée, aucune lecture ne peut abaisser la salle
// active. C'est le seul cas où l'app se fie à elle-même plutôt qu'au serveur — et elle a
// raison de le faire, puisqu'elle sait quelque chose que sa propre lecture ignore encore.
//
// ⚠️ UN COMPTEUR, PAS UN BOOLÉEN. Deux bascules qui se chevauchent (un membre qui tape
// deux fois) remettraient un booléen à `false` à la fin de la PREMIÈRE, rouvrant la
// fenêtre alors que la seconde est encore en vol.

let enVol = 0

/**
 * Exécute une écriture de la salle active en la signalant comme « en vol ».
 *
 * ⚠️ `finally` ET NON `then` : une écriture qui échoue doit refermer la fenêtre, sans quoi
 * la première erreur réseau condamnerait toutes les lectures suivantes à être ignorées —
 * l'app resterait figée sur une salle jusqu'au prochain lancement.
 */
export async function withActiveGymWrite<T>(fn: () => Promise<T>): Promise<T> {
  enVol++
  try {
    return await fn()
  } finally {
    enVol--
  }
}

/** `true` tant qu'au moins une écriture de la salle active n'est pas retombée. */
export function activeGymWriteInFlight(): boolean {
  return enVol > 0
}

/** Remise à zéro — réservée aux tests. Le code de production n'en a pas besoin. */
export function __resetActiveGymWrites(): void {
  enVol = 0
}
