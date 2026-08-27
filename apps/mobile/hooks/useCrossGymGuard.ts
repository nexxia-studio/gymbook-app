// GYM-294 — 🔴 UN CRÉNEAU D'UNE AUTRE SALLE, SOUS LA MARQUE DE LA SIENNE.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// LE DÉFAUT, ET POURQUOI IL NE SE VOIT PAS EN LISANT L'ÉCRAN
// ═════════════════════════════════════════════════════════════════════════════════════
// `app/session/[id].tsx` lit un créneau par son seul identifiant. La RLS de `time_slots`
// autorise la lecture dès que le membre appartient à la salle DU CRÉNEAU — elle fait donc
// exactement son travail, et c'est ce qui rend le défaut invisible : la requête réussit,
// aucune erreur ne remonte, et l'écran affiche un cours de la salle B habillé aux couleurs
// et au nom de la salle A. Le membre lit une heure, un coach, une capacité — tout est vrai,
// et tout appartient à une autre salle que celle qu'il croit consulter.
//
// ⚠️ CE N'EST PAS UN DÉFAUT D'AUTORISATION. Rien ne fuit : le membre a le droit de voir ce
// créneau. C'est un défaut de CONTEXTE — l'app lui ment sur l'endroit où il se trouve.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// POURQUOI UN HOOK PARTAGÉ ET NON UNE VÉRIFICATION DANS L'ÉCRAN
// ─────────────────────────────────────────────────────────────────────────────────────
// Le même motif existe partout où l'app ouvre une ressource PAR IDENTIFIANT sans que la
// salle figure dans l'adresse. Corriger `session/[id]` seul règlerait le cas signalé et
// laisserait les autres — et surtout, la prochaine route à identifiant naîtrait sans garde.
// La décision (rester / basculer / refuser) est ici, une fois ; les écrans ne font que
// fournir la salle de la ressource et rendre ce que le hook leur dit.
import { useEffect, useState } from 'react'
import { GYM_MODE } from '../lib/gymResolver'
import { useActiveGymId } from '../lib/activeGym'
import { listMyGyms, type GymMembership } from '../lib/gymSwitch'

/**
 * L'état du garde. `pending` tant qu'on ne sait pas — un écran ne doit RIEN décider
 * pendant ce temps, surtout pas afficher un contenu qu'il faudra retirer.
 */
export type CrossGymState =
  /** Même salle, mode single, ou salle de la ressource inconnue : rien à faire. */
  | { kind: 'ok' }
  /** On interroge les adhésions. */
  | { kind: 'pending' }
  /** Autre salle, dont le membre EST membre : l'écran propose d'y aller. */
  | { kind: 'elsewhere'; gym: GymMembership }
  /** Autre salle dont il n'est PAS membre : l'écran renvoie vers le refus de GYM-301. */
  | { kind: 'not_member'; gymId: string }

/**
 * Décide quoi faire quand une ressource ouverte par identifiant appartient à une autre
 * salle que la salle active.
 *
 * ⚠️ EN MODE `single`, IL SORT AVANT TOUT — sans état, sans effet, sans requête. Une seule
 * salle existe : le cas ne peut pas se produire, et l'app de Dopamine ne doit pas payer un
 * aller-retour réseau pour une question qui n'a pas de sens chez elle. C'est vérifiable en
 * lisant la première ligne, et c'est délibérément la première.
 *
 * ⚠️ `gymIdRessource` NUL = ON NE SAIT PAS ENCORE, et surtout pas « c'est la bonne salle ».
 * Tant que la requête de l'écran n'a pas répondu, le garde reste `ok` — l'écran affiche son
 * propre chargement. Confondre « pas encore chargé » avec « même salle » ferait clignoter
 * l'interstitiel à chaque ouverture.
 */
export function useCrossGymGuard(gymIdRessource: string | null | undefined): CrossGymState {
  const gymActive = useActiveGymId()
  const [etat, setEtat] = useState<CrossGymState>({ kind: 'ok' })

  useEffect(() => {
    if (GYM_MODE === 'single') return
    if (!gymIdRessource || !gymActive) return
    if (gymIdRessource === gymActive) { setEtat({ kind: 'ok' }); return }

    let vivant = true
    setEtat({ kind: 'pending' })
    listMyGyms().then((res) => {
      if (!vivant) return
      // ⚠️ UNE LECTURE D'ADHÉSIONS QUI ÉCHOUE N'EST PAS « PAS MEMBRE ». C'est la règle
      // posée en GYM-300, et elle vaut ici aussi : sur une coupure réseau, on ne barre pas
      // l'écran d'un membre qui a peut-être parfaitement le droit d'être là. On laisse
      // passer — au pire il voit le contenu sous la mauvaise marque, ce qui est le
      // comportement d'avant ce lot, jamais un refus inventé.
      if (res.status !== 'ok') { setEtat({ kind: 'ok' }); return }
      const salle = res.gyms.find((g) => g.gymId === gymIdRessource)
      setEtat(salle ? { kind: 'elsewhere', gym: salle } : { kind: 'not_member', gymId: gymIdRessource })
    })
    return () => { vivant = false }
  }, [gymIdRessource, gymActive])

  return etat
}
