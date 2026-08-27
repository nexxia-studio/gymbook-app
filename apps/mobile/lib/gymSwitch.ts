// GYM-288 (livrable 3) — CHANGER DE SALLE ACTIVE.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// 🔴 LE PIÈGE DE CE MODULE : LA BASCULE RÉUSSIT, ET L'ÉCRAN MENT QUAND MÊME.
// ═════════════════════════════════════════════════════════════════════════════════════
// `switch_active_gym` met à jour UNE colonne : `profiles.gym_id`. Tout le reste — ce que
// l'app a déjà chargé, mis en cache, ou laissé ouvert — continue de parler de la salle
// PRÉCÉDENTE tant qu'on ne s'en occupe pas. Le membre verrait alors les données d'une
// salle sous les couleurs d'une autre, sans que rien ne signale l'incohérence.
//
// Ce module est donc la LISTE EXHAUSTIVE de ce qu'il faut faire retomber, et l'ordre y
// compte. Il ne se contente pas d'appeler la RPC.
import { supabase } from './supabase'
import { useAuthStore } from '../stores/useAuthStore'
import { useBookingStore } from '../stores/useBookingStore'
import { __resetGymProfileCache } from './gymProfile'
import { clearCachedBrand } from './theme/brand'
import { writeSelectedGymSlug } from './gymResolver'
import { setAnalyticsGym } from './analytics'
import { withActiveGymWrite } from './activeGymWrites'

/** Une appartenance, telle que `my_gym_memberships()` la rend. */
export interface GymMembership {
  gymId: string
  slug: string
  name: string
  logoUrl: string | null
  isActive: boolean
}

export type MembershipsOutcome =
  | { status: 'ok'; gyms: GymMembership[] }
  | { status: 'offline' }
  | { status: 'error' }

export type SwitchOutcome =
  | { status: 'ok' }
  /** PT403 — la RPC refuse une salle où le membre n'est pas inscrit. À raison. */
  | { status: 'not_a_member' }
  | { status: 'offline' }
  | { status: 'error' }

/** SQLSTATE levé par switch_active_gym quand l'appelant n'appartient pas à la salle. */
const NOT_A_MEMBER = 'PT403'

// ⚠️ LE CAST PORTE SUR LE CLIENT, PAS SUR LA MÉTHODE — leçon du correctif GYM-265 :
// `const rpc = supabase.rpc as …` détache la méthode de son receveur et l'appel lève.
type RpcClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{
    data: unknown
    error: { code?: string; message?: string } | null
  }>
}

function isNetwork(error: { message?: string } | null): boolean {
  const m = (error?.message ?? '').toLowerCase()
  return m.includes('network') || m.includes('fetch')
}

/** Les salles du membre connecté. L'identité vient d'auth.uid(), rien n'est passé ici. */
export async function listMyGyms(): Promise<MembershipsOutcome> {
  try {
    const { data, error } = await (supabase as unknown as RpcClient).rpc('my_gym_memberships')
    if (error) return { status: isNetwork(error) ? 'offline' : 'error' }
    const rows = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : []
    return {
      status: 'ok',
      gyms: rows.map((r) => ({
        gymId: String(r.gym_id ?? ''),
        slug: String(r.slug ?? ''),
        name: String(r.name ?? ''),
        logoUrl: (r.logo_url as string | null) ?? null,
        // ⚠️ `is_active` vient de profiles.gym_id, la MÊME source que les données
        // affichées. Le recalculer côté app le ferait diverger de l'écran.
        isActive: r.is_active === true,
      })),
    }
  } catch {
    return { status: 'offline' }
  }
}

/**
 * Bascule la salle active, PUIS fait retomber tout ce qui dépendait de l'ancienne.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * L'ORDRE N'EST PAS ARBITRAIRE
 * ─────────────────────────────────────────────────────────────────────────────────────
 * Les caches sont vidés AVANT que la salle active change. Dans l'autre sens, le
 * changement de `gym_id` déclencherait immédiatement les rechargements des écrans montés,
 * et ceux-ci répondraient depuis les caches encore pleins de la salle quittée — puis
 * n'auraient plus aucune raison de se relancer.
 */
export async function switchGym(gym: GymMembership): Promise<SwitchOutcome> {
  // 🔴 GYM-292 — TOUTE LA BASCULE EST SIGNALÉE « EN VOL ». Pendant ce temps, aucune
  // lecture de profil ne peut abaisser la salle active : une lecture partie avant la RPC
  // et revenue après elle rapporterait la salle QUITTÉE, et la bascule reviendrait en
  // arrière toute seule. Voir lib/activeGymWrites.ts pour la règle complète.
  return withActiveGymWrite(async () => {
    try {
      // ── 1. LE SERVEUR TRANCHE D'ABORD. Rien n'est purgé tant qu'on ignore si la bascule
      //       est seulement permise : vider les caches puis échouer laisserait l'app dans un
      //       état plus dégradé qu'avant le geste.
      const { error } = await (supabase as unknown as RpcClient)
        .rpc('switch_active_gym', { p_gym_id: gym.gymId })

      if (error) {
        if (error.code === NOT_A_MEMBER) return { status: 'not_a_member' }
        return { status: isNetwork(error) ? 'offline' : 'error' }
      }

      // ── 2. LES CACHES QUI NE DÉPENDENT D'AUCUN RENDU ────────────────────────────────
      // Ceux-là ne se rechargent JAMAIS tout seuls : aucun composant ne les observe.
      __resetGymProfileCache()  // nom, adresse, horizon de réservation de la salle
      await clearCachedBrand()  // logo et couleurs mémorisés (viniz.gym_brand)

      // ── 3. LE SLUG MÉMORISÉ, qui commande la MARQUE affichée ────────────────────────
      // ⚠️ `writeSelectedGymSlug` NOTIFIE ses abonnés (GYM-288 livrable 1) : c'est ce qui
      // fait relire la marque à la racine, laquelle n'est jamais démontée et ne la
      // relirait pas autrement.
      await writeSelectedGymSlug(gym.slug)

      // ── 4. LES RÉSERVATIONS ET LES FAVORIS ──────────────────────────────────────────
      // Vidés MAINTENANT et rechargés à l'étape 6, une fois la nouvelle salle connue.
      useBookingStore.getState().resetForGymSwitch()

      // ── 5. LA SALLE ACTIVE — ce qui déclenche tout le reste ─────────────────────────
      //
      // 🔴 GYM-292 — POSÉE DIRECTEMENT, PLUS RELUE. Elle l'était par `refreshProfile`,
      // c'est-à-dire par un aller-retour supplémentaire dont le résultat était DÉJÀ connu :
      // le serveur venait de confirmer `gym.gymId`. Cette relecture n'apportait rien et
      // ouvrait une fenêtre — si elle échouait ou revenait périmée, l'app restait sur
      // l'ancienne salle alors que la bascule avait réussi en base.
      //
      // Tous les écrans qui lisent `useActiveGymId()` voient alors leur dépendance
      // changer : ils rechargent, ET le canal temps réel se ferme puis se rouvre sur la
      // nouvelle salle (cf. hooks/useSchedule.ts).
      useAuthStore.getState().setActiveGymConfirmed(gym.gymId)

      // ── 6. LE RESTE DU PROFIL ───────────────────────────────────────────────────────
      // Nom, avatar, badge : ils n'ont pas changé, mais cet appel est ce qui garantit que
      // le store et le serveur ne divergent pas après une bascule.
      // ⚠️ Il ne réappliquera PAS `gym_id` — l'écriture est encore en vol, et c'est
      // exactement le cas que la garde protège.
      await useAuthStore.getState().refreshProfile()

      // ── 7. CE QUI NE DÉPEND D'AUCUN ÉCRAN MONTÉ ─────────────────────────────────────
      setAnalyticsGym(gym.gymId)
      const userId = useAuthStore.getState().user?.id
      if (userId) await useBookingStore.getState().fetchBookings(userId)
      await useBookingStore.getState().loadFavorites()

      return { status: 'ok' }
    } catch {
      return { status: 'offline' }
    }
  })
}
