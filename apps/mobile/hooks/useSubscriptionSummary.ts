import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { ACTIVE_SUBSCRIPTION_STATUSES, isSubscriptionActive } from '../lib/subscription'

export interface SubscriptionSummary {
  isActive: boolean
  detail: string | null
}

/** Date courte JJ/MM pour le résumé (le détail complet vit dans /profile/subscription). */
function formatShortDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Résumé de la formule du membre : crédits à l'unité ET abonnement récurrent.
 *
 * GYM-208 — les deux sources sont désormais lues SYSTÉMATIQUEMENT, et non plus en
 * cascade avec sortie anticipée sur les crédits. L'ancien court-circuit rendait le
 * cumul (abonnement + crédits) invisible, alors que les deux peuvent coexister.
 *
 * La donnée était déjà juste : c'est la PRÉSENTATION qui trompait. Un membre venant
 * d'acheter un One-Shot, avec 1 crédit au compteur, lisait « Aucun abonnement actif »
 * — juste après un parcours de paiement déjà déroutant, de quoi croire son achat perdu.
 */
export function useSubscriptionSummary() {
  const { t } = useTranslation()
  const [summary, setSummary] = useState<SubscriptionSummary>({ isActive: false, detail: null })

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // GYM-90 — le nom vient de gym_plans.name (plan_id est un UUID depuis GYM-76),
    // pas d'une clé i18n dynamique. Aligné sur la branche récurrente ci-dessous.
    //
    // GYM-191 — le filtre de statut n'est qu'un PRÉ-FILTRE de requête : le verdict revient à
    // isSubscriptionActive(), qui vérifie aussi le terme. D'où le chargement de `ends_at`.
    // Sans lui, un abonnement échu depuis moins d'une heure (cron horaire pas encore passé)
    // s'afficherait comme actif dans le résumé du profil.
    const [creditsRes, subRes] = await Promise.all([
      supabase
        .from('member_credits')
        .select('plan_id, credits_remaining, plan:gym_plans(name)')
        .eq('member_id', user.id)
        .gt('credits_remaining', 0)
        .order('updated_at', { ascending: false }),
      supabase
        .from('member_subscriptions')
        .select('id, status, ends_at, plan_name, plan:gym_plans(name)')
        .eq('member_id', user.id)
        .in('status', ACTIVE_SUBSCRIPTION_STATUSES)
        .order('starts_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const creditRows = creditsRes.data
    const sub = subRes.data

    // GYM-94 — solde = SOMME des credits_remaining de toutes les lignes dispo (fin du limit 1).
    const totalRemaining = (creditRows ?? []).reduce((sum, r) => sum + (r.credits_remaining ?? 0), 0)
    const hasCredits = totalRemaining > 0
    const hasSubscription = !!sub && isSubscriptionActive(sub.status, sub.ends_at)

    const parts: string[] = []

    if (hasSubscription) {
      const until = formatShortDate(sub!.ends_at as string | null)
      parts.push(
        until
          ? t('subscription.summary_unlimited_until', { date: until })
          : t('subscription.summary_unlimited'),
      )
    }

    if (hasCredits) {
      parts.push(t('subscription.summary_credits', { count: totalRemaining }))
    }

    setSummary({
      isActive: hasSubscription || hasCredits,
      // Formulation neutre quand il n'y a rien : « aucun abonnement » était faux pour
      // qui détient des crédits, et brutal pour qui n'a simplement encore rien pris.
      detail: parts.length > 0 ? parts.join(' · ') : null,
    })
  }, [t])

  useEffect(() => { load() }, [load])

  return { summary, refresh: load }
}
