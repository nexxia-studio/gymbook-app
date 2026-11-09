import { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, Pressable, ActivityIndicator, AppState, Modal } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { X } from 'lucide-react-native'
import { supabase } from '../../lib/supabase'
import { lireBookingIntent, effacerBookingIntent, type BookingIntent } from '../../lib/bookingIntent'
import { accordPourCePaiement } from '../../lib/reservationAuto'
import { captureEvent } from '../../lib/analytics'
import { TERMINAL_FAILURE } from '../../lib/paymentStatus'
import { lireOriginePaiement, effacerOriginePaiement } from '../../lib/paymentOrigin'
import { membreConnecte, requetePaiement } from '../../lib/paymentLookup'
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
  mollie_payment_id?: string | null
}

// GYM-352 — l'état 'booking' a disparu avec la réservation automatique : cet écran ne
// réserve plus, il ramène à la fiche du cours — qui seule réserve (GYM-379).
// GYM-379 (relecture) — 'failed' : paiement mort lu en base ; 'error' : plafond sans `paid`.
type DropInStatus = 'polling' | 'success' | 'failed' | 'error'

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
// GYM-374 — DÉPLACÉ dans lib/paymentStatus.ts : la fiche du cours le lit aussi, et deux
// définitions du même prédicat finiraient par diverger.

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
    return <DropInRetryScreen slotId={params.slot_id!} rowId={params.id} />
  }

  // ============================================================
  // Mode classique — poll du paiement par payment.id
  // ============================================================
  return <ClassicPaymentScreen rowId={params.id} mollieId={params.mollie_id} returnTo={params.returnTo} checkoutOpened={params.checkout_opened} router={router} t={t} />
}

function DropInRetryScreen({ slotId, rowId }: { slotId: string; rowId?: string }) {
  const { tokens } = useTheme()
  const { t } = useTranslation()
  const router = useRouter()
  const [status, setStatus] = useState<DropInStatus>('polling')
  // GYM-379 (relecture) — le paiement porte-t-il l'accord du membre (« Payer et réserver ») ?
  // Seule condition sous laquelle cet écran annonce « on réserve ton cours ».
  const [accord, setAccord] = useState(false)
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true
    let vivant = true

    const allerAuCours = () => router.replace({ pathname: '/session/[id]', params: { id: slotId } })

    const run = async () => {
      // ╔═════════════════════════════════════════════════════════════════════════════╗
      // ║  🔴 GYM-379 (relecture) — CET ÉCRAN SUIT LE PAIEMENT, PLUS LE DROIT         ║
      // ╚═════════════════════════════════════════════════════════════════════════════╝
      //
      // Il guettait le crédit puis affichait « RÉSERVATION CONFIRMÉE ! » — alors qu'il ne
      // réserve rien (GYM-352) et qu'un crédit venu d'ailleurs suffisait à le déclencher.
      // Il lit désormais `payments.status` : « Paiement reçu » n'est dit que sur `paid` lu
      // en base, et « Cours réservé ✅ » n'est dit que par la fiche, après réponse serveur.
      const intent = await lireBookingIntent()
      const mollieId = intent?.paymentId
      if (!rowId && !mollieId) {
        // Aucune clé : rien à suivre ici. La fiche du cours sait relire son état.
        allerAuCours()
        return
      }
      const MAX_TENTATIVES = 150 // 150 × 2 s = 5 min — le plafond de GYM-207
      for (let i = 0; i < MAX_TENTATIVES; i++) {
        if (!vivant) return
        // GYM-379 (passe finale) — le paiement de CE membre, jamais celui d'un autre.
        const query = requetePaiement({ rowId, mollieId }, 'status, mollie_payment_id', await membreConnecte())
        const res = query ? await runNetworkSafe(async () => await query.maybeSingle()).catch(() => null) : null
        const ligne = res && !res.offline
          ? (res.data.data as { status?: string; mollie_payment_id?: string } | null)
          : null
        if (ligne?.status === 'paid') {
          if (!vivant) return
          setAccord(accordPourCePaiement(intent, ligne.mollie_payment_id ?? mollieId))
          setStatus('success')
          await sleep(1200)
          if (vivant) allerAuCours()
          return
        }
        if (ligne?.status && TERMINAL_FAILURE.has(ligne.status)) {
          if (vivant) setStatus('failed')
          return
        }
        await sleep(2000)
      }
      // Plafond atteint sans `paid` lu : on ne dit PAS « paiement reçu ».
      if (vivant) setStatus('error')
    }

    void run()
    return () => { vivant = false }
  }, [slotId, rowId, router])

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
              {t(accord ? 'payment_drop_in_retry.success_sub' : 'payment_drop_in_retry.success_sub_manual')}
            </Text>
          </>
        )}

        {(status === 'error' || status === 'failed') && (
          <>
            <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 22, color: tokens.onBackground, textAlign: 'center', letterSpacing: 1 }}>
              {t(status === 'failed' ? 'payment_drop_in_retry.failed_title' : 'payment_drop_in_retry.error_title')}
            </Text>
            <Text className="font-dmsans text-sm text-center" style={{ color: tokens.onBackground + '99' }}>
              {t(status === 'failed' ? 'payment_drop_in_retry.failed_sub' : 'payment_drop_in_retry.error_sub')}
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
  const [intentionLue, setIntentionLue] = useState(false)
  useEffect(() => {
    let vivant = true
    void lireBookingIntent().then((i) => { if (vivant) { setIntention(i); setIntentionLue(true) } })
    return () => { vivant = false }
  }, [])
  // 🔴 GYM-379 (relecture) — LE RETOUR D'UN ABONNEMENT PRIS DEPUIS UN COURS. create-subscription
  // ne pose pas `id=` dans sa redirectUrl (GYM-375) : sans clé, cet écran tombait sur
  // `unknown` et renvoyait à Profil → Abonnement, loin du cours. Quand l'intention porte
  // l'ACCORD du membre (« S'abonner et réserver »), son `paymentId` EST la clé : on suit ce
  // paiement-là, et `paid` ramène à la fiche, qui réserve.
  // ⚠️ SANS ACCORD, RIEN NE CHANGE : le chemin `unknown` de GYM-373 reste celui d'un achat
  // fait depuis le profil.
  const mollieCle = mollieId
    ?? (!rowId && accordPourCePaiement(intention) ? intention?.paymentId : undefined)
  // Pas de clé dans l'URL : on attend d'avoir lu l'intention avant de conclure `unknown`.
  const cleTranchee = !!rowId || !!mollieId || intentionLue
  // GYM-379 — les textes « on réserve ton cours » ne valent que pour l'accord de CE paiement.
  const accordIci = accordPourCePaiement(intention, payment?.mollie_payment_id ?? mollieCle ?? null)
  const cleTexte = (base: string) => (accordIci ? base : `${base}_manual`)
  // 🔴 GYM-373 — L'ÉCRAN D'ORIGINE, LU HORS NAVIGATION. `returnTo` arrive par les
  // paramètres, et le lien universel de retour les ÉCRASE (app/dopamine/payment-success.tsx
  // ne transmet que id/source/slot_id). L'origine posée par `openCheckout` survit, elle.
  // Même motif que l'intention juste au-dessus, à dessein.
  const [origine, setOrigine] = useState<string | null>(null)
  useEffect(() => {
    let vivant = true
    void lireOriginePaiement().then((o) => { if (vivant) setOrigine(o) })
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
  //
  // GYM-373 — ET L'ORIGINE PERSISTÉE PASSE APRÈS `returnTo`, AVANT LE DÉFAUT. Ordre :
  //   1. intention (GYM-352)  2. returnTo (paramètres, quand ils ont survécu)
  //   3. origine persistée (quand le lien universel les a écrasés)  4. Réservations.
  // `returnTo` garde la priorité sur l'origine : quand il est là, c'est le même écran, posé
  // par le même achat — et il ne dépend d'aucune lecture disque.
  const goToSuccessDestination = useCallback(() => {
    // Elle a servi — ou n'a plus lieu d'être : elle ne doit pas survivre au parcours. Seul
    // point d'effacement côté lecture, quelle que soit la branche prise ci-dessous.
    void effacerOriginePaiement()
    if (intention) {
      router.replace({ pathname: '/session/[id]', params: { id: intention.slotId } })
      return
    }
    router.replace((returnTo ?? origine ?? '/(tabs)/bookings') as never)
  }, [router, returnTo, origine, intention])

  // GYM-373 B — LA SORTIE DE L'ÉTAT `unknown` (aucune clé de paiement). Le membre est
  // renvoyé là d'où il a lancé l'achat — en pratique Profil → Abonnement, où il peut CONSTATER
  // lui-même si l'abonnement est actif, ce que cet écran ne sait pas faire.
  //
  // ⚠️ PAS `goToSuccessDestination` : cet état n'est pas un succès. L'intention de réservation
  // n'y prend PAS la priorité — renvoyer sur la fiche d'un cours un membre dont on ignore
  // s'il a payé, c'est lui présenter « Confirmer ma réservation » sur une supposition.
  // ⚠️ Et l'origine n'est PAS effacée ici : `paymentOrigin.ts` garde un seul point
  // d'effacement côté lecture ; le prochain `openCheckout` l'écrase ou l'efface de toute façon.
  const destinationSansCle = origine ?? '/(tabs)/bookings'
  const goToUnknownDestination = useCallback(() => {
    router.replace(destinationSansCle as never)
  }, [router, destinationSansCle])

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
    // GYM-374 — la clé de recherche vit dans lib/paymentLookup.ts, partagée avec la fiche
    // du cours ; les colonnes restent celles de cet écran.
    const memberId = await membreConnecte()
    if (settledRef.current) return
    const query = requetePaiement(
      { rowId, mollieId: mollieCle },
      // 🔴 GYM-294 — `gym_id` RAMENÉ POUR LE GARDE. La policy de `payments` est
      // `member_id = auth.uid()` — SANS clause de salle : contrairement à `time_slots`,
      // elle autorise donc bien la lecture d'un paiement d'une AUTRE salle du membre.
      // Défaut LATENT aujourd'hui (mesuré : 0 membre a des paiements dans plusieurs
      // salles), mais la policy l'autorise, et c'est la policy qui fait foi.
      'id, gym_id, status, plan_name, amount, currency, credits_granted, mollie_payment_id',
      memberId,
    )
    if (!query) return
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
    // GYM-374 — colonnes passées en variable à `requetePaiement` : le typage de
    // supabase-js ne les infère plus, la forme de la ligne est donc déclarée ici.
    const data = res.data.data as unknown as (Payment & { gym_id?: string }) | null
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
  }, [rowId, mollieCle, stopPolling])

  // ╔═════════════════════════════════════════════════════════════════════════════════════╗
  // ║  GYM-352 — L'ÉCRAN CESSE DE MENTIR AU BOUT DE CINQ MINUTES                          ║
  // ╚═════════════════════════════════════════════════════════════════════════════════════╝
  //
  // LE DÉFAUT. Au bout du timeout, l'écran affichait TOUJOURS « Ton paiement est bien
  // enregistré… tes séances seront créditées automatiquement, tu n'as rien à faire. »
  // Le 17/09, c'était FAUX : le navigateur ne s'était jamais ouvert, aucun paiement n'avait
  // eu lieu, et on disait au membre d'attendre un crédit qui ne viendrait jamais.
  //
  // QUATRE SITUATIONS, ET ELLES N'APPELLENT PAS LA MÊME PHRASE :
  //
  //   · unknown      — AUCUNE clé de paiement (ni `id`, ni `mollie_id`) : l'app n'a rien à
  //                    interroger et ne sait RIEN. Testé EN PREMIER (GYM-373 ⑤).
  //   · not_opened   — la page de paiement ne s'est pas ouverte. L'app le SAIT désormais
  //                    (GYM-352, param `checkout_opened=0`). Rien n'a été débité.
  //   · not_finalized— la ligne existe mais n'a jamais quitté `pending`/`open` : le membre
  //                    n'a pas terminé le paiement chez Mollie. Rien n'a été débité.
  //   · awaiting     — une clé existe et la ligne n'est ni ouverte ni terminale. C'est le
  //                    SEUL cas où « ton paiement est enregistré, tu n'as rien à faire » est
  //                    défendable : le webhook tarde (constat du 04/08, crédit reçu en
  //                    2 min 33 s), et c'est pour lui que le plafond est à 5 min.
  //
  // 🔴 GYM-373 ⑤ — CE COMMENTAIRE AFFIRMAIT UNE GARANTIE QUE LE CODE NE TENAIT PAS. À trois
  // branches, « tout le reste » incluait l'écran SANS CLÉ : `checkoutOpened` undefined,
  // `payment` null → `awaiting` → « ton paiement est bien enregistré » à un membre dont
  // l'app ignore tout, y compris s'il a payé. Le défaut de GYM-374, à un second endroit :
  // une phrase de certitude posée sur une absence d'information. Et ce n'est pas un cas
  // exotique — create-subscription ne pose pas `id=` dans sa redirectUrl (vérifié sur
  // l'instance prod) : c'est le retour NORMAL d'un abonnement, en attendant GYM-375.
  //
  // ⚠️ DEUX SIGNAUX INDÉPENDANTS, ET C'EST VOULU. `checkout_opened` repose sur l'heuristique
  // de délai de `openCheckout` ; le statut de la ligne, lui, est un fait serveur. Si
  // l'heuristique se trompe, `not_finalized` rattrape le cas — le membre n'est jamais
  // renvoyé au message « rien à faire » alors qu'il lui reste tout à faire.
  const timeoutKind: 'unknown' | 'not_opened' | 'not_finalized' | 'awaiting' =
    !rowId && !mollieCle
      ? 'unknown'
      : checkoutOpened === '0'
        ? 'not_opened'
        : payment && (payment.status === 'pending' || payment.status === 'open')
          ? 'not_finalized'
          : 'awaiting'

  // Cycle de poll : démarre AU MONTAGE (navigation propriétaire ou deep link), immédiat +
  // intervalle, borné par un timeout global ~2 min.
  useEffect(() => {
    // GYM-379 — sans clé dans l'URL, l'intention peut en fournir une : on l'attend.
    if (!cleTranchee) return
    if (!rowId && !mollieCle) {
      // Aucune clé de paiement → on ne peut pas poller : état `unknown` (GYM-373 ⑤).
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
  }, [rowId, mollieCle, cleTranchee, poll, stopPolling])

  // GYM-207 — Relance manuelle après timeout. Le membre disposait auparavant d'un message
  // « Tire pour rafraîchir » sur un écran SANS pull-to-refresh (l'instruction visait un
  // autre écran) : le geste ne déclenchait rien. On lui donne un bouton qui, lui, relance
  // réellement le poll pour un nouveau cycle borné.
  const retryPolling = useCallback(() => {
    if (!rowId && !mollieCle) return
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
  }, [rowId, mollieCle, poll, stopPolling])

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
              {t(intention ? cleTexte('payment.intent_success_title') : 'payment.success_title')}
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
                {t(cleTexte('payment.intent_success_body'))}
              </Text>
            )}
            {/* ⚠️ `goToSuccessDestination`, PAS `goToBookings` : c'est lui qui connaît
                l'intention. Le bouton menait à la liste des réservations — exactement
                l'endroit où le cours n'était pas. */}
            <Pressable onPress={goToSuccessDestination} style={{ backgroundColor: tokens.actionBg }} className="mt-10 w-full items-center rounded-xl py-4">
              <Text style={ctaLabel}>
                {t(intention ? cleTexte('payment.intent_go_to_course') : 'payment.go_to_bookings')}
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
            {/* `unknown` prend ⚠️ : un sablier promettrait une attente qui aboutit. */}
            <Text style={{ fontSize: 64, marginBottom: 16 }}>{timeoutKind === 'awaiting' ? '⏳' : '⚠️'}</Text>
            <Text style={titleStyle}>{t(`payment.${timeoutKind}_title`)}</Text>
            <Text className="mt-3 font-dmsans text-sm text-center" style={{ color: tokens.onBackgroundMuted }}>
              {t(`payment.${timeoutKind}_message`)}
            </Text>
            {/* GYM-207 — relance RÉELLE, en remplacement de l'ancienne consigne
                « Tire pour rafraîchir » qui ne correspondait à aucun geste sur cet écran.
                Masquée s'il n'y a aucune clé de paiement à interroger. */}
            {(rowId || mollieCle) && (
              <Pressable onPress={retryPolling} style={{ backgroundColor: tokens.actionBg }} className="mt-10 w-full items-center rounded-xl py-4">
                <Text style={ctaLabel}>{t('payment.check_again')}</Text>
              </Pressable>
            )}
            {/* GYM-373 B — ⚠️ LE LIBELLÉ SUIT LA DESTINATION. Repointer le bouton sans
                changer son texte recréerait un bouton qui dit une chose et en fait une autre. */}
            <Pressable
              onPress={timeoutKind === 'unknown' ? goToUnknownDestination : goToBookings}
              className={`w-full items-center rounded-xl border py-4 ${rowId || mollieCle ? 'mt-3' : 'mt-10'}`}
              style={{ borderColor: tokens.border }}
            >
              <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 16, color: tokens.onSurface }}>
                {t(
                  timeoutKind === 'unknown' && destinationSansCle === '/profile/subscription'
                    ? 'payment.go_to_subscription'
                    : 'payment.go_to_bookings',
                )}
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
              {t(intention ? cleTexte('payment.intent_success_title') : 'payment.modal_success_title')}
            </Text>
            <Text className="mt-3 font-dmsans text-sm text-center" style={{ color: tokens.onSurfaceSecondary }}>
              {t(intention ? cleTexte('payment.intent_success_body') : 'payment.modal_success_body')}
            </Text>
            <Pressable
              onPress={() => { setSuccessVisible(false); goToSuccessDestination() }}
              style={{ backgroundColor: tokens.actionBg }} className="mt-8 w-full items-center rounded-xl py-4"
            >
              <Text style={ctaLabel}>
                {t(intention ? cleTexte('payment.intent_go_to_course') : 'payment.go_to_bookings')}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}
