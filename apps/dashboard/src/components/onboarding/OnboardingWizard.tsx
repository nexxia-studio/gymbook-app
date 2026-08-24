// GYM-248 — Wizard d'onboarding, 5 étapes, monté sur le dashboard tant que
// `nexxia_gyms.onboarding_completed` est faux.
//
// PRINCIPES
//  · L'étape courante est la valeur DB `onboarding_step` (CHECK 1..5 en base) — pas un
//    compteur local. Le wizard reprend donc où le gérant s'était arrêté, y compris après
//    une reconnexion. (Sous réserve de la persistance : cf. lib/onboarding.ts.)
//  · CHAQUE étape est passable. Un onboarding qui retient son utilisateur en otage est un
//    onboarding qu'on referme et qu'on ne rouvre jamais. « Passer » avance sans rien faire,
//    « plus tard » ferme le wizard SANS perdre l'étape.
//  · Les étapes 2 à 5 ne dupliquent AUCUN formulaire existant : elles renvoient vers
//    l'écran qui sait déjà le faire (Planning, Réglages, Membres). Recopier ces
//    formulaires ici, c'est créer une seconde vérité qui divergera.
//  · ⚠️ LE CTA D'UNE ÉTAPE DÉLÉGUÉE N'AVANCE PAS L'ÉTAPE. Il ouvre l'écran cible et met le
//    wizard en retrait. C'est l'OBJET qui valide l'étape — ≥1 activité, ≥1 coach,
//    ≥1 créneau, une politique d'absences, ≥1 membre (cf. detectSatisfiedSteps).
//    Première version : le CTA avançait PUIS naviguait, si bien que « Configurer » se
//    comportait exactement comme « Passer » — le wizard se croyait plus loin que la salle.
//    Constaté au premier parcours gérant réel. NE PAS réintroduire d'avancement ici.
//  · Seule l'étape 1 écrit directement — logo_url / primary_color / secondary_color sont
//    dans la liste blanche GYM-180, vérifié.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  X, Check, ArrowRight, Palette, Dumbbell, UserCog, CalendarPlus, ShieldAlert, UserPlus,
  PartyPopper, Sparkles, CheckCircle2,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { supabase } from '@/lib/supabase'
import { useGymStore } from '@/stores/useGymStore'
import { useToastStore } from '@/hooks/useToast'
import { useOnboarding } from '@/hooks/useOnboarding'
import { ONBOARDING_LAST_STEP, hasSeenWelcome, markWelcomeSeen } from '@/lib/onboarding'
import type { SaveOutcome } from '@/lib/onboarding'
import { useEffectivePlan } from '@/hooks/useEffectivePlan'

const STEP_ICONS = [Palette, Dumbbell, UserCog, CalendarPlus, ShieldAlert, UserPlus] as const

export function OnboardingWizard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const gym = useGymStore((s) => s.gym)
  const addToast = useToastStore((s) => s.addToast)
  const { step, completed, isOpen, satisfied, dismiss, advance, complete } = useOnboarding()
  const { plan, limits } = useEffectivePlan()

  const [celebrating, setCelebrating] = useState(false)
  // Écran de bienvenue : lu une seule fois à l'initialisation (pas d'effet, donc pas de
  // rendu en cascade). `gym?.id` peut être null au premier rendu — on retombe alors sur
  // « déjà vu » et le calcul est refait dès que la salle arrive, via la clé du composant.
  const [welcomeDone, setWelcomeDone] = useState(false)

  // Étape 1 — marque de la salle.
  const [logoUrl, setLogoUrl] = useState('')
  const [primary, setPrimary] = useState('#C8F000')
  const [secondary, setSecondary] = useState('#111111')
  const [brandLoaded, setBrandLoaded] = useState(false)
  const [savingBrand, setSavingBrand] = useState(false)

  useEffect(() => {
    if (!gym?.id || brandLoaded || step !== 1) return
    let cancelled = false
    void (async () => {
      const { data } = await supabase
        .from('nexxia_gyms')
        .select('logo_url, primary_color, secondary_color')
        .eq('id', gym.id)
        .single()
      if (cancelled || !data) return
      setLogoUrl(data.logo_url ?? '')
      if (data.primary_color) setPrimary(data.primary_color)
      if (data.secondary_color) setSecondary(data.secondary_color)
      setBrandLoaded(true)
    })()
    return () => { cancelled = true }
  }, [gym?.id, brandLoaded, step])

  if (!isOpen && !celebrating) return null
  if (step === null || completed === null) return null

  /** Remonte l'état de la persistance sans mentir : local-only n'est pas un succès muet. */
  function reportOutcome(outcome: SaveOutcome) {
    if (outcome === 'failed') addToast(t('onboarding.save_error'), 'warning')
    else if (outcome === 'local-only') addToast(t('onboarding.saved_locally'), 'warning')
  }

  async function handleAdvance() {
    const wasLast = step === ONBOARDING_LAST_STEP
    const outcome = await advance()
    reportOutcome(outcome)
    if (wasLast) setCelebrating(true)
  }

  async function handleFinish() {
    const outcome = await complete()
    reportOutcome(outcome)
    setCelebrating(true)
  }

  /**
   * Ouvre l'écran qui sait faire et met le wizard en RETRAIT — sans toucher à l'étape.
   * L'étape sera validée au retour sur le dashboard, quand la détection verra l'objet.
   */
  function handleGo(path: string) {
    dismiss()
    navigate(path)
  }

  async function handleSaveBrand() {
    if (!gym?.id) return
    setSavingBrand(true)
    // logo_url / primary_color / secondary_color : liste blanche GYM-180, écriture RLS
    // directe comme GymSettingsCard. Pas d'upload de fichier — cf. la note de PR.
    const { error } = await supabase
      .from('nexxia_gyms')
      .update({
        logo_url: logoUrl.trim() || null,
        primary_color: primary,
        secondary_color: secondary,
      })
      .eq('id', gym.id)
    setSavingBrand(false)
    if (error) {
      addToast(t('onboarding.save_error'), 'warning')
      return
    }
    addToast(t('onboarding.step1.saved'))
    await handleAdvance()
  }

  // ── Écran de félicitations ──
  if (celebrating) {
    return (
      <Shell onClose={() => setCelebrating(false)}>
        <div className="py-4 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-accent-dim/10">
            <PartyPopper className="h-8 w-8 text-accent-dim" />
          </div>
          <h2 className="font-display text-2xl font-black tracking-tight text-dark">
            {t('onboarding.done.title')}
          </h2>
          <p className="mt-2 font-body text-sm text-dark/50">
            {t('onboarding.done.message', { gym: gym?.name ?? '' })}
          </p>
          <Button className="mt-7" onClick={() => setCelebrating(false)}>
            {t('onboarding.done.cta')}
          </Button>
        </div>
      </Shell>
    )
  }

  // ── Écran de BIENVENUE — premier atterrissage après création de la salle ──
  //
  // Choix assumé : c'est un écran À PART, AVANT le wizard, pas une « étape 0 ». L'étape est
  // une valeur DB bornée par un CHECK 1..5 (nexxia_gyms_onboarding_step_check) ; y glisser
  // un 0 aurait demandé une migration, que ce lot n'a pas le droit de faire. Et le contenu
  // n'a pas la même nature : le wizard fait AGIR, celui-ci ne fait qu'ACCUEILLIR.
  //
  // ⚠️ AUCUNE limite en dur : tout vient de useEffectivePlan → get_effective_plan, la porte
  // d'entrée unique du gating (GYM-245). `null` y signifie ILLIMITÉ, pas « inconnu ».
  if (!welcomeDone && gym?.id && !hasSeenWelcome(gym.id)) {
    const dismissWelcome = () => {
      if (gym?.id) markWelcomeSeen(gym.id)
      setWelcomeDone(true)
    }
    return (
      <div className="mb-6 rounded-2xl border border-[#E8E6E0] bg-card p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-dim/10">
            <Sparkles className="h-5 w-5 text-accent-dim" />
          </div>
          <div>
            <h2 className="font-display text-xl font-black tracking-tight text-dark">
              {t('onboarding.welcome.title')}
            </h2>
            <p className="mt-1 font-body text-sm leading-relaxed text-dark/50">
              {t('onboarding.welcome.subtitle', {
                plan: t(`onboarding.welcome.plan_names.${plan ?? 'free'}`, {
                  defaultValue: plan ?? 'free',
                }),
              })}
            </p>
          </div>
        </div>

        {/* ⚠️ DEUX `null` DE SENS OPPOSÉ, à ne surtout pas confondre :
            · `limits` null      = le plan n'a PAS pu être résolu (panne, accès refusé) ;
            · `limits.max_*` null = la limite est ILLIMITÉE (convention de la grille GYM-245).
            Rendre le premier comme le second annoncerait « illimité » alors qu'on ne sait
            rien — exactement l'erreur que _shared/effective-plan.ts met en garde de faire. */}
        {limits ? (
          <ul className="mt-5 flex flex-col gap-2">
            <LimitRow label={t('onboarding.welcome.limit_members')} value={limits.max_members} />
            <LimitRow label={t('onboarding.welcome.limit_slots')} value={limits.max_slots_per_month} />
            <LimitRow label={t('onboarding.welcome.limit_admins')} value={limits.max_admins} />
          </ul>
        ) : (
          <p className="mt-5 rounded-xl bg-dark/[0.03] px-4 py-3 font-body text-sm text-dark/50">
            {t('onboarding.welcome.limits_unavailable')}
          </p>
        )}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button onClick={dismissWelcome} className="sm:flex-1">
            {t('onboarding.welcome.start')}
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            onClick={() => { dismissWelcome(); navigate('/settings?tab=subscription') }}
            className="sm:flex-1"
          >
            {t('onboarding.welcome.see_plans')}
          </Button>
        </div>
      </div>
    )
  }

  const Icon = STEP_ICONS[step - 1] ?? Palette
  const isLast = step === ONBOARDING_LAST_STEP

  return (
    <Shell onClose={dismiss}>
      {/* Progression — l'étape vient de la base, pas d'un compteur d'écran. */}
      <div className="flex items-center gap-2">
        {Array.from({ length: ONBOARDING_LAST_STEP }, (_, i) => i + 1).map((n) => (
          <div
            key={n}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              n < step ? 'bg-accent-dim' : n === step ? 'bg-dark' : 'bg-dark/10'
            }`}
          />
        ))}
      </div>
      <p className="mt-3 font-body text-xs font-semibold uppercase tracking-wide text-dark/40">
        {t('onboarding.step_counter', { current: step, total: ONBOARDING_LAST_STEP })}
      </p>

      <div className="mt-4 flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-dim/10">
          <Icon className="h-5 w-5 text-accent-dim" />
        </div>
        <div>
          <h2 className="font-display text-xl font-black tracking-tight text-dark">
            {t(`onboarding.step${step}.title`)}
          </h2>
          <p className="mt-1 font-body text-sm leading-relaxed text-dark/50">
            {t(`onboarding.step${step}.description`)}
          </p>
        </div>
      </div>

      {/* ── Étape 1 : la marque. Seule étape qui écrit ici. ── */}
      {step === 1 && (
        <div className="mt-5 flex flex-col gap-4">
          <Input
            label={t('onboarding.step1.logo_label')}
            name="logoUrl"
            type="url"
            placeholder="https://…"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            helper={t('onboarding.step1.logo_helper')}
          />
          <div className="grid grid-cols-2 gap-4">
            <ColorField
              label={t('onboarding.step1.primary_label')}
              value={primary}
              onChange={setPrimary}
            />
            <ColorField
              label={t('onboarding.step1.secondary_label')}
              value={secondary}
              onChange={setSecondary}
            />
          </div>
          <Button onClick={handleSaveBrand} isLoading={savingBrand} className="w-full">
            <Check className="h-4 w-4" />
            {t('onboarding.step1.submit')}
          </Button>
        </div>
      )}

      {/* ── Étapes 2 à 5 : renvoi vers l'écran qui sait déjà faire. ── */}
      {step !== 1 && (
        <div className="mt-5 flex flex-col gap-3">
          {/* L'objectif est déjà atteint : on le DIT, plutôt que de proposer une action que
              le gérant vient de faire. Il ne reste qu'à confirmer. */}
          {satisfied[step] && (
            <div className="flex items-center gap-2 rounded-xl bg-accent-dim/10 px-4 py-2.5">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-accent-dim" />
              <p className="font-body text-sm font-semibold text-dark/70">
                {t('onboarding.objective_done')}
              </p>
            </div>
          )}
          <Button onClick={() => handleGo(STEP_TARGETS[step])} className="w-full">
            {t(`onboarding.step${step}.cta`)}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* ── Sorties : toujours les deux, à chaque étape. ── */}
      <div className="mt-5 flex items-center justify-between border-t border-[#E8E6E0] pt-4">
        <button
          type="button"
          onClick={dismiss}
          className="font-body text-sm text-dark/40 transition-colors hover:text-dark"
        >
          {t('onboarding.later')}
        </button>
        <button
          type="button"
          onClick={isLast ? handleFinish : handleAdvance}
          className="font-body text-sm font-semibold text-dark/60 transition-colors hover:text-dark"
        >
          {isLast ? t('onboarding.finish') : t('onboarding.skip')}
        </button>
      </div>
    </Shell>
  )
}

/**
 * Destination de chaque étape. L'étape 1 n'y figure pas : elle est traitée sur place.
 * Les onglets de Réglages sont amorçables par l'URL (GYM-247, `?tab=`) — les clés sont
 * celles de TABS dans pages/Settings.tsx, en anglais : 'activities', 'subscription'…
 * La politique d'absences vit dans l'onglet 'gym' (table noshow_rules, GYM-175).
 */
const STEP_TARGETS: Record<number, string> = {
  2: '/settings?tab=activities',
  3: '/settings?tab=coaches',
  4: '/planning',
  5: '/settings?tab=gym',
  6: '/members',
}

function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="mb-6 rounded-2xl border border-[#E8E6E0] bg-card p-5 shadow-sm">
      <div className="mb-1 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          aria-label={t('onboarding.later')}
          className="rounded-lg p-1 text-dark/30 transition-colors hover:bg-dark/5 hover:text-dark"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {children}
    </div>
  )
}

/**
 * Une limite du plan. ⚠️ `null` = ILLIMITÉ — c'est la convention de la grille
 * nexxia_plan_limits (GYM-245), pas une valeur manquante : on l'écrit en toutes lettres
 * plutôt que d'afficher un tiret qui se lirait comme « non renseigné ».
 */
function LimitRow({ label, value }: { label: string; value: number | null }) {
  const { t } = useTranslation()
  return (
    <li className="flex items-center justify-between rounded-xl bg-dark/[0.03] px-4 py-2.5">
      <span className="font-body text-sm text-dark/60">{label}</span>
      <span className="font-body text-sm font-bold text-dark">
        {value === null ? t('onboarding.welcome.unlimited') : value}
      </span>
    </li>
  )
}

function ColorField({ label, value, onChange }: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="font-body text-sm font-semibold text-dark">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 w-12 shrink-0 cursor-pointer rounded-lg border border-[#E8E6E0] bg-card p-1"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-xl border border-[#E8E6E0] bg-card px-3 py-2.5 font-mono text-sm text-dark outline-none transition-colors focus:border-dark"
        />
      </div>
    </div>
  )
}
