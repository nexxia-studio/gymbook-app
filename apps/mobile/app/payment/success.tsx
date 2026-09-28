import { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, Pressable, ActivityIndicator, AppState, Modal } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { X } from 'lucide-react-native'
import { supabase } from '../../lib/supabase'
// GYM-352 — même prédicat d'abonnement actif que le reste de l'app.
import { ACTIVE_SUBSCRIPTION_STATUSES, isSubscriptionActive } from '../../lib/subscription'
import { lireBookingIntent, effacerBookingIntent, type BookingIntent } from '../../lib/bookingIntent'
import { captureEvent } from '../../lib/analytics'
import { useAuthStore } from '../../stores/useAuthStore'
// GYM-240 — coupure réseau vs refus serveur : deux issues distinctes.
import { runNetworkSafe } from '../../lib/networkError'
import { useTheme } from '../../lib/theme/ThemeProvider'
import type { ThemeTokens } from '../../lib/theme/resolveTheme'
import { useCrossGymGuard } from '../../hooks/useCrossGymGuard'
import { CrossGymInterstitial } from '../../components/gym/CrossGymInterstitial'

interface Payment {
  id: string
  status: string
  plan_name: string
  amount: number | string
  currency: string | null
  credits_granted: number
}

// GYM-352 — l'état 'booking' a disparu avec la réservation automatique : cet écran ne
// réserve plus, il ramène à la fiche du cours où le membre confirme lui-même.
type DropInStatus = 'polling' | 'success' | 'error'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// ── GYM-96 (QA-06) — poll robuste de la page « paiement en cours ».
// Contrat serveur (create-payment v26+) : la redirectUrl porte ?id=<payments.id>.
// On poll la table `payments` par cet id jusqu'à un état TERMINAL.
const POLL_INTERVAL_MS = 2500
// GYM-207 — 5 min, et non 2. Constat prod du 04/08 : le webhook Mollie a crédité en
// 2 min 33 s, DÉPASSANT l'ancien plafond de 2 min. L'écran basculait donc en « paiement
// en cours de traitement » alors que le crédit était déjà accordé — le membre croyait son
// paiement échoué sur son tout premier achat. Le plafond doit couvrir la latence réelle
// observée, avec de la marge.
const GLOBAL_TIMEOUT_MS = 300_000 // 5 min
// Statuts terminaux d'échec (Mollie → colonne payments.status via webhook).
const TERMINAL_FAILURE = new Set(['failed', 'canceled', 'cancelled', 'expired'])

type ClassicStatus = 'polling' | 'success' | 'failed' | 'timeout'

// ⚠️ UNE FABRIQUE PLUTÔT QUE DEUX CONSTANTES, ET C'EST LA POSITION QUI L'IMPOSE.
// Ces deux styles étaient des constantes de module ; elles ne pouvaient donc pas lire le
// thème. Les descendre dans le composant marche — mais déplace leurs couleurs DANS LA
// SUITE du fichier, et `verify-screen-parity` compare les suites : quatre écarts
// apparaissaient sur une migration pourtant exacte. La fabrique reste ici, à la place
// exacte des constantes qu'elle remplace, et reçoit les jetons en argument.
//
// `bg-move-dark` de cet écran, donc la paire bloquée.
const makeStyles = (tokens: ThemeTokens) => ({
  title: {
    fontFamily: 'BarlowCondensed_900Black',
    fontSize: 24,
    color: tokens.onSurface,
    textAlign: 'center' as const,
    letterSpacing: 2,
  },
  cta: { fontFamily: 'DMSans_700Bold', fontSize: 16, color: tokens.onAction },
})

export default function PaymentSuccess() {
  const { t } = useTranslation()
  const router = useRouter()
  // GYM-352 — `checkout_opened: '0'` signalait que le navigateur ne s'était pas affiché.
  //
  // ⚠️ 22/09 — PLUS AUCUN APPELANT NE LE POSE, et le param est CONSERVÉ quand même : il
  // couvre un lien profond ancien ; le retirer obligerait à re-décider quoi faire d'un
  // paramètre qui arriverait quand même.
  //
  // 🔴 GYM-369 — LA JUSTIFICATION D'HIER ÉTAIT FAUSSE, ET LA CORRIGER IMPORTE. Elle disait
  // « cet écran n'est monté que DEPUIS `onPresented`, donc la page Mollie est à l'écran ».
  // `onPresented` a été RETIRÉ le 23/09 (il était la cause de la cascade, pas le remède),
  // et cet écran est désormais monté dès que le SYSTÈME a pris la main sur l'URL — ce qui
  // ne dit rien de ce que le membre voit ensuite.
  //
  // ⚠️ C'EST PRÉCISÉMENT POURQUOI LE PARAMÈTRE NE SERT PLUS À RIEN : il n'existe plus
  // aucune mesure côté app capable de distinguer « ouvert » de « pas ouvert ». Le seul
  // signal qui reste est un FAIT SERVEUR — le statut de la ligne — et c'est `not_finalized`
  // qui le porte, plus bas. Une heuristique en moins n'est pas une mesure en moins : celle
  // de GYM-352 déclarait « présenté » ce que François n'a jamais vu.
  const params = useLocalSearchParams<{ id?: string; mollie_id?: string; slot_id?: string; source?: string; returnTo?: string; checkout_opened?: string }>()
  const isDropInRetry = params.source === 'drop_in' && !!params.slot_id

  // ============================================================
  // GYM-63b — Mode drop-in auto-retry
  // ============================================================
  if (isDropInRetry) {
    return <DropInRetryScreen slotId={params.slot_id!} />
  }

  // ============================================================
  // Mode classique — poll du paiement par payment.id
  // ============================================================
  return <ClassicPaymentScreen rowId={params.id} mollieId={params.mollie_id} returnTo={params.returnTo} checkoutOpened={params.checkout_opened} router={router} t={t} />
}

function DropInRetryScreen({ slotId }: { slotId: string }) {
  const { tokens } = useTheme()
  const { t } = useTranslation()
  const router = useRouter()
  const user = useAuthStore((s) => s.user)
  const gymId = useAuthStore((s) => s.gym_id)
  const [status, setStatus] = useState<DropInStatus>('polling')
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true

    const run = async () => {
      if (!user || !gymId) {
        setStatus('error')
        return
      }

      // ⚠️ GYM-352 — 5 MINUTES, comme le plafond de l'écran de vérification. C'était
      // 15 secondes (15 × 1 s), pour un crédit mesuré à 2 min 33 s en production.
      const MAX_TENTATIVES = 150 // 150 × 2 s = 5 min
      for (let i = 0; i < MAX_TENTATIVES; i++) {
        await sleep(2000)
        // GYM-352 — le DROIT, pas le crédit : un abonnement ouvre le même accès
        // (create-booking : `!activeSubscription && !creditsAvailable`).
        const [creditsRes, subRes] = await Promise.all([
          supabase
            .from('member_credits')
            .select('credits_remaining')
            .eq('member_id', user.id)
            .eq('gym_id', gymId)
            .gt('credits_remaining', 0),
          supabase
            .from('member_subscriptions')
            .select('status, ends_at')
            .eq('member_id', user.id)
            .eq('gym_id', gymId)
            .in('status', ACTIVE_SUBSCRIPTION_STATUSES)
            .order('starts_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ])

        const aDesCredits = (creditsRes.data?.length ?? 0) > 0
        const aUnAbonnement = !!subRes.data && isSubscriptionActive(subRes.data.status, subRes.data.ends_at)
        if (!aDesCredits && !aUnAbonnement) continue

        // ╔═════════════════════════════════════════════════════════════════════════════╗
        // ║  🔴 GYM-352 — CET ÉCRAN NE RÉSERVE PLUS. IL RAMÈNE AU COURS.                ║
        // ╚═════════════════════════════════════════════════════════════════════════════╝
        //
        // Il appelait `create-booking` puis redirigeait vers l'onglet Réservations : le
        // membre se retrouvait inscrit sans l'avoir confirmé. La décision produit est un
        // geste EXPLICITE, jamais de réservation silencieuse.
        //
        // ⚠️ Et ce code n'a JAMAIS tourné en production : sa condition de montage exige
        // `slot_id` dans l'URL, que `buildPaymentReturnUrl` n'a jamais émis. Il n'y a donc
        // aucune habitude de membre à désapprendre — on corrige avant la première fois.
        setStatus('success')
        await sleep(1200)
        router.replace({ pathname: '/session/[id]', params: { id: slotId } })
        return
      }

      // Le poll a expiré — mais l'intention est sur le disque : le membre retrouvera son
      // cours en rouvrant l'app. On le ramène quand même sur la fiche, qui saura dire où
      // en est son droit.
      setStatus('error')
    }

    run()
  }, [user, gymId, slotId, router])

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: tokens.background }} edges={['top', 'bottom']}>
      <View className="flex-1 items-center justify-center gap-4 px-8">
        {status === 'polling' && (
          <>
            <ActivityIndicator size="large" color={tokens.accent} />
            <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 22, color: tokens.onBackground, textAlign: 'center', letterSpacing: 1 }}>
              {t('payment_drop_in_retry.polling_title')}
            </Text>
            {/* 🔴 GYM-304 — ENCRE RÉSOLUE, OPACITÉ CONSERVÉE. `text-white/60` était un BLANC EN
                DUR posé sur `tokens.background` : illisible dès que la salle a un fond clair.
                Mesuré sur le fond constaté #E9E8E8 — un blanc à 60 % y disparaît.
                
                ⚠️ `tokens.onBackground`, PAS `onBackgroundMuted` — c'est toute la leçon de la PR
                #235. `onBackgroundMuted` est choisi par le MODE (`hslLightness > 80`), un critère
                qui classe « sombre » un fond vif : il descend sous 3:1 sur 7 000 salles sur
                19 600. `onBackground`, lui, est choisi par `bestInkOn`, c'est-à-dire par le
                CONTRASTE RÉEL. Le critère est la luminance, jamais la teinte.
                
                ⚠️ L'ALPHA EST CONSERVÉ : 0x99 = 153, soit 153/255 = 0,60 pile. Chez Dopamine
                `onBackground` vaut #FFFFFF — le rendu est donc le blanc à 60 % d'aujourd'hui, au
                pixel. C'est le motif A-10, comme les en-têtes de #232 (3c). */}
            <Text className="font-dmsans text-sm text-center" style={{ color: tokens.onBackground + '99' }}>
              {t('payment_drop_in_retry.polling_sub')}
            </Text>
          </>
        )}

        {status === 'success' && (
          <>
            <Text style={{ fontSize: 64 }}>✅</Text>
            <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 24, color: tokens.accent, textAlign: 'center', letterSpacing: 2 }}>
              {t('payment_drop_in_retry.success_title')}
            </Text>
            <Text className="font-dmsans text-sm text-center" style={{ color: tokens.onBackground + '99' }}>
              {t('payment_drop_in_retry.success_sub')}
            </Text>
          </>
        )}

        {status === 'error' && (
          <>
            <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 22, color: tokens.onBackground, textAlign: 'center', letterSpacing: 1 }}>
              {t('payment_drop_in_retry.error_title')}
            </Text>
            <Text className="font-dmsans text-sm text-center" style={{ color: tokens.onBackground + '99' }}>
              {t('payment_drop_in_retry.error_sub')}
            </Text>
            <Pressable
              onPress={() => router.replace({ pathname: '/session/[id]', params: { id: slotId } })}
              className="mt-4 w-full items-center rounded-xl py-4"
              style={{ backgroundColor: tokens.accent }}
            >
              <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 16, color: tokens.onAccent }}>
                {t('payment_drop_in_retry.back_to_course')}
              </Text>
            </Pressable>
          </>
        )}
      </View>
    </SafeAreaView>
  )
}

function ClassicPaymentScreen({
  rowId,
  mollieId,
  checkoutOpened,
  returnTo,
  router,
  t,
}: {
  // GYM-96 — deux clés possibles selon le mode d'arrivée :
  //  - rowId    : payments.id, porté par le deep link (?id=…) via la redirectUrl serveur.
  //  - mollieId : payment_id Mollie, connu par le client (réponse create-payment) → utilisé
  //               par la NAVIGATION PROPRIÉTAIRE (écran monté avant même d'ouvrir le navigateur).
  rowId: string | undefined
  mollieId: string | undefined
  // GYM-352 — '0' quand `openCheckout` a constaté que le navigateur ne s'était pas affiché.
  checkoutOpened: string | undefined
  // Destination post-succès contextuelle : renseignée par l'écran d'achat (ex. mon abonnement).
  // Absente (deep link pur) → défaut Réservations > À venir.
  returnTo: string | undefined
  router: ReturnType<typeof useRouter>
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  const { tokens } = useTheme()
  const { title: titleStyle, cta: ctaLabel } = makeStyles(tokens)
  const [payment, setPayment] = useState<Payment | null>(null)
  // ╔═════════════════════════════════════════════════════════════════════════════════════╗
  // ║  🔴 GYM-352 — LE CŒUR DU MALENTENDU EST ICI                                         ║
  // ╚═════════════════════════════════════════════════════════════════════════════════════╝
  //
  // Cet écran annonçait « PAIEMENT CONFIRMÉ ! » puis proposait « Voir mes réservations »,
  // qui mène à `/(tabs)/bookings`. L'app FÉLICITAIT le membre et l'envoyait vers une liste
  // où son cours n'était pas. Le malentendu n'est pas une inattention de sa part : c'est
  // ce que l'app lui disait de faire.
  //
  // Quand une intention existe, le paiement n'est pas la fin du parcours mais son AVANT-
  // DERNIÈRE étape. Le titre, le sous-titre et la destination changent tous les trois.
  const [intention, setIntention] = useState<BookingIntent | null>(null)
  useEffect(() => {
    let vivant = true
    void lireBookingIntent().then((i) => { if (vivant) setIntention(i) })
    return () => { vivant = false }
  }, [])
  const [status, setStatus] = useState<ClassicStatus>('polling')
  // 🔴 GYM-294 — MÊME GARDE QUE L'ÉCRAN DE CRÉNEAU, PAS UNE SECONDE VÉRIFICATION.
  // La policy de `payments` (`member_id = auth.uid()`) n'a AUCUNE clause de salle : un
  // paiement d'une autre salle du membre est lisible, et s'afficherait sous la marque de la
  // salle active. En single le hook sort à sa première ligne — aucun détour ajouté.
  const [gymDuPaiement, setGymDuPaiement] = useState<string | null>(null)
  const gardePaiement = useCrossGymGuard(gymDuPaiement)
  // GYM-240 — la connexion est-elle tombée pendant le poll ? État d'AFFICHAGE seulement :
  // il ne change ni le cycle de poll, ni l'issue du paiement.
  const [offline, setOffline] = useState(false)
  const [successVisible, setSuccessVisible] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Verrou d'état terminal : une fois SUCCÈS/ÉCHEC/TIMEOUT atteint, on ne re-poll plus.
  const settledRef = useRef(false)
  // GYM-207 — miroir de `status` lisible depuis le listener AppState sans le réabonner
  // à chaque changement d'état (le listener ne doit pas se recréer à chaque poll).
  const statusRef = useRef<ClassicStatus>('polling')
  statusRef.current = status

  const stopPolling = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null }
  }, [])

  const goToBookings = useCallback(() => {
    router.replace('/(tabs)/bookings')
  }, [router])

  // Destination post-succès contextuelle : returnTo si l'achat vient d'un écran précis
  // (ex. mon abonnement → le membre voit ses crédits), sinon défaut Réservations > À venir.
  //
  // 🔴 GYM-352 — L'INTENTION PRIME SUR TOUT. Elle passe AVANT `returnTo` : un membre parti
  // d'un cours doit revenir au cours, même si l'achat a transité par l'écran des formules.
  // C'est la décision produit — il revient sur la fiche, crédit visible, bouton armé.
  const goToSuccessDestination = useCallback(() => {
    if (intention) {
      router.replace({ pathname: '/session/[id]', params: { id: intention.slotId } })
      return
    }
    router.replace((returnTo ?? '/(tabs)/bookings') as never)
  }, [router, returnTo, intention])

  // QA-06 : bouton Fermer FONCTIONNEL. Coupe le poll résiduel puis revient à l'écran
  // précédent (ou, si ouvert par deep link sans historique, atterrit sur Réservations).
  const handleClose = useCallback(() => {
    stopPolling()
    if (router.canGoBack()) router.back()
    else goToBookings()
  }, [router, stopPolling, goToBookings])

  // GYM-240 — 🔴 C'EST ICI QUE LE REJET PARTAIT EN ERREUR NON GÉRÉE. Cette fonction est
  // `async` et passée à `setInterval` : la promesse qu'elle renvoie n'est attendue par
  // personne. Une coupure réseau pendant les 5 minutes de poll rejetait donc dans le vide,
  // et Sentry la recevait en `onunhandledrejection` sous le message trompeur
  // « Edge Function returned a non-2xx status code » — alors qu'aucune Edge n'était
  // appelée. Le poll est un cas d'école : il tourne en arrière-plan, longtemps, sur un
  // écran que le membre laisse ouvert pendant qu'il bascule d'application.
  // ⚠️ GYM-292 — SONDAGE D'UNE LIGNE DE PAIEMENT PAR SON IDENTIFIANT (`rowId` /
  // `mollieId`). La salle n'entre pas dans la question : on suit UN paiement, celui que
  // l'app vient de créer. Y ajouter un filtre de salle ne changerait rien et ferait
  // croire que la clé en dépend.
  const poll = useCallback(async () => {
    if (settledRef.current) return
    // rowId prioritaire (plus précis) ; sinon on retombe sur le mollie_payment_id.
    let query = supabase
      .from('payments')
      // 🔴 GYM-294 — `gym_id` RAMENÉ POUR LE GARDE. La policy de `payments` est
      // `member_id = auth.uid()` — SANS clause de salle : contrairement à `time_slots`,
      // elle autorise donc bien la lecture d'un paiement d'une AUTRE salle du membre.
      // Défaut LATENT aujourd'hui (mesuré : 0 membre a des paiements dans plusieurs
      // salles), mais la policy l'autorise, et c'est la policy qui fait foi.
      .select('id, gym_id, status, plan_name, amount, currency, credits_granted')
    if (rowId) query = query.eq('id', rowId)
    else if (mollieId) query = query.eq('mollie_payment_id', mollieId)
    else return
    // ⚠️ UNE COUPURE N'INTERROMPT PAS LE POLL : on repassera au tick suivant, et le
    // timeout global reste le seul juge de l'abandon. Un refus SERVEUR, lui, est relancé
    // par `runNetworkSafe` et remonte comme avant — le taire masquerait un vrai problème.
    // `query.maybeSingle()` renvoie un PostgrestBuilder (thenable, pas une vraie Promise) :
    // on l'enveloppe pour que `runNetworkSafe` reçoive bien une promesse.
    const res = await runNetworkSafe(async () => await query.maybeSingle())
    if (res.offline) {
      setOffline(true)
      return
    }
    setOffline(false)
    const { data } = res.data
    if (!data || settledRef.current) return
    // GYM-294 — la salle du paiement, pour le garde partagé. `null` tant qu'on ne sait pas.
    setGymDuPaiement((data as { gym_id?: string }).gym_id ?? null)
    setPayment(data as Payment)
    const s = data.status as string
    if (s === 'paid') {
      settledRef.current = true
      stopPolling()
      // GYM-273 — montant en CENTIMES et devise séparée (convention du lot) : un nombre à
      // virgule flottante en euros s'additionne mal, et `amount` arrive tantôt en nombre,
      // tantôt en chaîne selon le pilote Postgres.
      const row = data as Payment
      const amountCents = Math.round(Number(row.amount) * 100)
      // `credits_granted === 0` = abonnement : c'est la convention déjà employée côté
      // serveur (mollie-subscription-webhook, /revenus) — on ne l'invente pas ici.
      const isSubscription = (row.credits_granted ?? 0) === 0
      // ═══════════════════════════════════════════════════════════════════════════════
      // 🔴 GYM-273 — `payment_completed` N'EST PLUS ÉMIS ICI. IL PART DU SERVEUR.
      // ═══════════════════════════════════════════════════════════════════════════════
      // Deux sources pour un même événement fausseraient autant que zéro : c'est la
      // raison pour laquelle celle-ci est RETIRÉE plutôt que gardée en doublon.
      //
      // Ce qu'elle valait, mesuré le 07/09 sur 45 jours : 3 événements pour 44 paiements
      // encaissés. Ce bloc ne s'exécute que si le membre rouvre l'app APRÈS Mollie, qu'il
      // atterrit bien ici, et que le poll voit `paid` avant d'abandonner. Un
      // RENOUVELLEMENT, lui, n'a aucun écran : il ne pouvait rien émettre, jamais.
      //
      // L'émission vit désormais dans `mollie-webhook` et `mollie-subscription-webhook`
      // (via `_shared/posthog.ts`), avec le MÊME `distinct_id` — l'UUID Supabase que
      // `identifyUser()` pose ici — pour que l'entonnoir se referme sur la même personne.
      //
      // ⚠️ LES BUILDS ANTÉRIEURES CONTINUERONT D'ÉMETTRE un temps : on ne contrôle pas la
      // date de mise à jour des téléphones. Le recouvrement est borné par le débit
      // historique de ce bloc (3 en 45 jours) et se distingue dans PostHog par la
      // propriété `source`, absente côté client et valant 'server' côté webhook.
      // ⚠️ ÉMIS ICI ET PAS À L'INITIATION DU CHECKOUT : `payment_initiated` dit qu'un
      // membre a cliqué, `subscription_started` dit qu'un abonnement EXISTE. Les confondre
      // gonflerait le nombre d'abonnés de tous les paniers abandonnés.
      if (isSubscription) {
        captureEvent('subscription_started', {
          amount_cents: Number.isFinite(amountCents) ? amountCents : null,
          currency: row.currency ?? 'EUR',
        })
      }
      setStatus('success')
      setSuccessVisible(true)
    } else if (TERMINAL_FAILURE.has(s)) {
      settledRef.current = true
      stopPolling()
      // 🔴 GYM-352 — L'INTENTION NE DOIT PAS SURVIVRE À UN PAIEMENT MORT. Abandonné,
      // refusé ou expiré : sans cet effacement, la proposition « Confirmer ma réservation »
      // ressurgirait au prochain lancement sur un cours que le membre n'a jamais payé — un
      // fantôme dont il ne comprendrait pas l'origine.
      void effacerBookingIntent()
      setIntention(null)
      // `status` porte la raison telle que Mollie l'a rendue (failed / canceled / expired) :
      // un abandon volontaire et un refus bancaire n'appellent pas la même réaction.
      captureEvent('payment_failed', { status: s })
      setStatus('failed')
    }
  }, [rowId, mollieId, stopPolling])

  // ╔═════════════════════════════════════════════════════════════════════════════════════╗
  // ║  GYM-352 — L'ÉCRAN CESSE DE MENTIR AU BOUT DE CINQ MINUTES                          ║
  // ╚═════════════════════════════════════════════════════════════════════════════════════╝
  //
  // LE DÉFAUT. Au bout du timeout, l'écran affichait TOUJOURS « Ton paiement est bien
  // enregistré… tes séances seront créditées automatiquement, tu n'as rien à faire. »
  // Le 17/09, c'était FAUX : le navigateur ne s'était jamais ouvert, aucun paiement n'avait
  // eu lieu, et on disait au membre d'attendre un crédit qui ne viendrait jamais.
  //
  // TROIS SITUATIONS, ET ELLES N'APPELLENT PAS LA MÊME PHRASE :
  //
  //   · not_opened   — la page de paiement ne s'est pas ouverte. L'app le SAIT désormais
  //                    (GYM-352, param `checkout_opened=0`). Rien n'a été débité.
  //   · not_finalized— la ligne existe mais n'a jamais quitté `pending`/`open` : le membre
  //                    n'a pas terminé le paiement chez Mollie. Rien n'a été débité.
  //   · awaiting     — tout le reste. C'est le SEUL cas où « ton paiement est enregistré,
  //                    tu n'as rien à faire » est vrai : le webhook tarde (constat du 04/08,
  //                    crédit reçu en 2 min 33 s), et c'est pour lui que le plafond est à 5 min.
  //
  // ⚠️ DEUX SIGNAUX INDÉPENDANTS, ET C'EST VOULU. `checkout_opened` repose sur l'heuristique
  // de délai de `openCheckout` ; le statut de la ligne, lui, est un fait serveur. Si
  // l'heuristique se trompe, `not_finalized` rattrape le cas — le membre n'est jamais
  // renvoyé au message « rien à faire » alors qu'il lui reste tout à faire.
  const timeoutKind: 'not_opened' | 'not_finalized' | 'awaiting' =
    checkoutOpened === '0'
      ? 'not_opened'
      : payment && (payment.status === 'pending' || payment.status === 'open')
        ? 'not_finalized'
        : 'awaiting'

  // Cycle de poll : démarre AU MONTAGE (navigation propriétaire ou deep link), immédiat +
  // intervalle, borné par un timeout global ~2 min.
  useEffect(() => {
    if (!rowId && !mollieId) {
      // Aucune clé de paiement → on ne peut pas poller : état « en cours de traitement ».
      settledRef.current = true
      setStatus('timeout')
      return
    }
    poll()
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS)
    timeoutRef.current = setTimeout(() => {
      if (!settledRef.current) {
        settledRef.current = true
        stopPolling()
        setStatus('timeout')
      }
    }, GLOBAL_TIMEOUT_MS)
    return stopPolling
  }, [rowId, mollieId, poll, stopPolling])

  // GYM-207 — Relance manuelle après timeout. Le membre disposait auparavant d'un message
  // « Tire pour rafraîchir » sur un écran SANS pull-to-refresh (l'instruction visait un
  // autre écran) : le geste ne déclenchait rien. On lui donne un bouton qui, lui, relance
  // réellement le poll pour un nouveau cycle borné.
  const retryPolling = useCallback(() => {
    if (!rowId && !mollieId) return
    settledRef.current = false
    setStatus('polling')
    poll()
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS)
    timeoutRef.current = setTimeout(() => {
      if (!settledRef.current) {
        settledRef.current = true
        stopPolling()
        setStatus('timeout')
      }
    }, GLOBAL_TIMEOUT_MS)
  }, [rowId, mollieId, poll, stopPolling])

  // Filet QA-06 : le deep link auto depuis l'app bancaire n'est pas fiable. Quand l'app
  // repasse au premier plan (retour manuel), on re-poll IMMÉDIATEMENT.
  //
  // GYM-207 — y compris APRÈS un timeout : c'est le cas vécu en production (webhook plus
  // lent que le plafond). Un simple retour dans l'app doit suffire à voir la confirmation,
  // sans que le membre ait quoi que ce soit à faire.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return
      if (!settledRef.current) { poll(); return }
      if (statusRef.current === 'timeout') retryPolling()
    })
    return () => sub.remove()
  }, [poll, retryPolling])

  // Modale succès : auto-fermeture ~5 s → destination contextuelle (returnTo ou À venir).
  useEffect(() => {
    if (!successVisible) return
    const id = setTimeout(() => {
      setSuccessVisible(false)
      goToSuccessDestination()
    }, 5000)
    return () => clearTimeout(id)
  }, [successVisible, goToSuccessDestination])

  // 🔴 GYM-294 — MÊME MÉCANIQUE QUE L'ÉCRAN DE CRÉNEAU, avant tout rendu.
  // ⚠️ PAS DE BRANCHE `not_member` ICI, et ce n'est pas un oubli : la policy borne la
  // lecture à `member_id = auth.uid()`. Un paiement lisible est, par construction, CELUI DU
  // MEMBRE — il ne peut donc pas appartenir à une salle dont il n'est pas membre. Ajouter
  // un refus impossible ferait croire à un cas qui n'existe pas.
  if (gardePaiement.kind === 'elsewhere') {
    return (
      <CrossGymInterstitial
        gym={gardePaiement.gym}
        onCancel={() => router.back()}
        onSwitched={() => setGymDuPaiement(null)}
      />
    )
  }

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: tokens.page }} edges={['top', 'bottom']}>
      {/* Fermer (QA-06) — sauf pendant la modale succès qui a son propre CTA */}
      <View className="flex-row justify-end px-5 pt-2">
        <Pressable onPress={handleClose} hitSlop={12} accessibilityLabel={t('payment.close')}>
          <X size={26} color={tokens.onSurface} />
        </Pressable>
      </View>

      <View className="flex-1 items-center justify-center px-8">
        {status === 'polling' && (
          <>
            <ActivityIndicator size="large" color={tokens.onSurface} />
            <Text style={titleStyle} className="mt-4">{t('payment.verifying')}</Text>
            <Text className="mt-3 font-dmsans text-sm text-center" style={{ color: tokens.onBackgroundMuted }}>
              {t('payment.waiting_confirmation')}
            </Text>
            {/* GYM-240 — la connexion est tombée pendant la vérification. On le DIT plutôt
                que de laisser tourner un indicateur qui ne progressera pas, et on rassure :
                le paiement n'est pas perdu, c'est la lecture de son état qui l'est. Le poll
                continue tout seul — le message disparaît au premier tick qui aboutit. */}
            {offline && (
              <View className="mt-6 rounded-xl bg-orange-50 px-4 py-3">
                <Text className="text-center font-dmsans-bold text-sm text-orange-800">
                  {t('payment.offline_title')}
                </Text>
                <Text className="mt-1 text-center font-dmsans text-xs text-orange-700">
                  {t('payment.offline_hint')}
                </Text>
              </View>
            )}
          </>
        )}

        {status === 'success' && (
          <>
            <Text style={{ fontSize: 64, marginBottom: 16 }}>{intention ? '🎟️' : '✅'}</Text>
            {/* GYM-352 — « PAIEMENT CONFIRMÉ » devient « IL RESTE UN GESTE » : le paiement
                n'est pas la fin du parcours quand un cours attend d'être confirmé. */}
            <Text style={titleStyle}>
              {t(intention ? 'payment.intent_success_title' : 'payment.success_title')}
            </Text>
            {payment && (
              <>
                <Text className="mt-3 font-dmsans text-base text-center" style={{ color: tokens.onSurfaceSecondary }}>
                  {payment.plan_name} — {payment.amount}€
                </Text>
                <Text className="mt-1 font-dmsans-bold text-sm text-green-600 text-center">
                  {t('payment.credits_added', { count: payment.credits_granted })}
                </Text>
              </>
            )}
            {intention && (
              <Text className="mt-3 font-dmsans text-sm text-center" style={{ color: tokens.onBackgroundMuted }}>
                {t('payment.intent_success_body')}
              </Text>
            )}
            {/* ⚠️ `goToSuccessDestination`, PAS `goToBookings` : c'est lui qui connaît
                l'intention. Le bouton menait à la liste des réservations — exactement
                l'endroit où le cours n'était pas. */}
            <Pressable onPress={goToSuccessDestination} style={{ backgroundColor: tokens.actionBg }} className="mt-10 w-full items-center rounded-xl py-4">
              <Text style={ctaLabel}>
                {t(intention ? 'payment.intent_go_to_course' : 'payment.go_to_bookings')}
              </Text>
            </Pressable>
          </>
        )}

        {status === 'failed' && (
          <>
            <Text style={{ fontSize: 64, marginBottom: 16 }}>❌</Text>
            <Text style={titleStyle}>{t('payment.failed_title')}</Text>
            <Text className="mt-3 font-dmsans text-sm text-center" style={{ color: tokens.onBackgroundMuted }}>
              {t('payment.failed_message')}
            </Text>
            <Pressable onPress={() => router.replace('/profile/subscription')} style={{ backgroundColor: tokens.actionBg }} className="mt-10 w-full items-center rounded-xl py-4">
              <Text style={ctaLabel}>{t('payment.back_to_plans')}</Text>
            </Pressable>
          </>
        )}

        {status === 'timeout' && (
          <>
            <Text style={{ fontSize: 64, marginBottom: 16 }}>{timeoutKind === 'awaiting' ? '⏳' : '⚠️'}</Text>
            <Text style={titleStyle}>{t(`payment.${timeoutKind}_title`)}</Text>
            <Text className="mt-3 font-dmsans text-sm text-center" style={{ color: tokens.onBackgroundMuted }}>
              {t(`payment.${timeoutKind}_message`)}
            </Text>
            {/* GYM-207 — relance RÉELLE, en remplacement de l'ancienne consigne
                « Tire pour rafraîchir » qui ne correspondait à aucun geste sur cet écran.
                Masquée s'il n'y a aucune clé de paiement à interroger. */}
            {(rowId || mollieId) && (
              <Pressable onPress={retryPolling} style={{ backgroundColor: tokens.actionBg }} className="mt-10 w-full items-center rounded-xl py-4">
                <Text style={ctaLabel}>{t('payment.check_again')}</Text>
              </Pressable>
            )}
            <Pressable
              onPress={goToBookings}
              className={`w-full items-center rounded-xl border py-4 ${rowId || mollieId ? 'mt-3' : 'mt-10'}`}
              style={{ borderColor: tokens.border }}
            >
              <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 16, color: tokens.onSurface }}>
                {t('payment.go_to_bookings')}
              </Text>
            </Pressable>
          </>
        )}
      </View>

      {/* ÉTAPE 2 — modale succès auto-fermante (~5 s) + fermeture manuelle → Réservations */}
      <Modal
        visible={successVisible}
        transparent
        animationType="fade"
        onRequestClose={() => { setSuccessVisible(false); goToSuccessDestination() }}
      >
        <View className="flex-1 items-center justify-center bg-black/60 px-8">
          {/* `bg-black/60` reste : un voile à 60 % n'est nommé par aucun jeton. */}
          <View className="w-full items-center rounded-3xl p-8" style={{ backgroundColor: tokens.surface }}>
            <Text style={{ fontSize: 56, marginBottom: 12 }}>🎉</Text>
            <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 24, color: tokens.onSurface, textAlign: 'center', letterSpacing: 1 }}>
              {t(intention ? 'payment.intent_success_title' : 'payment.modal_success_title')}
            </Text>
            <Text className="mt-3 font-dmsans text-sm text-center" style={{ color: tokens.onSurfaceSecondary }}>
              {t(intention ? 'payment.intent_success_body' : 'payment.modal_success_body')}
            </Text>
            <Pressable
              onPress={() => { setSuccessVisible(false); goToSuccessDestination() }}
              style={{ backgroundColor: tokens.actionBg }} className="mt-8 w-full items-center rounded-xl py-4"
            >
              <Text style={ctaLabel}>
                {t(intention ? 'payment.intent_go_to_course' : 'payment.go_to_bookings')}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}
