// GYM-63 — Bottom sheet quand un membre tente de réserver sans abonnement ni crédit.
// GYM-76 — Migré sur gym_plans : plus de prix/codes en dur, create-payment v24 (plan_id UUID).
// L'auto-retry après paiement drop-in est géré par app/payment/success.tsx (GYM-63b)
// via le deep link dopamine://payment/success?slot_id=...&source=drop_in.
import { useState, useEffect, useRef, useCallback } from 'react'
import { View, Text, TouchableOpacity, Modal, Alert, ActivityIndicator, AppState } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { CreditCard, Calendar, Ticket } from 'lucide-react-native'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { SEMANTIC } from '../../lib/theme/semantic'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/useAuthStore'
// GYM-352 — MÊME prédicat que le résumé du profil : un abonnement « actif » se juge sur le
// statut ET sur le terme. Le redéfinir ici en ferait une seconde vérité.
import { ACTIVE_SUBSCRIPTION_STATUSES, isSubscriptionActive } from '../../lib/subscription'
import { useGymPlans } from '../../hooks/useGymPlans'
import { PurchaseConsentBody } from '../payments/PurchaseConsentSheet'
import { attacherPaiementBookingIntent } from '../../lib/bookingIntent'
import { lireStatutPaiement } from '../../lib/paymentLookup'
import { issueAuPremierPlan, issueFinAttente } from '../../lib/paymentStatus'
import {
  formatPrice,
  mapPaymentError,
  openCheckout,
  startOneTimeCheckout,
  buildRedirectUrl,
} from '../../lib/payments'

interface PaymentRequiredSheetProps {
  visible: boolean
  slotId: string | null
  onClose: () => void
  // GYM-108 — 'waitlist' quand le créneau est plein : le 402 vient d'une tentative de
  // « rejoindre la liste d'attente » sans crédit/abo. Adapte le titre/sous-titre, mêmes CTA.
  context?: 'book' | 'waitlist'
  /**
   * 🔴 GYM-379 (relecture) — le paiement que le membre avait déjà lancé pour ce cours, quand
   * il rouvre la feuille. Tant qu'il n'est pas MORT (failed / canceled / expired), la feuille
   * ne propose AUCUN nouveau paiement : elle propose de reprendre celui-là.
   */
  paiementPrecedent?: { paymentId: string; checkoutUrl?: string; accord: boolean } | null
}

export function PaymentRequiredSheet({ visible, slotId, onClose, context = 'book', paiementPrecedent = null }: PaymentRequiredSheetProps) {
  const { t } = useTranslation()
  const { tokens } = useTheme()
  const router = useRouter()
  const gymId = useAuthStore((s) => s.gym_id)
  const memberId = useAuthStore((s) => s.user?.id)
  const { creditPlans, unlimitedPlans, loading: plansLoading, refetch } = useGymPlans()
  const [isLoadingDropIn, setIsLoadingDropIn] = useState(false)
  const [dropInError, setDropInError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // 🔴 GYM-379 — DRAPEAU D'ANNULATION, VÉRIFIÉ À CHAQUE TOUR. `clearInterval` n'arrête pas un
  // tour DÉJÀ PARTI : ses deux requêtes sont en vol, et à leur retour il appellerait
  // `onClose` ou poserait un message sur une feuille que le membre a quittée. Le drapeau
  // est relu après chaque `await`. Un `ref`, pas un état : il doit être vrai IMMÉDIATEMENT.
  const annuleRef = useRef(false)
  // L'id Mollie du checkout en cours, pour relire son statut au retour au premier plan.
  const paymentIdRef = useRef<string | null>(null)
  // GYM-379 (compléments du 09/11) — l'URL du MÊME checkout, pour « Reprendre le paiement »
  // sans créer de second paiement.
  const checkoutUrlRef = useRef<string | null>(null)
  // GYM-379 (relecture) — le paiement en cours porte-t-il l'ACCORD du membre (« Payer et
  // réserver ») ? C'est la seule condition sous laquelle un texte annonce une réservation
  // automatique. Sur un cours complet (`waitlist`), ou pour un paiement repris d'ailleurs
  // sans accord, les textes disent « confirme ta réservation sur la fiche du cours ».
  // ⚠️ UN `ref` : la boucle (`setInterval`) le relit à son dernier tour, longtemps après.
  const accordRef = useRef(false)
  // 🔴 GYM-379 (relecture) — L'ÉCOUTE DU RETOUR EST POSÉE AVANT `openCheckout`. Posée après
  // (quand l'étape `waiting` s'affichait), elle ratait sur Android l'événement `active`
  // parti pendant que le JS reprenait : le membre revenait sur une attente muette.
  const retourRef = useRef<{ remove: () => void } | null>(null)
  // GYM-336 — la feuille a désormais DEUX ÉTAPES. Le drop-in est un achat à distance : il
  // doit recueillir la demande d'exécution anticipée comme n'importe quel autre.
  //
  // ⚠️ UNE ÉTAPE, PAS UNE SECONDE MODALE. Ce composant EST déjà un `Modal` ; en empiler un
  // second n'est pratiqué nulle part dans l'app et ses défauts de dismiss sur iOS ne se
  // voient qu'à l'exécution — or l'app est gelée pour la QA. Le CONSENTEMENT, lui, reste
  // partagé : `PurchaseConsentBody` est le même composant que celui de la feuille montée
  // par profile/subscription.tsx, donc la même phrase, le même verrou, la même version.
  //
  // 🔴 GYM-379 — ET UNE TROISIÈME : `waiting`. Le membre restait sur l'étape de consentement,
  // spinner sur « Confirmer et payer » ET « Annuler » désactivé, pendant TOUTE la boucle de
  // vérification — jusqu'à 5 minutes, sans sortie. Deux états distincts désormais :
  //   · `isLoadingDropIn` (busy) — CRÉATION du paiement : quelques centaines de ms, les
  //     boutons du consentement sont verrouillés (un second tap créerait un second paiement) ;
  //   · `waiting` — le paiement est OUVERT DANS LE NAVIGATEUR : on attend le membre, pas le
  //     serveur. « Annuler » n'y est JAMAIS désactivé.
  //
  // 🔴 ET UNE QUATRIÈME (09/11) : `unfinished`, « Paiement non finalisé ? ». Mesuré en
  // staging : « Canceled » chez la banque n'envoie AUCUN webhook, le paiement reste `open`
  // ~17 min. Au retour, le statut seul ne dit donc pas « annulé » : on POSE LA QUESTION, et
  // la vérification du droit continue derrière.
  //
  // ET `verification` : la feuille rouvre sur un paiement précédent, dont on relit le statut
  // AVANT de montrer quoi que ce soit — les options n'apparaissent que s'il est mort.
  //
  // 🔴 GYM-379 (passe finale) — ET `illisible` : « Impossible de vérifier ton paiement »
  // (Réessayer / Annuler). Une lecture ratée (hors ligne, ligne introuvable) menait à
  // « non finalisé », donc à « Reprendre » — rouvrir un checkout dont on ne savait rien.
  const [step, setStep] = useState<'options' | 'consent' | 'waiting' | 'unfinished' | 'verification' | 'illisible'>('options')

  // Plans dérivés de gym_plans (fini les prix en dur)
  const dropInPlan = creditPlans
    .filter((p) => p.creditCount === 1)
    .sort((a, b) => a.priceCents - b.priceCents)[0] ?? null
  const packPlan = creditPlans
    .filter((p) => (p.creditCount ?? 0) > 1)
    .sort((a, b) => a.priceCents - b.priceCents)[0] ?? null
  // GYM-189 — le libellé associé est « À partir de {prix}/mois » : on ne retient donc que
  // les abonnements réellement PRÉLEVÉS MENSUELLEMENT. Un « Illimité 12 mois — paiement
  // unique » (1000 € au total) est bien un plan unlimited, mais annoncer « à partir de
  // 1000 €/mois » serait faux. Filtre sur le mode de paiement, à dessein.
  const monthlyPlans = unlimitedPlans.filter((p) => p.billingType !== 'one_time')
  const cheapestRecurring = monthlyPlans.length
    ? [...monthlyPlans].sort((a, b) => a.priceCents - b.priceCents)[0]
    : null

  // GYM-379 — arrête la boucle, et tout tour encore en vol (cf. `annuleRef`).
  const arreterAttente = useCallback(() => {
    annuleRef.current = true
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    retourRef.current?.remove()
    retourRef.current = null
  }, [])

  useEffect(() => arreterAttente, [arreterAttente])

  // 🔴 GYM-379 — « ANNULER » ET LE RETOUR ANDROID FERMENT LA FEUILLE, BOUCLE ARRÊTÉE.
  // ⚠️ L'INTENTION DE RÉSERVATION N'EST PAS EFFACÉE, ET C'EST VOULU. Le membre a peut-être
  // payé quand même, dans le navigateur, juste avant d'annuler ici : l'intention porte le
  // paymentId, et c'est elle qui permet à `app/payment/success.tsx` (GYM-373) et à la fiche
  // du cours (GYM-374b) de décider sur le statut RÉEL. L'effacer ici, c'est perdre le cours
  // d'un membre qui a payé.
  const fermer = useCallback(() => {
    arreterAttente()
    setIsLoadingDropIn(false)
    onClose()
  }, [arreterAttente, onClose])

  // GYM-379 — CE QUE DIT LE STATUT DU PAIEMENT, LU EN BASE (`issueAuPremierPlan`) :
  //   · échec TERMINAL (expiré, refusé) → plus rien à attendre, retour aux options ;
  //   · `open`/`pending` → « Paiement non finalisé ? » : reprendre le MÊME checkout, ou
  //     annuler. La boucle de vérification continue derrière ;
  //   · `paid`/inconnu → on attend : c'est la boucle qui voit le droit et rend la main.
  const verifierStatut = useCallback(() => {
    const paymentId = paymentIdRef.current
    if (!paymentId) return
    void lireStatutPaiement(paymentId).then((statut) => {
      if (annuleRef.current) return
      const issue = issueAuPremierPlan(statut)
      if (issue === 'abandonner') {
        arreterAttente()
        setStep('options')
        setDropInError(t('payment_required.errors.payment_not_completed'))
        return
      }
      if (issue === 'proposer_reprise') { setStep('unfinished'); return }
      // `paid` lu pendant la question : on repasse à l'attente, la boucle verra le droit.
      if (statut === 'paid') setStep((e) => (e === 'unfinished' ? 'waiting' : e))
    })
  }, [arreterAttente, t])

  // 🔴 GYM-379 (relecture) — POSÉE AVANT D'OUVRIR MOLLIE, retirée par `arreterAttente`.
  const ecouterLeRetour = useCallback(() => {
    retourRef.current?.remove()
    retourRef.current = AppState.addEventListener('change', (etat) => {
      if (etat === 'active') verifierStatut()
    })
  }, [verifierStatut])

  // ⚠️ RETOUR À L'ÉTAPE DES OPTIONS À CHAQUE OUVERTURE — SAUF PAIEMENT PRÉCÉDENT VIVANT.
  // Sans cela, un membre qui ferme la feuille sur l'étape de consentement la rouvrirait
  // dessus, sans avoir rechoisi son achat. (La case elle-même se remet à zéro dans
  // PurchaseConsentBody, qui est démonté avec l'étape — les deux garanties sont
  // indépendantes, et c'est voulu.)
  //
  // 🔴 GYM-379 (relecture) — JAMAIS « PAYER CETTE SÉANCE » TANT QUE LE PRÉCÉDENT EST `open`.
  // La feuille rouvre sur `verification`, relit le statut, et ne montre les options que
  // s'il est mort (`issueFinAttente`). `open` → « non finalisé » ; `paid` → l'attente.
  useEffect(() => {
    if (!visible) {
      // GYM-379 — fermée par le parent (crédit détecté → `onClose`) ou par le membre : plus
      // aucune boucle ne doit tourner derrière une feuille invisible.
      arreterAttente()
      return
    }
    setDropInError(null)
    // Le paiement de CETTE feuille d'abord (elle est restée montée), sinon celui de la fiche.
    if (!paymentIdRef.current && paiementPrecedent) {
      paymentIdRef.current = paiementPrecedent.paymentId
      checkoutUrlRef.current = paiementPrecedent.checkoutUrl ?? null
      accordRef.current = paiementPrecedent.accord
    }
    if (!paymentIdRef.current) { setStep('options'); return }
    const lecture = { vivant: true }
    relireEtOrienterRef.current?.(lecture)
    return () => { lecture.vivant = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, arreterAttente])

  // GYM-94 QA — les CTA abonnement/carnet ouvrent la page des FORMULES, pas l'historique.
  // GYM-379 (09/11) — DEPUIS UN COURS, l'écran des formules le SAIT (`depuis_cours`) : il
  // annonce la réservation et ses boutons deviennent « S'abonner et réserver » / « Acheter et
  // réserver ». Sur un cours COMPLET, pas de paramètre : rien ne se réserve d'office.
  const goToSubscription = () => {
    onClose()
    router.push(context === 'book' && slotId
      ? { pathname: '/profile/subscription', params: { depuis_cours: slotId } }
      : '/profile/subscription')
  }

  // GYM-336 — les gardes restent AVANT la case : faire cocher un consentement pour un
  // achat qui échouerait de toute façon serait lui faire signer dans le vide.
  const handleDropIn = () => {
    if (!gymId || !slotId || !memberId) {
      Alert.alert(t('common.error'), t('payment_required.errors.no_gym'))
      return
    }
    if (!dropInPlan) {
      Alert.alert(t('common.error'), t('payment_required.errors.no_plan'))
      return
    }
    setDropInError(null)
    setStep('consent')
  }

  // GYM-379 — LA BOUCLE DE VÉRIFICATION DU DROIT, extraite pour être RELANCÉE par « Reprendre
  // le paiement » : la reprise rouvre une attente complète de 5 minutes, pas le reliquat.
  const lancerVerification = () => {
    if (!gymId || !memberId) return
    const MAX_TENTATIVES = 150 // 150 × 2 s = 5 min
    let pollAttempts = 0
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      if (annuleRef.current) return
      pollAttempts++
      // GYM-352 — ON INTERROGE LE DROIT, PAS LE CRÉDIT. Cette requête ne regardait que
      // `member_credits` : un ABONNEMENT acheté depuis cette feuille n'y apparaît jamais,
      // et le membre restait devant un spinner jusqu'au bout. Le serveur, lui, autorise
      // les deux à l'identique (`create-booking` : `!activeSubscription && !creditsAvailable`).
      const { data: credits } = await supabase
        .from('member_credits')
        .select('credits_remaining')
        .eq('member_id', memberId)
        .eq('gym_id', gymId)
        .gt('credits_remaining', 0)
      const { data: sub } = await supabase
        .from('member_subscriptions')
        .select('status, ends_at')
        .eq('member_id', memberId)
        .eq('gym_id', gymId)
        .in('status', ACTIVE_SUBSCRIPTION_STATUSES)
        .order('starts_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      // GYM-379 — annulée pendant que les requêtes étaient en vol.
      if (annuleRef.current) return

      const aDesCredits = !!credits && credits.length > 0
      const aUnAbonnement = !!sub && isSubscriptionActive(sub.status, sub.ends_at)

      if (aDesCredits || aUnAbonnement) {
        clearInterval(pollRef.current!)
        pollRef.current = null
        setIsLoadingDropIn(false)
        // Le droit est là : ce paiement a rempli son office. Une prochaine ouverture de la
        // feuille ne doit pas le relire comme « précédent » et bloquer un nouvel achat.
        paymentIdRef.current = null
        checkoutUrlRef.current = null
        retourRef.current?.remove()
        retourRef.current = null
        // On rend la main à la fiche du cours : c'est ELLE, et elle seule, qui réserve
        // (lib/reservationAuto.ts — décision produit du 09/11, « Payer et réserver »,
        // qui revient sur la « réservation explicite » de GYM-352). Un seul endroit
        // décide, quel que soit le chemin de retour — poll, lien profond ou réouverture.
        onClose()
        return
      }
      if (pollAttempts >= MAX_TENTATIVES) {
        clearInterval(pollRef.current!)
        pollRef.current = null
        setIsLoadingDropIn(false)
        // 🔴 GYM-379 (relecture) — LA FIN DU PLAFOND NE ROUVRE PLUS LES OPTIONS D'OFFICE.
        // Elle rendait « Payer cette séance » à un membre dont le paiement était encore
        // `open` — peut-être passé, webhook en retard. On relit le statut d'abord :
        //   · mort → les options, un nouveau paiement est possible ;
        //   · `open`/`pending` → on reste sur « non finalisé » (Reprendre / Annuler) ;
        //   · illisible → « Impossible de vérifier ton paiement » (Réessayer / Annuler) ;
        //   · `paid` → le crédit tarde : on le dit, et rien n'est proposé à payer.
        const paymentId = paymentIdRef.current
        const statut = paymentId ? await lireStatutPaiement(paymentId) : null
        if (annuleRef.current) return
        const issue = issueFinAttente(statut)
        if (issue === 'options') {
          setStep('options')
          setDropInError(t('payment_required.errors.payment_not_completed'))
          return
        }
        if (issue === 'paye') {
          setStep('waiting')
          setDropInError(t(accordRef.current ? 'payment_required.errors.not_confirmed' : 'payment_required.errors.not_confirmed_manual'))
          return
        }
        // GYM-379 (passe finale) — illisible : on ne propose pas de reprendre l'inconnu.
        setStep(issue === 'illisible' ? 'illisible' : 'unfinished')
      }
    }, 2000)
  }
  // GYM-379 — RELIT LE STATUT DU PAIEMENT PRÉCÉDENT ET ORIENTE LA FEUILLE (`issueFinAttente`).
  // Appelée à l'ouverture sur un paiement précédent, et par « Réessayer » sur `illisible`.
  //   · mort → les options, un nouveau paiement est possible ;
  //   · `open`/`pending` → « non finalisé » (Reprendre / Annuler), vérification relancée ;
  //   · `paid` → l'attente : le droit arrive, la fiche réservera ;
  //   · illisible → « Impossible de vérifier ton paiement ». Ni payer, ni reprendre.
  const relireEtOrienter = (lecture: { vivant: boolean } = { vivant: true }) => {
    const paymentId = paymentIdRef.current
    if (!paymentId) { setStep('options'); return }
    setDropInError(null)
    setStep('verification')
    void lireStatutPaiement(paymentId).then((statut) => {
      if (!lecture.vivant) return
      const issue = issueFinAttente(statut)
      if (issue === 'options') {
        paymentIdRef.current = null
        checkoutUrlRef.current = null
        setStep('options')
        return
      }
      if (issue === 'illisible') { setStep('illisible'); return }
      annuleRef.current = false
      setStep(issue === 'paye' ? 'waiting' : 'unfinished')
      lancerVerification()
    })
  }
  // Le `useEffect` d'ouverture est déclaré plus haut : il appelle la version courante.
  const relireEtOrienterRef = useRef<((lecture?: { vivant: boolean }) => void) | null>(null)
  relireEtOrienterRef.current = relireEtOrienter

  // Appelé UNIQUEMENT depuis PurchaseConsentBody, dont le CTA est verrouillé tant que la
  // case est vide : `earlyPerformanceConsent: true` transcrit un geste réel du membre.
  const runDropIn = async () => {
    if (!gymId || !slotId || !memberId || !dropInPlan) return
    annuleRef.current = false
    paymentIdRef.current = null
    checkoutUrlRef.current = null
    accordRef.current = context === 'book'
    setIsLoadingDropIn(true)
    setDropInError(null)
    try {
      const result = await startOneTimeCheckout(dropInPlan.id, {
        gymId,
        // GYM-352 — `slotId` voyage dans l'URL de retour : second signal, indépendant de
        // l'intention sur disque. Sans lui, `app/payment/success.tsx` ne montait jamais son
        // écran de reprise, dont la condition exige `slot_id`.
        redirectUrl: await buildRedirectUrl('drop_in', slotId),
        earlyPerformanceConsent: true,
      })

      if (!result.ok) {
        const info = mapPaymentError(result.code)
        if (info.refetch) refetch()
        setIsLoadingDropIn(false)
        // Retour aux options : l'échec porte sur l'achat, pas sur le consentement, et
        // laisser le membre sur une case déjà cochée lui ferait croire qu'il doit la
        // recocher pour réessayer.
        setStep('options')
        Alert.alert(t('common.error'), t(info.messageKey))
        return
      }

      // 🔴 GYM-374 — LE PAIEMENT EST RATTACHÉ À L'INTENTION AVANT QUE LE MEMBRE PARTE.
      // `await` : quelques millisecondes de disque, et la garantie qu'au retour la fiche du
      // cours sait QUEL paiement interroger — sans lui, elle ne peut que deviner.
      // GYM-379 — et l'ACCORD du membre : il vient de taper « Payer et réserver ». Sur un
      // cours complet (`waitlist`), le CTA ne promet pas de réservation : pas d'accord.
      // ⚠️ ET L'URL DU CHECKOUT : « Reprendre le paiement » doit pouvoir rouvrir CE paiement
      // même après que l'app a été tuée — sinon la seule reprise serait un second paiement.
      await attacherPaiementBookingIntent(result.paymentId, {
        accordReservation: context === 'book',
        checkoutUrl: result.checkoutUrl,
      })
      paymentIdRef.current = result.paymentId ?? null
      checkoutUrlRef.current = result.checkoutUrl

      // GYM-379 — fermée pendant la création (retour Android) : on n'ouvre pas Mollie
      // derrière le dos du membre. Le paiement créé reste `open` et expirera de lui-même.
      if (annuleRef.current) return

      // ╔═══════════════════════════════════════════════════════════════════════════════╗
      // ║  🔴 GYM-352 — CE POLL DURAIT 60 s POUR UN CRÉDIT QUI MET 2 min 33 s          ║
      // ╚═══════════════════════════════════════════════════════════════════════════════╝
      //
      // `30` tentatives × `2000 ms` = 60 secondes. Or la latence réelle du webhook de
      // crédit est mesurée dans ce dépôt à 2 min 33 s (GYM-207, constat prod du 04/08 —
      // c'est la raison du plafond à 5 min de l'écran de vérification). La continuation
      // était donc 2,5 fois plus courte que le délai qu'elle devait couvrir : tout paiement
      // crédité après une minute perdait le cours. C'est l'explication quantitative des
      // 25 achats sur 70 sans réservation.
      //
      // Nouveau plafond : 5 minutes, ALIGNÉ SUR CELUI DE `app/payment/success.tsx`. Ce
      // n'est pas un chiffre choisi ici — c'est le précédent du dépôt, établi sur une
      // mesure de production, avec sa marge. Deux plafonds différents pour la même attente
      // finiraient par diverger.
      //
      // ⚠️ ET SURTOUT : CE POLL N'EST PLUS CRITIQUE. L'intention est sur le disque
      // (lib/bookingIntent.ts) depuis `session/[id].tsx`. S'il expire, le membre retrouve
      // son cours à la reprise de l'écran ou au prochain lancement. Le poll est devenu un
      // confort — il évite d'attendre — et non plus la condition de tout le parcours.
      lancerVerification()
      ecouterLeRetour()

      // GYM-352 — LE RÉSULTAT EST LU. Ce chemin échouait à l'identique de celui de
      // profile/subscription.tsx (constaté le 17/09 à 16h03) alors qu'il ne démonte aucune
      // modale et ne navigue pas : la cause était en aval, commune aux deux — la vue
      // intégrée elle-même (GYM-369).
      //
      // 🔴 GYM-369 — SEUL LE NOM DU VERDICT CHANGE ICI, ET RIEN D'AUTRE. `presented` («la
      // vue s'est affichée») n'a plus de sens quand la page part dans le navigateur du
      // système : ce qu'on sait désormais est `handedOff`, «le système a pris la main».
      // L'ordre des opérations de cette feuille n'est PAS touché — c'est elle qui marchait,
      // et les deux achats réussis des 21–22/09 en viennent.
      //
      // ⚠️ TOUJOURS PAS `await`, et la raison a changé. Avant : sur iOS `openBrowserAsync`
      // ne résolvait qu'à la FERMETURE du navigateur. Désormais `Linking.openURL` résout en
      // quelques millisecondes — attendre ne coûterait presque rien. On ne le fait pas
      // quand même, pour que le poll des crédits démarre sans dépendre d'un aller-retour
      // système, si court soit-il.
      void openCheckout(result.checkoutUrl, {
        screen: 'payment_required_sheet',
        paymentId: result.paymentId,
        planId: dropInPlan.id,
      }).then((outcome) => {
        if (annuleRef.current) return
        if (outcome.handedOff) {
          // 🔴 GYM-379 — MOLLIE EST OUVERT : FIN DE « BUSY », DÉBUT DE L'ATTENTE. La boucle
          // continue en arrière-plan ; l'écran, lui, cesse de verrouiller le membre.
          // ⚠️ Si la boucle a déjà conclu (crédit vu, feuille fermée), `annuleRef` est
          // resté faux mais `pollRef` est nul : on ne rouvre pas une attente terminée.
          setIsLoadingDropIn(false)
          if (pollRef.current) setStep('waiting')
          // 🔴 GYM-379 (relecture) — LECTURE EXPLICITE DU STATUT, JUSTE APRÈS LA RÉSOLUTION.
          // Sur Android, `openURL` peut résoudre APRÈS le retour du navigateur : l'événement
          // `active` est alors déjà passé. `open` ici = « non finalisé ». (Sur iOS, elle peut
          // tomber pendant que le membre est encore sur Mollie : l'étape change sous Safari,
          // et la lecture du retour la remet à jour.)
          if (pollRef.current) verifierStatut()
          return
        }
        // Le système a refusé l'URL : inutile de faire patienter le membre cinq minutes
        // devant un poll de crédits qui ne verra jamais rien.
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
        setIsLoadingDropIn(false)
        setStep('options')
        setDropInError(t('payment_required.errors.checkout_not_opened'))
      })
    } catch (e) {
      console.error('[PaymentRequiredSheet] drop-in uncaught:', e)
      setStep('options')
      Alert.alert(t('common.error'), t('payments.errors.FALLBACK'))
      setIsLoadingDropIn(false)
    }
  }

  // 🔴 GYM-379 — « REPRENDRE LE PAIEMENT » ROUVRE LE MÊME CHECKOUT. Aucun appel à
  // create-payment : un second paiement, c'est la porte ouverte au double débit pour un
  // membre dont le premier est peut-être passé (webhook en retard).
  //
  // 🔴 GYM-379 (passe finale) — ET LE STATUT EST RELU AU TAP. La question « non finalisé ? »
  // a pu rester affichée longtemps : le paiement a pu passer (`paid` → on attend, la fiche
  // réserve), mourir (→ les options), ou devenir illisible. Le checkout ne rouvre que sur
  // `open`/`pending`, relu à l'instant.
  const reprendrePaiement = async () => {
    const url = checkoutUrlRef.current
    const paymentId = paymentIdRef.current
    if (!url || !paymentId) return
    setDropInError(null)
    setStep('verification')
    const statut = await lireStatutPaiement(paymentId)
    const issue = issueFinAttente(statut)
    if (issue === 'options') {
      arreterAttente()
      paymentIdRef.current = null
      checkoutUrlRef.current = null
      setStep('options')
      setDropInError(t('payment_required.errors.payment_not_completed'))
      return
    }
    if (issue === 'illisible') { arreterAttente(); setStep('illisible'); return }
    annuleRef.current = false
    if (issue === 'paye') { setStep('waiting'); lancerVerification(); return }
    setStep('waiting')
    lancerVerification()
    ecouterLeRetour()
    void openCheckout(url, {
      screen: 'payment_required_sheet',
      paymentId: paymentIdRef.current ?? undefined,
      planId: dropInPlan?.id,
    }).then((outcome) => {
      if (annuleRef.current) return
      if (outcome.handedOff) { verifierStatut(); return }
      // ⚠️ PAS LES OPTIONS : le paiement précédent vit encore. On reste sur la question.
      setStep('unfinished')
      setDropInError(t('payment_required.errors.checkout_not_opened'))
    })
  }

  // GYM-379 — le cours est réservé dès le paiement confirmé : c'est ce que le CTA et la
  // phrase disent, et ce que la fiche fait (lib/reservationAuto.ts). Sur un cours COMPLET
  // (`waitlist`), la fiche ne réserve pas d'elle-même — la liste d'attente reste un second
  // geste (GYM-352) — donc le libellé d'origine reste.
  const reserveApresPaiement = context === 'book'

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={fermer}>
      <View className="flex-1 justify-end bg-black/50">
        {/* `bg-black/50` reste : un voile à 50 % n'est nommé par aucun jeton. */}
        <View className="rounded-t-3xl px-6 pb-10 pt-8" style={{ backgroundColor: tokens.surface }}>
          {/* parité:nouvel-élément:début GYM-379 — vérification, illisible, non finalisé, attente */}
          {step === 'verification' ? (
            // GYM-379 (relecture) — le statut du paiement précédent est relu : rien n'est
            // proposé tant qu'on ne sait pas s'il vit encore.
            <View className="items-center py-6">
              <ActivityIndicator color={tokens.accentDim} />
            </View>
          ) : step === 'illisible' ? (
            // 🔴 GYM-379 (passe finale) — LECTURE RATÉE : ON NE PROPOSE RIEN À PAYER NI À
            // REPRENDRE. « Réessayer » relit le statut ; « Annuler » ferme, intention gardée.
            <View className="items-center">
              <Text className="text-center font-barlow text-2xl uppercase" style={{ color: tokens.onSurface }}>
                {t('payment_required.unreadable.title')}
              </Text>
              <Text className="mt-2 text-center font-dmsans text-sm leading-relaxed" style={{ color: tokens.onBackgroundMuted }}>
                {t('payment_required.unreadable.hint')}
              </Text>
              <TouchableOpacity
                onPress={() => relireEtOrienter()}
                activeOpacity={0.8}
                style={{ backgroundColor: tokens.actionBg }}
                className="mt-6 w-full items-center rounded-2xl px-4 py-4"
              >
                <Text className="font-dmsans-bold text-sm" style={{ color: tokens.onAction }}>
                  {t('common.retry')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={fermer} activeOpacity={0.7} className="mt-2 w-full items-center py-3">
                <Text className="font-dmsans text-sm" style={{ color: tokens.onBackgroundMuted }}>{t('common.cancel')}</Text>
              </TouchableOpacity>
            </View>
          ) : step === 'unfinished' ? (
            // 🔴 GYM-379 — UNE QUESTION, PAS UN VERDICT. `open` au retour, c'est le plus
            // souvent une annulation chez la banque (aucun webhook) — mais ce peut être un
            // paiement passé dont le webhook tarde. La vérification continue derrière.
            <View className="items-center">
              <Text className="text-center font-barlow text-2xl uppercase" style={{ color: tokens.onSurface }}>
                {t('payment_required.unfinished.title')}
              </Text>
              <Text className="mt-2 text-center font-dmsans text-sm leading-relaxed" style={{ color: tokens.onBackgroundMuted }}>
                {t(accordRef.current ? 'payment_required.unfinished.hint' : 'payment_required.unfinished.hint_manual')}
              </Text>
              {dropInError && (
                <Text className="mt-3 text-center font-dmsans text-sm" style={{ color: SEMANTIC.danger }}>{dropInError}</Text>
              )}
              {/* Sans l'URL du checkout (intention d'une version antérieure), pas de reprise
                  possible — et surtout pas de second paiement : il reste « Annuler ». */}
              {checkoutUrlRef.current && (
                <TouchableOpacity
                  onPress={() => { void reprendrePaiement() }}
                  activeOpacity={0.8}
                  style={{ backgroundColor: tokens.actionBg }}
                  className="mt-6 w-full items-center rounded-2xl px-4 py-4"
                >
                  <Text className="font-dmsans-bold text-sm" style={{ color: tokens.onAction }}>
                    {t('payment_required.unfinished.resume')}
                  </Text>
                </TouchableOpacity>
              )}
              {/* ⚠️ JAMAIS `disabled`, comme sur l'attente. L'intention est conservée. */}
              <TouchableOpacity onPress={fermer} activeOpacity={0.7} className="mt-2 w-full items-center py-3">
                <Text className="font-dmsans text-sm" style={{ color: tokens.onBackgroundMuted }}>{t('common.cancel')}</Text>
              </TouchableOpacity>
            </View>
          ) : step === 'waiting' ? (
            // 🔴 GYM-379 — L'ATTENTE DIT CE QUI SE PASSE, ET RIEN DE PLUS. Aucun texte ici
            // n'affirme un paiement réussi : la base ne le porte pas encore.
            <View className="items-center">
              <ActivityIndicator color={tokens.accentDim} />
              <Text className="mt-4 text-center font-barlow text-2xl uppercase" style={{ color: tokens.onSurface }}>
                {t('payment_required.waiting.title')}
              </Text>
              <Text className="mt-2 text-center font-dmsans text-sm leading-relaxed" style={{ color: tokens.onBackgroundMuted }}>
                {t(accordRef.current ? 'payment_required.waiting.hint' : 'payment_required.waiting.hint_manual')}
              </Text>
              {dropInError && (
                <Text className="mt-3 text-center font-dmsans text-sm" style={{ color: tokens.onSurface }}>{dropInError}</Text>
              )}
              {/* ⚠️ JAMAIS `disabled` : c'est la sortie que GYM-379 rend au membre. */}
              <TouchableOpacity onPress={fermer} activeOpacity={0.7} className="mt-6 w-full items-center py-3">
                <Text className="font-dmsans text-sm" style={{ color: tokens.onBackgroundMuted }}>{t('common.cancel')}</Text>
              </TouchableOpacity>
            </View>
          /* parité:nouvel-élément:fin */
          ) : step === 'consent' && dropInPlan ? (
            <PurchaseConsentBody
              plan={{
                name: dropInPlan.name,
                priceCents: dropInPlan.priceCents,
                currency: dropInPlan.currency,
                billingType: dropInPlan.billingType,
              }}
              busy={isLoadingDropIn}
              confirmLabel={reserveApresPaiement ? t('payment_required.consent.confirm_and_book') : undefined}
              notice={reserveApresPaiement ? t('payment_required.consent.booking_notice') : undefined}
              onCancel={() => setStep('options')}
              onConfirm={runDropIn}
            />
          ) : (
          <>
          <View className="items-center">
            <View className="h-12 w-12 items-center justify-center rounded-2xl bg-move-accent/10">
              {/* 🔴 GYM-290 (A-1) — TRANCHÉ : un moyen de paiement n'est pas un succès,
                  c'est de la marque. Il rejoint `accentDim`. */}
              <CreditCard size={24} color={tokens.accentDim} />
            </View>
            <Text className="mt-4 text-center font-barlow text-2xl uppercase" style={{ color: tokens.onSurface }}>
              {context === 'waitlist' ? t('payment_required.waitlist_title') : t('payment_required.title')}
            </Text>
            <Text className="mt-2 text-center font-dmsans text-sm leading-relaxed text-move-text-secondary">
              {context === 'waitlist' ? t('payment_required.waitlist_subtitle') : t('payment_required.subtitle')}
            </Text>
          </View>

          <View className="mt-6 gap-3">
            {/* Option 1 — Abonnement */}
            <TouchableOpacity
              onPress={goToSubscription}
              activeOpacity={0.8}
              className="flex-row items-center gap-3 rounded-2xl border px-4 py-4"
              style={{ borderColor: tokens.border, backgroundColor: tokens.surface }}
            >
              <Calendar size={20} color={tokens.onSurface} />
              <View className="flex-1">
                <Text className="font-dmsans-bold text-sm" style={{ color: tokens.onSurface }}>
                  {t('payment_required.option_subscribe.label')}
                </Text>
                <Text className="font-dmsans text-xs" style={{ color: tokens.onBackgroundMuted }}>
                  {cheapestRecurring
                    ? t('payment_required.option_subscribe.sub_from', {
                        price: formatPrice(cheapestRecurring.priceCents, cheapestRecurring.currency),
                      })
                    : t('payment_required.option_subscribe.sub_generic')}
                </Text>
              </View>
            </TouchableOpacity>

            {/* Option 2 — Carnet de séances */}
            <TouchableOpacity
              onPress={goToSubscription}
              activeOpacity={0.8}
              className="flex-row items-center gap-3 rounded-2xl border px-4 py-4"
              style={{ borderColor: tokens.border, backgroundColor: tokens.surface }}
            >
              <Ticket size={20} color={tokens.onSurface} />
              <View className="flex-1">
                <Text className="font-dmsans-bold text-sm" style={{ color: tokens.onSurface }}>
                  {t('payment_required.option_pack.label')}
                </Text>
                <Text className="font-dmsans text-xs" style={{ color: tokens.onBackgroundMuted }}>
                  {packPlan
                    ? t('payment_required.option_pack.sub_priced', {
                        price: formatPrice(packPlan.priceCents, packPlan.currency),
                        count: packPlan.creditCount ?? 0,
                      })
                    : t('payment_required.option_pack.sub_generic')}
                </Text>
              </View>
            </TouchableOpacity>

            {/* Option 3 — Paiement à la séance (drop-in) */}
            <TouchableOpacity
              onPress={handleDropIn}
              activeOpacity={0.8}
              disabled={isLoadingDropIn || plansLoading || !dropInPlan}
              style={{ backgroundColor: tokens.actionBg }}
              className={`flex-row items-center gap-3 rounded-2xl px-4 py-4 ${isLoadingDropIn || plansLoading || !dropInPlan ? 'opacity-60' : ''}`}
            >
              {isLoadingDropIn || plansLoading ? (
                <ActivityIndicator color={tokens.onAction} />
              ) : (
                <CreditCard size={20} color={tokens.onAction} />
              )}
              <View className="flex-1">
                <Text style={{ color: tokens.onAction }} className="font-dmsans-bold text-sm">
                  {dropInPlan
                    ? t('payment_required.option_drop_in.label_priced', {
                        price: formatPrice(dropInPlan.priceCents, dropInPlan.currency),
                      })
                    : t('payment_required.option_drop_in.label_generic')}
                </Text>
                {/* 🔴 GYM-307 — ENCRE RÉSOLUE SUR LE FOND D'ACTION, seuil TEXTE. */}
                <Text className="font-dmsans text-xs" style={{ color: tokens.onActionMuted }}>
                  {t('payment_required.option_drop_in.sub')}
                </Text>
              </View>
            </TouchableOpacity>
          </View>

          {dropInError && (
            <Text className="mt-3 text-center font-dmsans text-sm" style={{ color: SEMANTIC.danger }}>{dropInError}</Text>
          )}

          <TouchableOpacity onPress={onClose} activeOpacity={0.7} className="mt-4 items-center py-3">
            <Text className="font-dmsans text-sm" style={{ color: tokens.onBackgroundMuted }}>{t('common.close')}</Text>
          </TouchableOpacity>
          </>
          )}
        </View>
      </View>
    </Modal>
  )
}
