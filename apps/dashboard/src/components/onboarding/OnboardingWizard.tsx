// GYM-248 — Wizard d'onboarding, 5 étapes, monté sur le dashboard tant que
// `nexxia_gyms.onboarding_completed` est faux.
//
// PRINCIPES
//  · L'étape courante est la valeur DB `onboarding_step` (CHECK 1..5 en base) — pas un
//    compteur local. Le wizard reprend donc où le gérant s'était arrêté, y compris après
//    une reconnexion. (Sous réserve de la persistance : cf. lib/onboarding.ts.)
//  · CHAQUE étape est passable — SAUF LA SEPTIÈME. Un onboarding qui retient son
//    utilisateur en otage est un onboarding qu'on referme et qu'on ne rouvre jamais.
//    « Passer » avance sans rien faire, « plus tard » ferme le wizard SANS perdre l'étape.
//
//    🔴 GYM-363 — L'EXCEPTION, ET POURQUOI ELLE EST JUSTE. L'identité légale ne peut pas
//    être passée : une salle qui la saute TERMINE son installation et se croit prête,
//    alors que `create-payment` refusera toutes ses ventes. Mesuré le 28/09 : The Pulse Box
//    et Iner Studio, les deux seules salles créées en libre-service, ont leurs six champs
//    vides et l'ignorent. Passer cette étape, ce n'est pas remettre à plus tard, c'est
//    livrer une salle qui ne vend pas.
//    ⚠️ « Plus tard » RESTE, lui : le gérant peut fermer l'assistant et revenir. Ce qu'il
//    ne peut pas faire, c'est le TERMINER. La nuance est tout l'arbitrage.
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
import { useEffect, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  X, Check, ArrowRight, Palette, Dumbbell, UserCog, CalendarPlus, ShieldAlert, UserPlus,
  PartyPopper, Sparkles, CheckCircle2, Scale, ReceiptText,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
// GYM-285 — le champ couleur et la palette suggérée sont désormais PARTAGÉS avec la page
// Réglages → Apparence : une seule façon de dire « pas encore choisi ».
import { ColorField, VINIZ_PRIMARY, VINIZ_SECONDARY } from '@/components/ui/ColorField'
import { supabase } from '@/lib/supabase'
import { useGymStore } from '@/stores/useGymStore'
import { useToastStore } from '@/hooks/useToast'
import { useOnboarding } from '@/hooks/useOnboarding'
import { ONBOARDING_LAST_STEP, hasSeenWelcome, markWelcomeSeen } from '@/lib/onboarding'
import type { SaveOutcome } from '@/lib/onboarding'
import { useEffectivePlan } from '@/hooks/useEffectivePlan'
import { MediaUpload } from '@/components/ui/MediaUpload'
// 🔴 LES ÉTAPES 2 ET 3 NE FONT PLUS SORTIR DU DASHBOARD : leur modale s'ouvre ici même.
// Ce sont EXACTEMENT les composants de Réglages, avec les mêmes gestionnaires de création —
// aucune seconde version d'un formulaire qui existe déjà.
import { ActivityModal } from '@/components/settings/ActivityModal'
import { CoachModal } from '@/components/settings/CoachModal'
import { useActivities } from '@/hooks/useActivities'
import { useCoaches } from '@/hooks/useCoaches'
import { useGymSites } from '@/hooks/useGymSites'
import { proposerPaletteDepuisLogo } from '@/lib/logoColorsFromImage'
import type { PaletteProposee } from '@/lib/logoColors'
// 22/09 — l'encart qui dit l'essai SANS mentir sur le plan souscrit.
import { TrialPlanNotice } from '@/components/subscription/TrialPlanNotice'
// 🔴 GYM-363 — L'ÉTAPE 7 NE RÉÉCRIT NI FORMULAIRE, NI VALIDATION, NI RÈGLE :
//   · `useGymLegal`            — le MÊME hook que Réglages → Infos légales : même
//                                normalisation '' → NULL, même détection d'un UPDATE
//                                bloqué par RLS, même liste blanche de colonnes ;
//   · `LegalIdentityFields`    — les champs, avec les libellés `settings.legal.*` de
//                                l'onglet existant ;
//   · `useLegalIdentityStatus` — la règle, lue au SERVEUR (gym_legal_identity_missing),
//                                celle-là même dont le cockpit tire son indicateur.
import { useGymLegal, EMPTY_GYM_LEGAL, type GymLegal } from '@/hooks/useGymLegal'
import { useLegalIdentityStatus } from '@/hooks/useLegalIdentityStatus'
import { LegalIdentityFields } from '@/components/settings/LegalIdentityFields'
import { legalFieldLabelKey } from '@/lib/gymLegalIdentity'

const STEP_ICONS = [Palette, Dumbbell, UserCog, CalendarPlus, ShieldAlert, UserPlus, Scale] as const

export function OnboardingWizard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const gym = useGymStore((s) => s.gym)
  const addToast = useToastStore((s) => s.addToast)
  const { step, completed, isOpen, satisfied, refresh, dismiss, advance, complete } = useOnboarding()
  const { plan, effectivePlan, trialActive, limits } = useEffectivePlan()

  const [celebrating, setCelebrating] = useState(false)
  /**
   * Quelle modale de création est ouverte au-dessus du dashboard (2 = activité,
   * 3 = coach), ou `null`. ⚠️ ELLE N'AVANCE PAS L'ÉTAPE : à la fermeture on rejoue la
   * DÉTECTION, et c'est l'existence de l'objet qui fait franchir l'étape.
   */
  const [modale, setModale] = useState<2 | 3 | null>(null)

  const { activities, createActivity, slugify } = useActivities()
  const { createCoach } = useCoaches()
  const { siteNames } = useGymSites()
  // Même dérivation qu'en Réglages : seules les activités ACTIVES sont proposées à un coach.
  const activitesPourCoach = useMemo(
    () => activities.filter((a) => a.active).map((a) => ({ name: a.name, color: a.color })),
    [activities],
  )
  // Écran de bienvenue : lu une seule fois à l'initialisation (pas d'effet, donc pas de
  // rendu en cascade). `gym?.id` peut être null au premier rendu — on retombe alors sur
  // « déjà vu » et le calcul est refait dès que la salle arrive, via la clé du composant.
  const [welcomeDone, setWelcomeDone] = useState(false)

  // ── Étape 7 — identité légale (GYM-363) ──
  // Le formulaire est le GymLegal de Réglages, chargé par le MÊME hook. `legalStatus` dit
  // ce que le SERVEUR juge manquant ; on ne recalcule rien ici.
  const { legal, save: saveLegal } = useGymLegal()
  const legalStatus = useLegalIdentityStatus()
  const [legalForm, setLegalForm] = useState<GymLegal>(EMPTY_GYM_LEGAL)
  const [savingLegal, setSavingLegal] = useState(false)
  useEffect(() => { if (legal) setLegalForm(legal) }, [legal])

  // Étape 1 — marque de la salle.
  const [logoUrl, setLogoUrl] = useState('')
  // ── GYM-284 — CHAMPS VIDES, SUGGESTION VINIZ AFFICHÉE ───────────────────────────────
  //
  // 🔴 `null` VEUT DIRE « PAS ENCORE CHOISI », ET C'EST TOUT L'OBJET DU LOT. Le wizard
  // pré-remplissait #C8F000 / #111111 — le lime de Dopamine — exactement comme le DEFAULT
  // de la base, désormais passé à NULL. Corriger l'un sans l'autre n'aurait rien réglé :
  // le formulaire aurait continué d'ÉCRIRE ce que le schéma a cessé d'imposer.
  //
  // ⚠️ ET PRÉ-REMPLIR LA PALETTE VINIZ AURAIT REPRODUIT LE MÊME DÉFAUT D'UN CRAN. Une
  // valeur pré-remplie est enregistrée comme un CHOIX : la base ne distinguerait plus
  // « cette salle a choisi le lime Viniz » de « cette salle n'a rien décidé », et le repli
  // côté client — celui qui sait résoudre le contraste — ne s'appliquerait jamais.
  //
  // Un champ vide invite à choisir ; la pastille montre ce qu'on aura si l'on ne choisit
  // pas. On ne perd donc pas l'aperçu, on perd seulement le faux choix.
  const [primary, setPrimary] = useState<string | null>(null)
  const [secondary, setSecondary] = useState<string | null>(null)
  const [brandLoaded, setBrandLoaded] = useState(false)
  const [savingBrand, setSavingBrand] = useState(false)
  /**
   * La palette TIRÉE DU LOGO, en attente d'un geste. `null` = rien à proposer — logo
   * monochrome, image illisible, ou aucun couple ne passant le garde-fou de contraste.
   * ⚠️ ELLE N'EST JAMAIS APPLIQUÉE TOUTE SEULE : c'est la décision GYM-102, et tout ce
   * module la répète. Le gérant clique, ou rien ne change.
   */
  const [proposee, setProposee] = useState<PaletteProposee | null>(null)
  const [analyse, setAnalyse] = useState(false)

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

  /**
   * Le logo est persisté TOUT DE SUITE — contrat de `MediaUpload` : le fichier est déjà en
   * ligne à un chemin déterministe, et laisser la base sur l'ancienne URL servirait déjà la
   * NOUVELLE image sous un `?v=` périmé.
   *
   * Puis on analyse l'image. ⚠️ L'ANALYSE NE TOUCHE À AUCUNE COULEUR : elle remplit
   * `proposee`, et c'est le clic du gérant qui fait passer la proposition dans les champs.
   */
  async function handleLogoChange(url: string | null) {
    if (!gym?.id) return
    setLogoUrl(url ?? '')
    setProposee(null)
    const { error } = await supabase.from('nexxia_gyms').update({ logo_url: url }).eq('id', gym.id)
    if (error) { addToast(t('onboarding.save_error'), 'warning'); return }
    if (!url) return
    setAnalyse(true)
    const palette = await proposerPaletteDepuisLogo(url)
    setAnalyse(false)
    // `null` = rien de proposable (logo monochrome, image illisible, ou aucun couple ne
    // passant le garde-fou). On ne montre alors rien : proposer « à peu près » ferait
    // accepter au gérant des couleurs que son app ignorerait.
    setProposee(palette)
  }

  async function handleSaveBrand() {
    if (!gym?.id) return
    setSavingBrand(true)
    // logo_url / primary_color / secondary_color : liste blanche GYM-180, écriture RLS
    // directe comme GymSettingsCard. Pas d'upload de fichier — cf. la note de PR.
    // ⚠️ `logo_url` N'EST PLUS DANS CETTE ÉCRITURE. Il se persiste à l'envoi du fichier
    // (voir `handleLogoChange`), comme dans Réglages → Apparence : le réécrire ici
    // reposerait la valeur lue au chargement et ANNULERAIT un logo posé entre-temps.
    const { error } = await supabase
      .from('nexxia_gyms')
      .update({
        // `null` traverse jusqu'en base : c'est la valeur qui dit « pas encore choisi ».
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

  function setLegalField<K extends keyof GymLegal>(key: K, value: GymLegal[K]) {
    setLegalForm((f) => ({ ...f, [key]: value }))
  }

  /**
   * 🔴 ON ENREGISTRE, PUIS ON REDEMANDE AU SERVEUR. On n'avance JAMAIS parce que le
   * formulaire a l'air rempli : c'est `gym_legal_identity_missing` qui tranche, comme pour
   * le cockpit. Un champ rempli d'espaces, une écriture refusée par RLS, une règle qui
   * gagne un septième champ — les trois se voient ici et nulle part ailleurs.
   *
   * ⚠️ C'est la MÊME discipline que les étapes 2 à 6 : l'étape se franchit parce que la
   * CHOSE EXISTE, jamais parce qu'on a cliqué.
   */
  async function handleSaveLegal() {
    setSavingLegal(true)
    const result = await saveLegal(legalForm)
    if (result.error) {
      setSavingLegal(false)
      addToast(
        t(result.error === 'forbidden' ? 'settings.legal.save_forbidden' : 'settings.legal.save_error'),
        'warning',
      )
      return
    }
    const restants = await legalStatus.refresh()
    setSavingLegal(false)
    if (restants !== null && restants.length === 0) {
      addToast(t('onboarding.step7.saved'))
      await handleFinish()
      return
    }
    // Enregistré, mais le serveur veut encore quelque chose : on le DIT, on ne referme pas.
    addToast(t('onboarding.step7.still_missing'), 'warning')
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
            {/* 🔴 22/09 — LE SOUS-TITRE NE NOMME PLUS LE PLAN PENDANT UN ESSAI.
                Il disait « Tu es sur le plan Free — voici ce qu'il comprend », juste
                au-dessus des limites du plan PRO servies par l'essai. Les deux étaient
                exacts séparément, et faux ensemble. Pendant un essai, c'est
                `TrialPlanNotice` qui parle — lui sait dire les deux plans. */}
            <p className="mt-1 font-body text-sm leading-relaxed text-dark/50">
              {trialActive && plan !== effectivePlan
                ? t('onboarding.welcome.subtitle_neutral')
                : t('onboarding.welcome.subtitle', {
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
        {/* PENDANT UN ESSAI : l'encart qui dit l'offre, puis la retombée datée. La liste
            brute des limites ne suffit pas — elle ne dit pas à quel plan elles
            appartiennent, et c'est très exactement le défaut du 22/09. */}
        {trialActive && plan !== effectivePlan ? (
          <div className="mt-5">
            <TrialPlanNotice variant="welcome" />
          </div>
        ) : limits ? (
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
          {/* ═══════════════════════════════════════════════════════════════════════════
              🔴 GYM-308 — LE TAUX DE TVA EST MONTRÉ, PAS SUBI.
              ═══════════════════════════════════════════════════════════════════════════
              La RPC de création pose désormais 6,00 % explicitement (migration
              20260829100000). Le poser sans le dire reviendrait à choisir le régime fiscal
              du gérant à sa place : il découvrirait le taux sur sa première facture, ou
              pire, ne le découvrirait pas.

              ⚠️ AFFICHÉ, NON ÉDITABLE ICI, ET C'EST DÉLIBÉRÉ. L'onboarding sert à démarrer
              en six étapes ; y glisser un champ fiscal inviterait à trancher vite une
              question qui demande un comptable. Le bloc dit la valeur, dit qu'elle se
              corrige, et dit où — Réglages → Informations légales, où le champ existe avec
              ses bornes et sa validation.

              ⚠️ VALEUR EN DUR DANS LE LIBELLÉ, alignée sur la RPC. C'est une CONSTANTE de
              marché (le taux belge des installations sportives), pas une donnée de salle :
              la lire en base ici demanderait une requête de plus pour afficher un nombre
              que la migration vient d'écrire. Si la RPC change, ce libellé change avec
              elle — les deux portent le même numéro de ticket. */}
          <div className="rounded-xl border border-[#E8E6E0] bg-[#F5F4F0] px-4 py-3">
            <p className="font-body text-sm font-semibold text-dark">
              {t('onboarding.step1.vat_title')}
            </p>
            <p className="mt-1 font-body text-xs text-dark/50">
              {t('onboarding.step1.vat_helper')}
            </p>
          </div>
          {/* ═══════════════════════════════════════════════════════════════════════════
              🔴 L'URL EST REMPLACÉE PAR UN TÉLÉVERSEMENT.
              ═══════════════════════════════════════════════════════════════════════════
              « Colle l'URL d'une image déjà en ligne » demandait au gérant d'héberger son
              logo quelque part AVANT de pouvoir le poser — c'est-à-dire de résoudre un
              problème d'informaticien à la première étape de sa configuration.

              ⚠️ `MediaUpload` (GYM-305/215) FAIT DÉJÀ TOUT : clic, glisser-déposer,
              contraintes du bucket dites avant l'envoi, chemin déterministe
              `{gym_id}/logo.{ext}`, nettoyage des frères d'extension, `?v=` anti-cache.
              C'est le MÊME composant que Réglages → Apparence — le wizard était le seul
              écran à ne pas l'utiliser. */}
          <MediaUpload
            label={t('onboarding.step1.logo_label')}
            value={logoUrl}
            path={`${gym?.id}/logo`}
            recommendation={t('onboarding.step1.logo_reco')}
            disabled={!gym?.id}
            onChange={handleLogoChange}
          />

          {/* ── LA PALETTE TIRÉE DU LOGO — PROPOSÉE, JAMAIS POSÉE ────────────────────
              ⚠️ Aucune couleur ne part en base sans ce clic. `null` reste `null` tant que
              le gérant n'a rien décidé (GYM-102, à ne jamais défaire). */}
          {analyse && (
            <p className="font-body text-xs text-muted">{t('onboarding.step1.colors_scanning')}</p>
          )}
          {proposee && (
            <div className="rounded-xl border border-[#E8E6E0] bg-[#F5F4F0] px-4 py-3">
              <p className="font-body text-sm font-semibold text-dark">
                {t('onboarding.step1.colors_found')}
              </p>
              <div className="mt-3 flex items-center gap-3">
                <span className="h-8 w-8 rounded-lg border border-black/10" style={{ backgroundColor: proposee.primary }} />
                <span className="h-8 w-8 rounded-lg border border-black/10" style={{ backgroundColor: proposee.secondary }} />
                <button
                  type="button"
                  onClick={() => { setPrimary(proposee.primary); setSecondary(proposee.secondary) }}
                  className="ml-auto rounded-xl bg-dark px-4 py-2 font-ui text-xs font-bold text-light transition-opacity hover:opacity-90"
                >
                  {t('onboarding.step1.colors_use')}
                </button>
              </div>
              <p className="mt-2 font-body text-xs text-dark/50">
                {t('onboarding.step1.colors_hint')}
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <ColorField
              label={t('onboarding.step1.primary_label')}
              value={primary}
              suggestion={VINIZ_PRIMARY}
              hint={t('onboarding.step1.color_hint')}
              onChange={setPrimary}
            />
            <ColorField
              label={t('onboarding.step1.secondary_label')}
              value={secondary}
              suggestion={VINIZ_SECONDARY}
              hint={t('onboarding.step1.color_hint')}
              onChange={setSecondary}
            />
          </div>
          <Button onClick={handleSaveBrand} isLoading={savingBrand} className="w-full">
            <Check className="h-4 w-4" />
            {t('onboarding.step1.submit')}
          </Button>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════════
          🔴 ÉTAPE 7 — L'IDENTITÉ LÉGALE. LA SEULE QU'ON NE PEUT PAS PASSER.
          ══════════════════════════════════════════════════════════════════════════════
          Elle est SUR PLACE, comme l'étape 1 : renvoyer vers Réglages pour six champs
          coûterait un aller, un retour, et l'occasion d'abandonner — et c'est déjà le
          défaut qu'on corrige, puisque l'onglet existe et que personne n'y va.

          ⚠️ MAIS ELLE N'EST PAS UNE COPIE DE CET ONGLET : mêmes champs, mêmes libellés,
          même hook d'écriture, même règle serveur. Ce qui change, c'est le CADRE — ici on
          ne montre que ce qui est exigé, et on dit pourquoi. */}
      {step === 7 && (
        <div className="mt-5 flex flex-col gap-4">
          {/* ── LE POURQUOI, AVANT LE REFUS ──────────────────────────────────────────
              🔴 « Champs obligatoires » n'explique rien et se subit. Ce bloc dit ce que
              ces informations DEVIENNENT : le bloc émetteur des factures que ses membres
              recevront, et la condition pour encaisser. Un gérant qui comprend remplit ;
              un gérant qui subit s'en va. */}
          <div className="rounded-xl border border-[#E8E6E0] bg-[#F5F4F0] px-4 py-3">
            <div className="flex items-start gap-2.5">
              <ReceiptText className="mt-0.5 h-4 w-4 shrink-0 text-accent-dim" />
              <div>
                <p className="font-body text-sm font-semibold text-dark">
                  {t('onboarding.step7.why_title')}
                </p>
                <p className="mt-1 font-body text-xs leading-5 text-dark/60">
                  {t('onboarding.step7.why_body')}
                </p>
              </div>
            </div>
          </div>

          {/* Ce que le SERVEUR attend encore. ⚠️ `missing === null` = on ne sait pas
              encore : on n'affiche alors ni « c'est bon », ni la liste. Annoncer l'un ou
              l'autre sans savoir serait pire que de se taire. */}
          {legalStatus.complete && (
            <div className="flex items-center gap-2 rounded-xl bg-accent-dim/10 px-4 py-2.5">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-accent-dim" />
              <p className="font-body text-sm font-semibold text-dark/70">
                {t('onboarding.step7.complete')}
              </p>
            </div>
          )}
          {legalStatus.missing !== null && legalStatus.missing.length > 0 && (
            <p className="font-body text-xs font-medium text-amber-900">
              {t('onboarding.step7.missing', {
                // 🔴 GYM-363b — DES MOTS, PAS DES NOMS DE COLONNES. La liste affichait
                // « legal_name, vat_number, … » : la source de vérité reste la fonction
                // SQL, c'est l'AFFICHAGE qui traduit, via la table partagée par les trois
                // écrans qui posent la même question.
                fields: legalStatus.missing
                  .map((f) => t(legalFieldLabelKey(f), { defaultValue: f }))
                  .join(', '),
              })}
            </p>
          )}

          <LegalIdentityFields form={legalForm} set={setLegalField} missing={legalStatus.missing} />

          <Button onClick={handleSaveLegal} isLoading={savingLegal} className="w-full">
            <Check className="h-4 w-4" />
            {t('onboarding.step7.submit')}
          </Button>

          {/* Où retrouver ces champs ensuite — pour que la saisie ne ressemble pas à une
              porte à sens unique. Le gérant change son numéro de TVA quand il veut, sans
              nous. */}
          <p className="font-body text-xs text-dark/40">{t('onboarding.step7.editable_later')}</p>
        </div>
      )}

      {/* ── Étapes 2 à 6 : renvoi vers l'écran qui sait déjà faire. ── */}
      {step !== 1 && step !== 7 && (
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
          {/* ═══════════════════════════════════════════════════════════════════════════
              ② LES ÉTAPES 2 ET 3 NE QUITTENT PLUS LE FIL.
              ═══════════════════════════════════════════════════════════════════════════
              Une activité et un coach sont des FORMULAIRES : les envoyer chercher dans
              Réglages coûtait un aller, un retour, et l'occasion d'abandonner entre les
              deux. Leur modale s'ouvre ici, au-dessus du dashboard.

              Les étapes 4 à 6 — planning, politique d'absences, membres — restent des
              navigations : ce sont de vrais écrans, et les enfermer dans une modale serait
              pire que le voyage. Elles ont le bandeau de retour à la place. */}
          <Button
            onClick={() => (step === 2 || step === 3 ? setModale(step) : handleGo(STEP_TARGETS[step]))}
            className="w-full"
          >
            {t(`onboarding.step${step}.cta`)}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* ── Les deux modales de création, montées ICI ─────────────────────────────
          ⚠️ APRÈS LA CRÉATION, ON REJOUE LA DÉTECTION — jamais `advance()`. Tant que les
          étapes 2 et 3 faisaient quitter le dashboard, le wizard se démontait et la
          détection repartait toute seule au retour ; elle ne repart plus, puisqu'on ne
          part plus. `refresh()` remplace ce que la navigation faisait gratuitement. */}
      <ActivityModal
        open={modale === 2}
        onClose={() => setModale(null)}
        onSubmit={async (data) => {
          const res = await createActivity(data)
          if (res?.error) { addToast(t('onboarding.save_error'), 'warning'); return }
          setModale(null)
          await refresh()
        }}
        slugify={slugify}
      />
      <CoachModal
        open={modale === 3}
        onClose={() => setModale(null)}
        onSubmit={async (data) => {
          await createCoach(data)
          setModale(null)
          await refresh()
        }}
        availableActivities={activitesPourCoach}
        availableSites={siteNames}
      />

      {/* ── Sorties : toujours les deux, à chaque étape. ── */}
      <div className="mt-5 flex items-center justify-between border-t border-[#E8E6E0] pt-4">
        <button
          type="button"
          onClick={dismiss}
          className="font-body text-sm text-dark/40 transition-colors hover:text-dark"
        >
          {t('onboarding.later')}
        </button>
        {/* 🔴 GYM-363 — PAS DE « PASSER » NI DE « TERMINER » À L'ÉTAPE 7, et c'est la
            seule exception du wizard. Terminer sans identité légale livrerait une salle
            qui se croit prête et dont toutes les ventes seront refusées. Le bouton
            d'enregistrement de l'étape est la SEULE sortie par l'avant ; « plus tard »,
            à gauche, reste ouvert — on ne prend personne en otage, on refuse seulement
            de déclarer terminé ce qui ne l'est pas. */}
        {step !== 7 ? (
          <button
            type="button"
            onClick={isLast ? handleFinish : handleAdvance}
            className="font-body text-sm font-semibold text-dark/60 transition-colors hover:text-dark"
          >
            {isLast ? t('onboarding.finish') : t('onboarding.skip')}
          </button>
        ) : (
          <span className="font-body text-xs text-dark/30">{t('onboarding.step7.required_hint')}</span>
        )}
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
  // ⚠️ 2 ET 3 N'Y SONT PLUS : leur modale s'ouvre sur le dashboard (cf. le CTA). Les
  // laisser ici aurait laissé deux chemins vers la même création, dont un mort.
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

