import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * ╔═══════════════════════════════════════════════════════════════════════════════════════╗
 * ║  COCKPIT B2B — LOT 1 : la liste des salles, LECTURE SEULE                             ║
 * ╚═══════════════════════════════════════════════════════════════════════════════════════╝
 *
 * Antoine ne voyait ses salles nulle part ailleurs que dans Supabase. `is_super_admin()`
 * est déployée et 17 politiques RLS s'en servent — mais il n'existait AUCUN compte
 * `super_admin` et AUCUNE route. La sécurité était faite ; il manquait l'interface.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * 🔴 POURQUOI UNE RPC, ET NON DES LECTURES DE TABLES
 * ─────────────────────────────────────────────────────────────────────────────────────
 * La consigne est que la route REFUSE tout autre rôle CÔTÉ SERVEUR — pas qu'elle masque
 * un menu. Or une lecture directe de `nexxia_gyms` ne refuserait pas un `gym_admin` :
 * elle le SERVIRAIT, avec sa propre salle, et sa politique RLS aurait raison de le faire.
 * Le refus ne peut donc pas venir de la RLS de la table. Il vient de `cockpit_list_gyms`,
 * qui lève `42501` pour tout appelant non super-administrateur.
 *
 * Second motif : le décompte des membres impose une jointure `member_gyms × profiles` par
 * salle. Le faire ici demanderait une requête par salle et un agrégat en JavaScript —
 * c'est-à-dire un QUATRIÈME décompte des membres, quand GYM-348 en a imposé un seul.
 *
 * ⚠️ LECTURE SEULE. Aucune action, aucun paramètre. Changer un plan, une commission ou un
 * essai est le LOT 2 et passera par des RPC journalisées dans `gym_admin_actions`.
 */

/** Une salle, telle que `cockpit_list_gyms()` la rend. Les noms viennent de la RPC. */
export interface CockpitGym {
  gym_id: string
  name: string
  slug: string
  /**
   * La colonne brute `nexxia_gyms.plan`.
   *
   * ⚠️ ELLE PEUT MENTIR, et c'est pour ça qu'on affiche les deux : Dopamine est `premium`
   * en colonne, mais `nexxia_features` lui retire `multi_site`. Le plan qui fait foi est
   * `plan_effectif`.
   */
  plan_colonne: string
  /** Résolu par `get_effective_plan_core` — essai et dérogations par salle compris. */
  plan_effectif: string
  statut: string
  essai_actif: boolean
  essai_fin: string | null
  membres: number
  creneaux_a_venir: number
  mollie_connecte: boolean
  identite_legale_ok: boolean
  derniere_activite: string | null
  creee_le: string
}

/** Le refus serveur, rendu lisible pour que l'écran distingue « interdit » de « panne ». */
export type CockpitError =
  | { kind: 'forbidden' }
  | { kind: 'failed'; detail: string }

export function useCockpitGyms() {
  const [gyms, setGyms] = useState<CockpitGym[] | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<CockpitError | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    // ⚠️ TYPAGE FORCÉ, EN UN SEUL POINT, ET TEMPORAIRE.
    //
    // `types/database.ts` est GÉNÉRÉ depuis la base. La migration de ce lot n'étant pas
    // appliquée (aucun déploiement n'était autorisé), `cockpit_list_gyms` n'y figure pas
    // encore et `tsc --build` refuse l'appel — ce qui est le comportement voulu : c'est
    // GYM-350 qui a rendu ce contrôle réel, et il vient d'attraper une vraie absence.
    //
    // 🔴 À RETIRER à la régénération des types, juste après l'application de la migration :
    //     npx supabase gen types typescript --project-id <ref> > src/types/database.ts
    // Tant que ce cast vit, le contrat de la RPC est décrit ICI et pas dans les types
    // générés — c'est une dette, elle est nommée.
    const client = supabase as unknown as {
      rpc(fn: 'cockpit_list_gyms'): Promise<{
        data: CockpitGym[] | null
        error: { code?: string; message?: string } | null
      }>
    }
    const { data, error: rpcError } = await client.rpc('cockpit_list_gyms')

    if (rpcError) {
      // 🔴 `42501` est le code que la RPC lève pour un appelant non super-administrateur.
      // On le distingue d'une panne : dire « une erreur est survenue » à quelqu'un qui n'a
      // simplement pas le droit d'être là l'enverrait chercher un incident qui n'existe
      // pas. Même leçon que GYM-346 — le refus et l'incertitude ne se disent pas pareil.
      const refus = rpcError.code === '42501'
        || /réservé au super-administrateur/i.test(rpcError.message ?? '')
      if (refus) {
        setError({ kind: 'forbidden' })
      } else {
        // Le détail va dans la console, pas à l'écran.
        console.error('[cockpit] cockpit_list_gyms a échoué :', rpcError)
        setError({ kind: 'failed', detail: rpcError.code ?? 'unknown' })
      }
      setGyms(null)
      setIsLoading(false)
      return
    }

    setGyms(data ?? [])
    setIsLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  return { gyms, isLoading, error, reload: load }
}
