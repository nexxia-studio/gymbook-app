import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * ╔═══════════════════════════════════════════════════════════════════════════════════════╗
 * ║  COCKPIT B2B — LOT 2 : les gestes, et le journal qui les retient                      ║
 * ╚═══════════════════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ AUCUNE ÉCRITURE DIRECTE. Les quatre gestes passent par des RPC `SECURITY DEFINER` qui
 * vérifient `is_super_admin()` en première ligne (42501) et journalisent dans `audit_logs`
 * DANS LA MÊME TRANSACTION. Si le journal échoue, le geste est annulé — c'est ce qui rend
 * le journal non contournable.
 *
 * ⚠️ ET `audit_logs` EST EN AJOUT SEUL, y compris pour `service_role` et les fonctions
 * `SECURITY DEFINER` : un trigger `BEFORE UPDATE OR DELETE` lève. Vérifié au banc — un
 * UPDATE par le PROPRIÉTAIRE de la table est refusé en 42501.
 *
 * LE JOURNAL SE LIT EN DIRECT, sans RPC : la politique « Super admins voient tous les logs »
 * est en `SELECT` et couvre exactement ce besoin. Contrairement à la liste des salles — où
 * une lecture directe aurait SERVI un gérant au lieu de le refuser — ici un gérant qui lit
 * `audit_logs` de SA salle est dans son droit, et c'est même voulu : une intervention de
 * l'éditeur sur une salle doit être visible par cette salle.
 */

/** Une ligne du journal, telle que `audit_logs` la porte. */
export interface CockpitJournalEntry {
  id: string
  action: string
  actor_id: string | null
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  created_at: string
}

/** Ce que rend une RPC de geste : seul `error` nous intéresse ici. */
interface RpcRetour {
  error: { code?: string; message?: string } | null
}

export type ActionError =
  /** 42501 — l'appelant n'est pas super-administrateur. */
  | { kind: 'forbidden' }
  /** 22023 — saisie refusée (motif vide, plan hors grille, taux aberrant…). */
  | { kind: 'invalid'; message: string }
  /** 23505 — la valeur demandée est déjà celle en place. */
  | { kind: 'unchanged'; message: string }
  | { kind: 'failed'; message: string }

function toActionError(e: { code?: string; message?: string }): ActionError {
  // 🔴 LES CODES SONT DISTINGUÉS, comme dans GYM-346 : « tu n'as pas le droit », « ta
  // saisie est refusée » et « rien à changer » n'appellent pas la même réaction, et un
  // message unique enverrait chercher un incident là où il n'y en a pas.
  if (e.code === '42501') return { kind: 'forbidden' }
  if (e.code === '22023') return { kind: 'invalid', message: e.message ?? '' }
  if (e.code === '23505') return { kind: 'unchanged', message: e.message ?? '' }
  console.error('[cockpit] geste refusé :', e)
  return { kind: 'failed', message: e.code ?? 'unknown' }
}

export function useCockpitGymDetail(gymId: string | undefined) {
  const [journal, setJournal] = useState<CockpitJournalEntry[] | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const loadJournal = useCallback(async () => {
    if (!gymId) return
    setIsLoading(true)
    const { data, error } = await supabase
      .from('audit_logs')
      .select('id, action, actor_id, old_data, new_data, created_at')
      .eq('gym_id', gymId)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) {
      console.error('[cockpit] lecture du journal :', error)
      setJournal(null)
    } else {
      setJournal((data ?? []) as CockpitJournalEntry[])
    }
    setIsLoading(false)
  }, [gymId])

  useEffect(() => { void loadJournal() }, [loadJournal])

  /**
   * ⚠️ FAÇADE TYPÉE, EN UN SEUL POINT, ET TEMPORAIRE.
   *
   * `types/database.ts` est GÉNÉRÉ depuis la base. La migration de ce lot n'étant pas
   * appliquée (aucun déploiement n'était autorisé), les quatre RPC n'y figurent pas et
   * `tsc --build` refuse les appels — ce qui est le comportement voulu : le contrôle rendu
   * réel par GYM-350 vient d'attraper une vraie absence, pour la seconde fois.
   *
   * 🔴 À RETIRER à la régénération des types, juste après l'application :
   *     supabase gen types typescript --project-id <ref> > src/types/database.ts
   * Tant que cette façade vit, le contrat des RPC est décrit ICI et pas dans les types
   * générés — c'est une dette, elle est nommée, et le lot 1 a déjà montré qu'on la solde.
   */
  const rpc = useMemo(() => supabase as unknown as {
    rpc(fn: 'cockpit_set_plan', args: { p_gym_id: string; p_plan: string; p_reason: string }): PromiseLike<RpcRetour>
    rpc(fn: 'cockpit_set_status', args: { p_gym_id: string; p_status: string; p_reason: string }): PromiseLike<RpcRetour>
    rpc(fn: 'cockpit_set_trial_end', args: { p_gym_id: string; p_trial_ends_at: string | null; p_reason: string }): PromiseLike<RpcRetour>
    rpc(fn: 'cockpit_set_commission_override', args: { p_gym_id: string; p_sepa_rate: number | null; p_cb_rate: number | null; p_reason: string }): PromiseLike<RpcRetour>
  }, [])

  /**
   * Enveloppe commune aux quatre gestes : un seul endroit sait traduire un refus, et un
   * seul endroit relit le journal après coup.
   *
   * ⚠️ Le journal est RELU APRÈS CHAQUE GESTE, réussi ou non. Après un succès c'est
   * évident ; après un refus ça l'est moins, et c'est pourtant ce qui garantit que
   * l'écran ne laisse pas croire qu'une ligne a été écrite quand elle ne l'a pas été.
   * Le banc le prouve : les huit gestes refusés n'ont écrit AUCUNE ligne.
   */
  const executer = useCallback(async (
    appel: () => PromiseLike<RpcRetour>,
  ): Promise<ActionError | null> => {
    setBusy(true)
    const { error } = await appel()
    await loadJournal()
    setBusy(false)
    return error ? toActionError(error) : null
  }, [loadJournal])

  const setPlan = useCallback((plan: string, reason: string) =>
    executer(() => rpc.rpc('cockpit_set_plan', { p_gym_id: gymId!, p_plan: plan, p_reason: reason })),
  [executer, rpc, gymId])

  const setStatus = useCallback((status: string, reason: string) =>
    executer(() => rpc.rpc('cockpit_set_status', { p_gym_id: gymId!, p_status: status, p_reason: reason })),
  [executer, rpc, gymId])

  /** `null` clôt l'essai ; une date le prolonge. */
  const setTrialEnd = useCallback((trialEndsAt: string | null, reason: string) =>
    executer(() => rpc.rpc('cockpit_set_trial_end', { p_gym_id: gymId!, p_trial_ends_at: trialEndsAt, p_reason: reason })),
  [executer, rpc, gymId])

  /** Les deux taux ensemble, ou `null` des deux côtés pour retirer la dérogation. */
  const setCommission = useCallback((sepa: number | null, cb: number | null, reason: string) =>
    executer(() => rpc.rpc('cockpit_set_commission_override', {
      p_gym_id: gymId!, p_sepa_rate: sepa, p_cb_rate: cb, p_reason: reason,
    })),
  [executer, rpc, gymId])

  return { journal, isLoading, busy, reload: loadJournal, setPlan, setStatus, setTrialEnd, setCommission }
}

/**
 * Le RETOUR ARRIÈRE, dérivé du journal.
 *
 * ⚠️ IL N'Y A PAS DE « BOUTON ANNULER » DÉDIÉ, et c'est voulu : revenir en arrière est un
 * geste comme un autre — il passe par la même RPC, avec le même motif obligatoire, et il
 * laisse sa propre ligne au journal. Une annulation silencieuse serait un trou dans
 * l'histoire, exactement ce que ce journal existe pour empêcher.
 *
 * Cette fonction ne fait que LIRE dans `old_data` la valeur d'avant, pour préremplir le
 * formulaire. C'est le banc qui prouve que ça suffit : `set_plan` rejoué avec
 * `old_data->>'plan'` ramène exactement l'état précédent.
 */
export function valeurAvant(entry: CockpitJournalEntry): { champ: string; valeur: unknown } | null {
  if (!entry.old_data) return null
  const [champ, valeur] = Object.entries(entry.old_data)[0] ?? []
  return champ === undefined ? null : { champ, valeur }
}
