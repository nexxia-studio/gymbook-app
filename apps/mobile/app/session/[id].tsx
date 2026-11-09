import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { View, Text, ScrollView, TouchableOpacity, Alert, AppState } from 'react-native'
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MapPin } from 'lucide-react-native'
import { WaitlistCountdown } from '../../components/shared/WaitlistCountdown'
import { SessionHero } from '../../components/session/SessionHero'
import { SessionInfo } from '../../components/session/SessionInfo'
import { SessionDescription } from '../../components/session/SessionDescription'
import { WeekSlots } from '../../components/session/WeekSlots'
import { BookingModal } from '../../components/session/BookingModal'
import { CancelModal } from '../../components/session/CancelModal'
import { MaxBookingsModal } from '../../components/session/MaxBookingsModal'
import { SuspensionModal } from '../../components/session/SuspensionModal'
import { PaymentRequiredSheet } from '../../components/session/PaymentRequiredSheet'
import { useBookingStore } from '../../stores/useBookingStore'
import { NETWORK_OFFLINE_CODE } from '../../lib/edgeInvoke'
import { captureEvent } from '../../lib/analytics'
import { useGymProfile } from '../../hooks/useGymProfile'
import { formatGymAddress } from '../../lib/gymProfile'
import { supabase } from '../../lib/supabase'
import { useActiveGymId } from '../../lib/activeGym'
import { getDisplayStatus } from '../../utils/slotStatus'
import { formatTime, formatDateStr, toLocalTime } from '../../utils/timezone'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { SEMANTIC } from '../../lib/theme/semantic'
import { useCrossGymGuard } from '../../hooks/useCrossGymGuard'
// GYM-352 — « crédit visible » de la décision B. Ce hook lit DÉJÀ les deux sources
// (crédits à l'unité ET abonnement) et rend `isActive = hasSubscription || hasCredits` :
// c'est exactement la question « le membre a-t-il de quoi réserver ? », et elle répond
// donc aussi pour un abonnement, sans redupliquer le prédicat côté client.
import { useSubscriptionSummary } from '../../hooks/useSubscriptionSummary'
// GYM-352 — l'intention de réservation, posée ICI et nulle part ailleurs (voir handleBook).
import {
  poserBookingIntent,
  lireBookingIntent,
  effacerBookingIntent,
  porteSurCeCreneau,
  effacerSiPaiementMort,
  type BookingIntent,
} from '../../lib/bookingIntent'
// GYM-379 (09/11) — « Payer et réserver » : la décision de réserver d'office, pure et testée.
import {
  accordPourCePaiement,
  doitReserverAutomatiquement,
  issueEchecReservation,
  reserverUneFois,
  type StatutLu,
} from '../../lib/reservationAuto'
// GYM-374 — au retour, on décide sur le statut RÉEL du paiement, plus sur la présence de
// l'intention. Prédicat et lecture PARTAGÉS avec app/payment/success.tsx, pas recopiés.
import { issueDuRetour } from '../../lib/paymentStatus'
import { lireStatutPaiement } from '../../lib/paymentLookup'
import { CrossGymInterstitial } from '../../components/gym/CrossGymInterstitial'
import { raiseNotMemberNotice } from '../../lib/activeGymSession'

export default function SessionDetail() {
  const { tokens } = useTheme()
  // GYM-289 — la salle vient de la source unique (lib/activeGym), plus du build.
  const gymId = useActiveGymId()

  const { t } = useTranslation()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{
    id: string
    activity: string
    date: string
    time: string
    endTime: string
    coach: string
    duration: string
    capacity: string
    booked: string
  }>()

  const { createBooking, cancelBooking, confirmWaitlist, favorites, addFavorite, removeFavorite, isFavorite } = useBookingStore()

  // GYM-216 — identité de la salle (nom + adresse d'exploitation), lue en base.
  const gym = useGymProfile()
  const gymAddress = formatGymAddress(gym)

  const slotId = params.id ?? ''

  // GYM-294 — `null` tant que la requête n'a pas répondu : le garde lit « on ne sait pas
  // encore », jamais « c'est la bonne salle ».
  const [gymDuCreneau, setGymDuCreneau] = useState<string | null>(null)
  const garde = useCrossGymGuard(gymDuCreneau)

  // Slot data — fetched from Supabase, params used as initial fallback only.
  // activityId/startsAt are resolved from the fetch and needed to derive the
  // recurring favorite motif.
  const [slotData, setSlotData] = useState({
    activity: params.activity ?? 'Open Gym',
    activityId: '',
    // GYM-216 — description saisie par le gérant (activities.description). Vide tant
    // que la requête n'a pas répondu : la section reste masquée, jamais un texte générique.
    description: '',
    // GYM-216 — visuel et teinte du cours (activities.image_url / color).
    imageUrl: null as string | null,
    activityColor: null as string | null,
    // GYM-220 — icône choisie par le gérant (activities.icon).
    icon: null as string | null,
    startsAt: '',
    date: params.date ?? '',
    time: params.time ?? '',
    endTime: params.endTime ?? '',
    coach: params.coach ?? '',
    // Les paramètres de navigation ne portent PAS la photo : la fiche s'ouvre avec le nom
    // déjà connu (rendu instantané), et la photo arrive avec la lecture ci-dessous.
    // L'annotation est nécessaire — sans elle l'état est inféré `null` et refuserait
    // l'URL, comme les deux voisins `imageUrl` / `activityColor`.
    coachPhoto: null as string | null,
    duration: Number(params.duration) || 60,
    capacity: Number(params.capacity) || 6,
    booked: Number(params.booked) || 0,
  })

  const { activity, description, imageUrl, activityColor, icon, date, time, endTime, coach, coachPhoto, duration, capacity } = slotData

  const [bookedCount, setBookedCount] = useState(slotData.booked)
  const [loading, setLoading] = useState(false)
  const [bookingModalVisible, setBookingModalVisible] = useState(false)
  const [cancelModalVisible, setCancelModalVisible] = useState(false)
  const [maxBookingsVisible, setMaxBookingsVisible] = useState(false)
  // GYM-196 — limite renvoyée par le serveur (configurable par salle), jamais devinée.
  const [maxBookingsLimit, setMaxBookingsLimit] = useState<number | undefined>(undefined)
  const [paymentRequiredVisible, setPaymentRequiredVisible] = useState(false)
  // GYM-352 — vrai quand une intention VALIDE porte sur CE créneau : le membre est parti
  // acheter pour ce cours-ci et n'a pas encore confirmé. Le bouton change alors de libellé
  // et une ligne le lui rappelle.
  // GYM-379 — l'OBJET, plus seulement un booléen : la réservation automatique a besoin de
  // sa validité et de l'accord du membre (`accordReservation`).
  const [intention, setIntention] = useState<BookingIntent | null>(null)
  const intentionArmee = intention !== null
  // 🔴 GYM-379 — GARDE ANTI-DOUBLE : le créneau pour lequel un appel automatique est parti
  // (ou en vol). Un `ref`, pas un état : il doit être vrai AVANT le prochain rendu, sans
  // quoi deux déclencheurs rapprochés (poll de la feuille + reprise de l'écran) passeraient
  // tous deux. L'idempotence serveur (ALREADY_BOOKED) reste le second filet.
  const tentativeRef = useRef<string | null>(null)
  const [reservationAutoEnCours, setReservationAutoEnCours] = useState(false)
  const [reserveeAutomatiquement, setReserveeAutomatiquement] = useState(false)
  const [ecranVisible, setEcranVisible] = useState(false)
  // 🔴 GYM-379 (relecture) — le statut LU EN BASE du paiement de l'intention. L'accord ne
  // s'exécute que sur CE paiement `paid` : un droit venu d'ailleurs ne réserve jamais.
  const [statutPaiement, setStatutPaiement] = useState<StatutLu | null>(null)
  // GYM-379 — le paiement précédent, transmis à la feuille quand le membre reprend son
  // achat : tant qu'il vit (`open`), elle propose de le REPRENDRE, jamais d'en créer un autre.
  const [paiementPrecedent, setPaiementPrecedent] = useState<{ paymentId: string; checkoutUrl?: string; accord: boolean } | null>(null)
  const { summary: droitsMembre, refresh: rafraichirDroits } = useSubscriptionSummary()
  const [suspensionModal, setSuspensionModal] = useState<{ visible: boolean; until: string | null }>({ visible: false, until: null })
  const [bookingState, setBookingState] = useState<'available' | 'confirmed' | 'waitlisted'>('available')
  const [existingBookingId, setExistingBookingId] = useState<string | null>(null)
  const [waitlistNotifiedAt, setWaitlistNotifiedAt] = useState<string | null>(null)
  const [waitlistConfirmationDeadline, setWaitlistConfirmationDeadline] = useState<string | null>(null)

  // Fetch fresh slot data from Supabase when id changes
  //
  // ⚠️ GYM-292 — LECTURE PAR IDENTIFIANT DE LIGNE, pas par salle : un créneau appartient à
  // une seule salle par construction, la clé `slotId` suffit. La RLS de `time_slots` fait
  // le reste.
  //
  // 🔴 GYM-294 — CE COMMENTAIRE ANNONÇAIT LE DÉFAUT, IL DÉCRIT MAINTENANT LE CORRECTIF.
  // Rien ne vérifiait que le créneau appartenait à la salle ACTIVE : un lien profond vers
  // un créneau d'une autre salle l'affichait sous la marque de la sienne. La requête ramène
  // désormais `gym_id`, et `useCrossGymGuard` tranche — interstitiel, refus, ou rien.
  useEffect(() => {
    if (!slotId) return
    setBookingModalVisible(false)
    setCancelModalVisible(false)

    async function loadSlot() {
      const { data } = await supabase
        .from('time_slots')
        .select(`
          id, gym_id, activity_id, starts_at, ends_at, capacity, bookings_count, status,
          activities(name, duration_min, description, image_url, color, icon),
          coaches(name, photo_url)
        `)
        .eq('id', slotId)
        .single()

      if (data) {
        // 🔴 GYM-294 — LA SALLE DU CRÉNEAU, mémorisée pour le garde. On ne décide RIEN ici :
        // l'écran ne sait pas ce qu'il faut faire d'un créneau d'ailleurs, et cette
        // question a désormais une réponse unique, dans `useCrossGymGuard`.
        setGymDuCreneau((data as { gym_id?: string }).gym_id ?? null)
        const act = data.activities as unknown as {
          name: string
          duration_min: number
          description: string | null
          image_url: string | null
          color: string | null
          icon: string | null
        } | null
        // 🔴 22/09 — `photo_url` EST ENFIN DEMANDÉE. La colonne existait, le dashboard la
        // remplit, et aucune des trois requêtes de l'app ne l'avait jamais réclamée.
        const coa = data.coaches as unknown as { name: string; photo_url: string | null } | null
        const actName = act?.name ?? activity
        const coachName = coa?.name ?? coach
        const dur = act?.duration_min ?? duration

        setSlotData({
          activity: actName,
          activityId: data.activity_id ?? '',
          description: act?.description ?? '',
          imageUrl: act?.image_url ?? null,
          activityColor: act?.color ?? null,
          icon: act?.icon ?? null,
          startsAt: data.starts_at,
          date: formatDateStr(data.starts_at),
          time: formatTime(data.starts_at),
          endTime: formatTime(data.ends_at),
          coach: coachName,
          coachPhoto: coa?.photo_url ?? null,
          duration: dur,
          capacity: data.capacity,
          booked: data.bookings_count ?? 0,
        })
        setBookedCount(data.bookings_count ?? 0)
      }
    }

    async function checkExistingBooking() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setBookingState('available'); return }

      const { data: existing } = await supabase
        .from('bookings')
        .select('id, status, waitlist_notified_at, waitlist_confirmation_deadline')
        .eq('slot_id', slotId)
        .eq('member_id', user.id)
        .in('status', ['confirmed', 'waitlisted'])
        .maybeSingle()

      setExistingBookingId(existing?.id ?? null)
      setWaitlistNotifiedAt(existing?.waitlist_notified_at ?? null)
      setWaitlistConfirmationDeadline(existing?.waitlist_confirmation_deadline ?? null)

      if (existing?.status === 'confirmed') setBookingState('confirmed')
      else if (existing?.status === 'waitlisted') setBookingState('waitlisted')
      else setBookingState('available')
    }

    loadSlot()
    checkExistingBooking()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotId])

  const isFull = bookedCount >= capacity
  // `favorites` in deps so the heart reflects motif membership after changes
  const isFav = useMemo(
    () => isFavorite({ activityId: slotData.activityId, startsAt: slotData.startsAt }),
    [favorites, slotData.activityId, slotData.startsAt, isFavorite],
  )

  // Check if cancellation is < 2h from start
  const isLateCancellation = useMemo(() => {
    if (!date || !time) return false
    const [y, mo, d] = date.split('-').map(Number)
    const [h, m] = time.split(':').map(Number)
    const slotStart = new Date(y, mo - 1, d, h, m)
    return slotStart.getTime() - Date.now() < 2 * 60 * 60 * 1000
  }, [date, time])

  // Format day label
  const days = t('home.days', { returnObjects: true }) as string[]
  const months = t('home.months', { returnObjects: true }) as string[]
  const dayLabel = useMemo(() => {
    if (!date) return ''
    const [y, mo, d] = date.split('-').map(Number)
    const dt = new Date(y, mo - 1, d)
    return `${days[dt.getDay()]} ${d} ${months[dt.getMonth()]}`
  }, [date, days, months])

  // Fetch other slots for same activity (real Supabase)
  const [weekSlots, setWeekSlots] = useState<Array<{ id: string; date: string; time: string; dayLabel: string; available: boolean }>>([])

  useEffect(() => {
    async function fetchOtherSlots() {
      if (!slotId) return
      // ⚠️ Sans salle résolue, on ne requête pas (cf. lib/activeGym).
      if (!gymId) return
      const now = new Date()
      const in14Days = new Date(now)
      in14Days.setDate(in14Days.getDate() + 14)

      const { data } = await supabase
        .from('time_slots')
        .select('id, starts_at, ends_at, capacity, bookings_count, status')
        .eq('gym_id', gymId)
        .neq('id', slotId)
        .neq('status', 'cancelled')
        .gte('starts_at', now.toISOString())
        .lte('starts_at', in14Days.toISOString())
        .order('starts_at')

      if (!data) return

      // Filter same activity by name match (since we don't have activity_id in params)
      // and only keep scheduled slots
      const filtered = data
        .filter((row) => {
          const slotDate = new Date(row.starts_at)
          const slotEndDate = new Date(row.ends_at)
          // Same duration → same activity (Open Gym 120min vs HIIT 60min)
          const dur = Math.round((slotEndDate.getTime() - slotDate.getTime()) / 60000)
          return dur === duration
        })
        .filter((row) => {
          const status = getDisplayStatus({
            date: formatDateStr(row.starts_at),
            time: formatTime(row.starts_at),
            endTime: formatTime(row.ends_at),
          })
          return status === 'scheduled'
        })
        .slice(0, 6)

      setWeekSlots(filtered.map((row) => {
        const localS = toLocalTime(row.starts_at)
        const dayName = days[localS.getDay()] ?? ''
        const monthName = months[localS.getMonth()] ?? ''
        const available = (row.bookings_count ?? 0) < row.capacity
        return {
          id: row.id,
          date: formatDateStr(row.starts_at),
          time: formatTime(row.starts_at),
          dayLabel: `${dayName} ${localS.getDate()} ${monthName}`,
          available,
        }
      }))
    }
    fetchOtherSlots()
    // `gymId` en dépendance : la liste des autres créneaux doit se recharger si la
    // salle change (cf. GYM-289).
  }, [slotId, duration, days, months, gymId])

  const [waitlistPosition, setWaitlistPosition] = useState<number | null>(null)

  // GYM-352 — relecture à CHAQUE reprise de l'écran, pas seulement au montage. Le membre
  // revient ici par trois chemins (deep link, retour manuel, relance du poll) et l'écran
  // reste monté sous le navigateur in-app : un effet au seul montage ne verrait rien.
  useFocusEffect(
    useCallback(() => {
      let vivant = true
      void lireBookingIntent().then(async (intent) => {
        if (!vivant) return
        const armee = porteSurCeCreneau(intent, slotId)
        if (!armee || !intent) { setIntention(null); return }
        // Le crédit vient d'arriver pendant que le membre était sur le navigateur : on
        // relit ses droits, sinon la ligne « tu as X » afficherait l'état d'avant l'achat.
        rafraichirDroits()
        // 🔴 GYM-374b — ET LE STATUT DU PAIEMENT, DANS LE MÊME PASSAGE. Le membre de
        // l'incident n'avait rien tapé : il a LU « Confirmer ma réservation » sur un
        // paiement expiré. Un paiement mort efface l'intention ici, et le bouton revient à
        // « Réserver » sans attendre de geste.
        //
        // ⚠️ LANCÉE EN MÊME TEMPS QUE `rafraichirDroits()`, PAS APRÈS : ce sont deux
        // requêtes (le hook des droits lit `member_credits`/`member_subscriptions`, celle-ci
        // `payments`), mais elles partent ensemble et l'écran n'attend pas plus longtemps.
        //
        // 🔴 GYM-379 (relecture) — ET ELLE EST ATTENDUE AVANT `setIntention`. Poser
        // l'intention d'abord armait le déclencheur de la réservation automatique sur une
        // intention que la ligne suivante pouvait effacer : une course entre les deux.
        //
        // ⚠️ `pending`/`open`/inconnu : RIEN. Le bouton garde son libellé, aucune feuille ne
        // s'ouvre — c'est la sortie « Je n'ai pas payé », au tap, qui tranche.
        const effacee = await effacerSiPaiementMort(intent, lireStatutPaiement)
        if (!vivant) return
        if (effacee) { setIntention(null); setStatutPaiement(null); return }
        const statut = intent.paymentId ? await lireStatutPaiement(intent.paymentId) : null
        if (!vivant) return
        setStatutPaiement(intent.paymentId ? { paymentId: intent.paymentId, statut } : null)
        setIntention(intent)
      })
      return () => { vivant = false }
    }, [slotId, rafraichirDroits]),
  )

  // GYM-352 / GYM-374 — pose l'intention PUIS ouvre la feuille d'achat. Un seul chemin pour
  // le premier achat et pour sa reprise : l'intention reposée ÉCRASE l'ancienne, et avec
  // elle un `paymentId` mort — le prochain achat rattachera le sien.
  //
  // ⚠️ `await` AVANT d'ouvrir la feuille : si l'écriture disque est lente, elle doit avoir
  // eu lieu avant que le membre ne puisse partir acheter.
  const reprendreAchat = useCallback(async () => {
    // 🔴 GYM-379 (relecture) — UN PAIEMENT PRÉCÉDENT ENCORE VIVANT N'EST PAS ÉCRASÉ. Il est
    // transmis à la feuille, qui relit son statut : `open` → « Reprendre le paiement » (le
    // MÊME checkout) ; mort → les options. Reposer l'intention ici effaçait son `paymentId`
    // et la feuille, ne sachant plus rien, proposait un SECOND paiement.
    const avant = await lireBookingIntent()
    const precedent = porteSurCeCreneau(avant, slotId) && avant?.paymentId ? avant : null
    setPaiementPrecedent(precedent?.paymentId
      ? { paymentId: precedent.paymentId, checkoutUrl: precedent.checkoutUrl, accord: accordPourCePaiement(precedent) }
      : null)
    if (precedent) {
      setIntention(precedent)
    } else if (gymId && slotData.startsAt) {
      await poserBookingIntent({ slotId, gymId, startsAt: slotData.startsAt })
      // Relue sur le disque : c'est elle qui fait foi. Repli en mémoire si l'écriture a
      // échoué (best-effort) — le libellé du bouton doit suivre quand même.
      const posee = await lireBookingIntent()
      setIntention(posee ?? { slotId, gymId, startsAt: slotData.startsAt, createdAt: Date.now() })
    }
    setPaymentRequiredVisible(true)
  }, [slotId, gymId, slotData.startsAt])

  const handleBook = useCallback(async () => {
    console.log('[Booking] handleBook called, slotId:', slotId)
    // GYM-379 — un tap manuel occupe la garde : l'appel automatique ne part pas en même temps.
    tentativeRef.current = slotId
    setLoading(true)
    console.log('[Booking] Calling createBooking...')
    const result = await createBooking(slotId)
    console.log('[Booking] Result:', JSON.stringify(result))
    setLoading(false)

    if (!result) return

    if (result.code === 'SUSPENDED') {
      setSuspensionModal({ visible: true, until: result.suspended_until ?? null })
      return
    }
    if (result.code === 'MAX_BOOKINGS_REACHED') {
      setMaxBookingsLimit(result.limit)
      setMaxBookingsVisible(true)
      return
    }
    if (result.code === 'PAYMENT_REQUIRED') {
      // GYM-379 — pas de droit : la garde se libère, l'appel automatique partira quand le
      // droit apparaîtra (« Crédit en route, ton cours est gardé »).
      tentativeRef.current = null
      // ╔═══════════════════════════════════════════════════════════════════════════════╗
      // ║  🔴 GYM-352 — L'INTENTION EST POSÉE ICI, ET NULLE PART AILLEURS              ║
      // ╚═══════════════════════════════════════════════════════════════════════════════╝
      //
      // C'est le SEUL endroit qui voit les deux branches d'achat avant qu'elles ne se
      // séparent : la séance à l'unité (qui reste dans la feuille) et l'abonnement (qui
      // quitte l'écran par `goToSubscription` → `onClose()` puis push vers /profile/
      // subscription, démontant cette fiche). La poser dans la feuille laisserait la
      // seconde branche sans intention.
      //
      // ⚠️ `await` AVANT d'ouvrir la feuille : si l'écriture disque est lente, elle doit
      // avoir eu lieu avant que le membre ne puisse partir acheter.
      // 🔴 ET SURTOUT : NE PAS RENVOYER ACHETER QUELQU'UN QUI VIENT DE PAYER.
      //
      // Sans ce test, le correctif se mordrait la queue : le membre revient du paiement,
      // tape « Confirmer ma réservation », le crédit n'est pas encore arrivé (jusqu'à
      // 2 min 33 s, GYM-207), le serveur rend PAYMENT_REQUIRED — et l'app lui rouvrirait
      // la feuille d'achat. On lui ferait payer deux fois le même cours.
      //
      // ╔═══════════════════════════════════════════════════════════════════════════════╗
      // ║  🔴 GYM-374 — MAIS L'INTENTION NE PROUVE PAS LE PAIEMENT                      ║
      // ╚═══════════════════════════════════════════════════════════════════════════════╝
      //
      // Ce garde concluait « il revient du paiement » sur la SEULE présence de l'intention
      // — or elle est posée AVANT l'achat, juste en dessous. Le 12/10, un membre de Dopamine
      // parti sans payer a lu « Ton paiement est bien enregistré… Ton cours est gardé » :
      // paiement `expired`, 0 crédit, 0 place gardée, et un écran bloqué sur « Confirmer ».
      // L'app bloquait exactement la personne qu'elle devait aider à payer.
      //
      // On décide désormais sur le statut RÉEL, lu par le `paymentId` que les deux chemins
      // d'achat rattachent à l'intention (lib/bookingIntent.ts). Relu SUR LE DISQUE ici, pas
      // pris dans l'état du composant : il a pu être écrit après la dernière reprise.
      if (intentionArmee) {
        setLoading(true)
        const intent = await lireBookingIntent()
        const enCours = porteSurCeCreneau(intent, slotId) ? intent : null
        const statut = enCours?.paymentId ? await lireStatutPaiement(enCours.paymentId) : null
        setLoading(false)

        if (enCours) {
          const issue = issueDuRetour(enCours.paymentId, statut)

          // `paid` — le crédit arrive VRAIMENT. Le message d'origine est vrai : inchangé.
          // L'intention est CONSERVÉE : elle n'a pas été honorée, le membre va réessayer.
          if (issue === 'paye') {
            // GYM-379 — la réservation automatique n'est annoncée que sous l'accord de CE paiement.
            Alert.alert(t('session.intent_pending_title'), t(accordPourCePaiement(enCours) ? 'session.intent_pending_message' : 'session.intent_pending_message_manual'))
            rafraichirDroits()
            return
          }

          // `pending`/`open`, ou statut illisible — ON N'AFFIRME RIEN. Le webhook seul met
          // ce statut à jour : « vient de payer » et « parti sans payer » sont
          // indiscernables pendant la latence. Message au conditionnel, et une SORTIE
          // EXPLICITE : c'est elle qui débloque l'écran. Le membre qui vient de payer n'a
          // rien à faire ; la feuille ne se rouvre que sur SON geste, jamais d'office.
          if (issue === 'ambigu') {
            Alert.alert(t('session.intent_unsure_title'), t('session.intent_unsure_message'), [
              { text: t('session.intent_unsure_wait'), style: 'cancel', onPress: () => rafraichirDroits() },
              { text: t('session.intent_resume_purchase'), onPress: () => { void reprendreAchat() } },
            ])
            return
          }

          // Jamais atteint le paiement, ou paiement mort (failed / canceled / expired) :
          // l'intention de CET achat est effacée — elle ne doit pas survivre à un paiement
          // mort (GYM-352) — et le bouton redevient « Réserver ». La feuille rouvre sur le
          // geste du membre ; `reprendreAchat` repose une intention neuve, sans paiement.
          //
          // ⚠️ PAS D'OUVERTURE DE LA FEUILLE EN MÊME TEMPS QUE L'ALERTE : sur iOS, une
          // alerte et une modale présentées dans le même tour se disputent la présentation
          // et l'une des deux est perdue. Le bouton de l'alerte ouvre la feuille.
          await effacerBookingIntent()
          setIntention(null)
          Alert.alert(t('session.intent_unfinished_title'), t('session.intent_unfinished_message'), [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('session.intent_unfinished_resume'), onPress: () => { void reprendreAchat() } },
          ])
          return
        }
        // L'intention a disparu entre-temps (périmée, effacée par `estValide`, ou par
        // l'écran de vérification sur un échec) : c'est un achat ordinaire, on continue.
        setIntention(null)
      }

      await reprendreAchat()
      return
    }
    // 🔴 GYM-276 — LE DÉFAUT OBSERVÉ EN TEST : réseau coupé, le bouton ne faisait RIEN.
    // Le membre appuie, rien ne se passe, il recommence. Un échec silencieux se lit comme
    // une app cassée — alors que la seule chose à dire tient en une phrase.
    if (result.code === NETWORK_OFFLINE_CODE) {
      Alert.alert(t('common.offline_title'), t('common.offline_message'))
      return
    }
    if (result.status === 'error') return // generic error, logged in store

    if (result.status === 'waitlisted') {
      setWaitlistPosition(result.position ?? 1)
      setBookingState('waitlisted')
      setBookingModalVisible(true)
      return
    }

    // Confirmed
    // GYM-352 — l'intention est consommée, QUEL QUE SOIT le créneau réservé. Le membre a
    // obtenu ce qu'il voulait ; laisser la proposition vivante la ferait ressurgir au
    // prochain lancement, sur un cours qu'il a déjà pris ou abandonné.
    void effacerBookingIntent()
    setIntention(null)
    setBookedCount((c) => c + 1)
    setBookingState('confirmed')
    setBookingModalVisible(true)
  }, [slotId, createBooking, intentionArmee, rafraichirDroits, reprendreAchat, t])

  // ╔═══════════════════════════════════════════════════════════════════════════════════╗
  // ║  🔴 GYM-379 (09/11) — « PAYER ET RÉSERVER » : LA FICHE RÉSERVE D'ELLE-MÊME        ║
  // ╚═══════════════════════════════════════════════════════════════════════════════════╝
  //
  // Décision produit d'Antoine du 09/11, qui revient sur « plus de réservation silencieuse »
  // (GYM-352) : le tap sur « Payer et réserver », sous une phrase qui l'annonce, VAUT
  // ACCORD. C'est ICI, et nulle part ailleurs, qu'on appelle `createBooking` après un achat
  // — que le membre revienne par le poll de la feuille, par le lien profond
  // (payment/success → cette fiche) ou en rouvrant l'app sur la fiche.
  //
  // Le bouton manuel « Confirmer ma réservation » reste : c'est le secours quand l'appel
  // n'a pas pu partir (hors ligne, erreur serveur).

  // Relit l'intention sur le disque — c'est la feuille qui y écrit l'accord, après la pose —
  // ET le statut de son paiement, lu en base.
  const relireIntention = useCallback(async () => {
    const intent = await lireBookingIntent()
    const armee = porteSurCeCreneau(intent, slotId) ? intent : null
    const statut = armee?.paymentId ? await lireStatutPaiement(armee.paymentId) : null
    setStatutPaiement(armee?.paymentId ? { paymentId: armee.paymentId, statut } : null)
    setIntention(armee)
  }, [slotId])

  // L'état RÉEL d'inscription sur ce créneau, relu en base. C'est lui qui parle avant tout
  // message d'échec : un appel « raté » côté app (délai, conflit d'unicité) a pu aboutir côté
  // serveur, et dire « la réservation n'a pas pu partir » à un membre inscrit serait faux.
  const lireReservationExistante = useCallback(async (): Promise<'confirmed' | 'waitlisted' | null> => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return null
      const { data } = await supabase
        .from('bookings')
        .select('id, status')
        .eq('slot_id', slotId)
        .eq('member_id', user.id)
        .in('status', ['confirmed', 'waitlisted'])
        .maybeSingle()
      if (data?.id) setExistingBookingId(data.id)
      return data?.status === 'confirmed' || data?.status === 'waitlisted' ? data.status : null
    } catch {
      return null
    }
  }, [slotId])

  const annoncerReservee = useCallback(() => {
    void effacerBookingIntent()
    setIntention(null)
    setBookingState('confirmed')
    // « Cours réservé ✅ » — dit en clair, pas seulement par le changement du bouton.
    setReserveeAutomatiquement(true)
    setBookingModalVisible(true)
  }, [])

  const reserverAutomatiquement = useCallback(async () => {
    setReservationAutoEnCours(true)
    setLoading(true)
    // 🔴 GYM-379 (relecture) — UNE SEULE FICHE APPELLE, garde au niveau du MODULE. La
    // seconde instance (sous la pile, ou rouverte par le lien profond) attend la même
    // promesse, puis relit l'état réel SANS RIEN AFFICHER : c'est la première qui parle.
    const { premier, promesse } = reserverUneFois(slotId, async () => {
      // ⚠️ RELECTURE AVANT L'APPEL : DISQUE, STATUT DU PAIEMENT ET CAPACITÉ. L'état de
      // l'écran peut dater : le cours a pu se remplir pendant le paiement. Sur un créneau
      // PLEIN, `create-booking` ne refuse pas, il INSCRIT EN LISTE D'ATTENTE — un geste que
      // le membre n'a pas fait.
      const intent = await lireBookingIntent()
      const statut = intent?.paymentId ? await lireStatutPaiement(intent.paymentId) : null
      const { data: frais } = await supabase
        .from('time_slots')
        .select('capacity, bookings_count')
        .eq('id', slotId)
        .maybeSingle()
      const complet = !!frais && (frais.bookings_count ?? 0) >= frais.capacity
      const statutLu = intent?.paymentId ? { paymentId: intent.paymentId, statut } : null
      if (!doitReserverAutomatiquement({
        intent, slotId, droitPresent: true, statutPaiement: statutLu, dejaTente: false,
        coursComplet: complet, dejaInscrit: false, ecranVisible: true,
      })) {
        return { appel: false as const, intent, statutLu, frais }
      }
      try {
        return { appel: true as const, result: await createBooking(slotId), frais }
      } catch {
        return { appel: true as const, result: null, frais }
      }
    })
    const issueAppel = await promesse
    setLoading(false)
    setReservationAutoEnCours(false)
    if (issueAppel.frais) setBookedCount(issueAppel.frais.bookings_count ?? 0)

    if (!premier) {
      // La fiche qui a appelé a déjà tout dit. Ici : l'état réel, en silence.
      const existante = await lireReservationExistante()
      if (existante) { setBookingState(existante); setIntention(null) } else void relireIntention()
      return
    }

    if (!issueAppel.appel) {
      // Complet, paiement pas (encore) `paid`, accord absent : aucun appel. Si c'est le
      // cours plein, la ligne « liste d'attente, ton crédit reste entier » s'affiche, et la
      // liste reste un SECOND GESTE (GYM-352). La garde d'instance reste posée.
      setStatutPaiement(issueAppel.statutLu)
      setIntention(porteSurCeCreneau(issueAppel.intent, slotId) ? issueAppel.intent : null)
      return
    }

    const result = issueAppel.result
    if (result?.status === 'confirmed') {
      setBookedCount((c) => c + 1)
      annoncerReservee()
      return
    }
    if (result?.status === 'waitlisted') {
      // ⚠️ COURSE RÉSIDUELLE : le cours s'est rempli ENTRE la relecture ci-dessus et
      // l'appel. Le serveur a inscrit en liste d'attente (aucun débit). On le DIT — la
      // modale d'attente affiche la position — plutôt que de le laisser découvrir.
      void effacerBookingIntent()
      setIntention(null)
      setWaitlistPosition(result.position ?? 1)
      setBookingState('waitlisted')
      setBookingModalVisible(true)
      return
    }

    // 🔴 GYM-379 (relecture) — AVANT TOUT MESSAGE D'ÉCHEC, L'ÉTAT RÉEL. Un délai, un
    // BOOKING_FAILED ou un conflit d'unicité côté app n'empêchent pas que la réservation
    // existe côté serveur (seconde fiche, idempotence) : on le relit d'abord.
    const existante = await lireReservationExistante()
    if (existante === 'confirmed') { annoncerReservee(); return }
    if (existante === 'waitlisted') {
      void effacerBookingIntent()
      setIntention(null)
      setBookingState('waitlisted')
      return
    }

    const issue = issueEchecReservation(result?.code)
    if (issue === 'deja_inscrit') {
      // La relecture n'a rien vu, le serveur dit « déjà inscrit » : on le croit, sans message.
      void effacerBookingIntent()
      setIntention(null)
      setBookingState(result?.code === 'ALREADY_WAITLISTED' ? 'waitlisted' : 'confirmed')
      return
    }
    if (issue === 'definitif') {
      // Refus du serveur AVANT tout débit (le débit suit la confirmation du siège) : le
      // crédit est intact — c'est le serveur qui le garantit, pas une supposition.
      void effacerBookingIntent()
      setIntention(null)
      Alert.alert(t('session.auto_booking_failed_title'), t('session.auto_booking_failed_message'))
      return
    }
    if (issue === 'credit_en_route') {
      // Le serveur ne voit pas encore le droit. L'intention reste ; la garde aussi, pour ne
      // pas boucler tant que l'app croit au droit — elle se libère quand il disparaît.
      rafraichirDroits()
      return
    }
    // Réessayable : intention gardée, le bouton manuel est le secours.
    if (result?.code === 'SUSPENDED') {
      setSuspensionModal({ visible: true, until: result.suspended_until ?? null })
      return
    }
    if (result?.code === 'MAX_BOOKINGS_REACHED') {
      setMaxBookingsLimit(result.limit)
      setMaxBookingsVisible(true)
      return
    }
    if (result?.code === NETWORK_OFFLINE_CODE) {
      Alert.alert(t('common.offline_title'), t('common.offline_message'))
      return
    }
    // ⚠️ AUCUNE AFFIRMATION SUR LE CRÉDIT : sur une erreur générique ou un délai, l'app ne
    // sait pas ce que le serveur a fait du solde. Le message dit seulement quoi faire.
    Alert.alert(t('common.error'), t('session.auto_booking_retry_message'))
  }, [slotId, createBooking, rafraichirDroits, relireIntention, lireReservationExistante, annoncerReservee, t])

  // LE DÉCLENCHEUR UNIQUE. Il voit passer tous les chemins : le droit qui apparaît (poll de
  // la feuille → `onClose` → relecture), l'intention relue à la reprise de l'écran, etc.
  useEffect(() => {
    if (!doitReserverAutomatiquement({
      intent: intention,
      slotId,
      droitPresent: droitsMembre.isActive,
      statutPaiement,
      dejaTente: tentativeRef.current === slotId,
      coursComplet: isFull,
      dejaInscrit: bookingState !== 'available',
      ecranVisible,
    })) return
    tentativeRef.current = slotId
    void reserverAutomatiquement()
  }, [intention, slotId, droitsMembre.isActive, statutPaiement, isFull, bookingState, ecranVisible, reserverAutomatiquement])

  // Le droit a disparu (ou n'est pas encore là) : la garde se libère, pour qu'un
  // PAYMENT_REQUIRED d'avant n'empêche pas l'appel quand le crédit arrivera.
  useEffect(() => {
    if (!droitsMembre.isActive && !reservationAutoEnCours) tentativeRef.current = null
  }, [droitsMembre.isActive, reservationAutoEnCours])

  useFocusEffect(
    useCallback(() => {
      setEcranVisible(true)
      return () => setEcranVisible(false)
    }, []),
  )

  // 🔴 LE DROIT — ET LE STATUT DU PAIEMENT — SONT RELUS TANT QU'ILS MANQUENT. Sans cela, un
  // membre qui a fermé la feuille (« Annuler », retour Android, attente expirée) resterait
  // devant une fiche qui ne saurait jamais que son crédit est arrivé : la fiche ne perd pas
  // le focus sous une modale, `useFocusEffect` ne repasse pas. Plafond de 5 min — celui de
  // la feuille et de l'écran de vérification (GYM-207) — puis le retour au premier plan
  // prend le relais.
  const accordEnAttente = accordPourCePaiement(intention)
    && (!droitsMembre.isActive || statutPaiement?.statut !== 'paid')
  useEffect(() => {
    if (!accordEnAttente || !ecranVisible || paymentRequiredVisible) return
    let tours = 0
    const id = setInterval(() => {
      tours++
      rafraichirDroits()
      void relireIntention()
      if (tours >= 60) clearInterval(id) // 60 × 5 s = 5 min
    }, 5000)
    return () => clearInterval(id)
  }, [accordEnAttente, ecranVisible, paymentRequiredVisible, rafraichirDroits, relireIntention])

  // Retour au premier plan (navigateur fermé, app rouverte) : intention, statut et droit relus.
  useEffect(() => {
    if (!intentionArmee || !ecranVisible) return
    const sub = AppState.addEventListener('change', (etat) => {
      if (etat !== 'active') return
      void relireIntention()
      rafraichirDroits()
    })
    return () => sub.remove()
  }, [intentionArmee, ecranVisible, relireIntention, rafraichirDroits])

  const handleCancel = useCallback(async () => {
    // 🔴 GYM-276 — `cancelBooking` LÈVE (EdgeError) et RIEN ne l'attrapait : hors ligne,
    // l'annulation produisait une promesse rejetée non gérée, la modale restait ouverte et
    // le membre n'apprenait rien. Même défaut que le bouton de réservation, sur l'autre
    // moitié du parcours.
    try {
      await cancelBooking(slotId)
    } catch (e) {
      const code = (e as { code?: string } | null)?.code
      Alert.alert(
        code === NETWORK_OFFLINE_CODE ? t('common.offline_title') : t('common.error'),
        code === NETWORK_OFFLINE_CODE ? t('common.offline_message') : t('session.cancel_failed'),
      )
      return
    }
    setBookedCount((c) => Math.max(0, c - 1))
    setBookingState('available')
    setExistingBookingId(null)
    setWaitlistNotifiedAt(null)
    setWaitlistConfirmationDeadline(null)
    setCancelModalVisible(false)
  }, [slotId, cancelBooking, t])

  const handleConfirmWaitlist = useCallback(async () => {
    if (!existingBookingId) return
    setLoading(true)
    const result = await confirmWaitlist(existingBookingId)
    setLoading(false)

    if (result.confirmed) {
      setBookingState('confirmed')
      setBookedCount((c) => c + 1)
      setWaitlistNotifiedAt(null)
      return
    }

    if (result.code === NETWORK_OFFLINE_CODE) {
      Alert.alert(t('common.offline_title'), t('common.offline_message'))
      return
    }

    // GYM-273 — le délai de confirmation s'est écoulé : la place est repartie au suivant.
    // Mesuré ici parce que c'est le seul endroit où l'app l'apprend (le serveur l'a déjà
    // fait expirer), et c'est le contre-pied exact de `waitlist_promoted`.
    if (result.code === 'WAITLIST_EXPIRED') {
      captureEvent('waitlist_expired')
      Alert.alert(t('session.waitlist_expired_title'), t('session.waitlist_expired_message'))
      setBookingState('available')
      setExistingBookingId(null)
      setWaitlistNotifiedAt(null)
      setWaitlistConfirmationDeadline(null)
    }
  }, [existingBookingId, confirmWaitlist, t])

  const isNotified = (() => {
    if (bookingState !== 'waitlisted' || waitlistNotifiedAt === null) return false
    const deadline = waitlistConfirmationDeadline
      ? new Date(waitlistConfirmationDeadline).getTime()
      : new Date(waitlistNotifiedAt).getTime() + 30 * 60 * 1000
    return Date.now() < deadline
  })()

  const toggleFav = useCallback(() => {
    const input = { activityId: slotData.activityId, startsAt: slotData.startsAt }
    if (isFav) removeFavorite(input)
    else addFavorite(input)
  }, [isFav, slotData.activityId, slotData.startsAt, addFavorite, removeFavorite])

  // ═══════════════════════════════════════════════════════════════════════════════════
  // 🔴 GYM-294 — LES TROIS ISSUES D'UN CRÉNEAU QUI N'EST PAS DE LA SALLE ACTIVE
  // ═══════════════════════════════════════════════════════════════════════════════════
  // Elles précèdent tout rendu : afficher l'écran puis le remplacer ferait apparaître, une
  // fraction de seconde, le cours d'une autre salle sous la marque de celle-ci — c'est-à-dire
  // exactement le défaut qu'on corrige, en plus bref et donc en plus difficile à signaler.
  //
  // ⚠️ EN SINGLE, `garde.kind` VAUT TOUJOURS 'ok' : le hook sort à sa première ligne, sans
  // état ni requête. Ces deux branches sont donc inertes chez Dopamine — aucun détour, aucun
  // aller-retour réseau ajouté.

  // Membre de la salle du créneau : on annonce, il décide. Jamais de bascule silencieuse.
  if (garde.kind === 'elsewhere') {
    return (
      <CrossGymInterstitial
        gym={garde.gym}
        onCancel={() => router.back()}
        // Après bascule, l'écran se recharge avec la nouvelle salle active : le garde
        // repasse à 'ok' et le créneau s'affiche sous SA marque, qui est désormais la bonne.
        onSwitched={() => setGymDuCreneau(null)}
      />
    )
  }

  // Pas membre : on réutilise l'écran de refus de GYM-301 plutôt que d'en écrire un second.
  // ⚠️ L'AVIS EST POSÉ AVANT DE NAVIGUER, sans quoi l'écran s'ouvrirait les mains vides —
  // c'est la mécanique de GYM-301, et elle est faite pour être alimentée d'ici.
  if (garde.kind === 'not_member') {
    // ⚠️ ON NE CONNAÎT QUE L'IDENTIFIANT DE LA SALLE, PAS SON SLUG — et il n'est pas
    // récupérable : la RLS de `nexxia_gyms` n'expose une salle qu'à ses membres, et c'est
    // exactement le cas où le membre n'en est pas un. L'avis part donc sans marque ni slug,
    // et l'écran de GYM-301 rend sa formulation « sans nom » : « Tu n'es pas encore membre
    // de cette salle ». Inventer un nom serait pire que de ne pas en donner.
    raiseNotMemberNotice({ requested: null, requestedSlug: '', landed: gym?.name ?? '' })
    router.replace('/gym/not-member' as never)
    return null
  }

  return (
    <View className="flex-1" style={{ backgroundColor: tokens.page }}>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <SessionHero
          activity={activity}
          imageUrl={imageUrl}
          activityColor={activityColor}
          icon={icon}
          onBack={() => router.back()}
          isFavorite={isFav}
          onToggleFavorite={toggleFav}
        />

        {/* Info chips + progress */}
        <SessionInfo
          time={time}
          endTime={endTime}
          coach={coach}
          coachPhoto={coachPhoto}
          booked={bookedCount}
          capacity={capacity}
        />

        <View className="h-2" />

        {/* Description — GYM-216 : activities.description. Le composant ne rend rien
            si elle est vide ; l'espaceur suit la même condition pour ne pas laisser
            un double blanc à la place de la section. */}
        {description.trim().length > 0 && (
          <>
            <SessionDescription description={description} />
            <View className="h-2" />
          </>
        )}

        {/* Location — GYM-216 : nom + adresse d'EXPLOITATION lus dans nexxia_gyms.
            Bloc entièrement masqué si l'adresse est indisponible : mieux vaut ne rien
            afficher qu'envoyer le membre à une adresse périmée (celle en dur dans les
            locales pointait encore sur Neupré, alors que la salle est à Ougrée).
            ⚠️ Jamais legal_address — siège social, factures uniquement (GYM-180). */}
        {gymAddress && (
          <>
            <View className="px-5 py-4" style={{ backgroundColor: tokens.surface }}>
              <Text className="mb-2 font-dmsans-bold text-[11px] uppercase tracking-wider" style={{ color: tokens.onBackgroundMuted }}>
                {t('session.location')}
              </Text>
              <View className="flex-row items-center gap-2">
                <MapPin size={16} color={tokens.onSurfaceSecondary} />
                <View className="flex-1">
                  {gym?.name && (
                    <Text className="font-dmsans-bold text-sm" style={{ color: tokens.onSurface }}>
                      {gym.name}
                    </Text>
                  )}
                  <Text className="font-dmsans text-xs" style={{ color: tokens.onSurfaceSecondary }}>
                    {gymAddress}
                  </Text>
                </View>
              </View>
            </View>

            <View className="h-2" />
          </>
        )}

        {/* Other slots this week */}
        <WeekSlots
          slots={weekSlots}
          selectedId={slotId}
          onSelect={(selectedSlotId) => {
            const selected = weekSlots.find((s) => s.id === selectedSlotId)
            if (!selected) return
            router.replace({
              pathname: '/session/[id]',
              params: {
                id: selectedSlotId,
                activity,
                date: selected.date,
                time: selected.time,
                endTime: '',
                coach,
                duration: String(duration),
                capacity: String(capacity),
                booked: '0',
              },
            } as never)
          }}
        />

        {/* Bottom spacer for footer */}
        <View className="h-24" />
      </ScrollView>

      {/* Sticky footer */}
      <View
        className="absolute bottom-0 left-0 right-0 border-t px-5"
        style={{ borderColor: tokens.border, backgroundColor: tokens.surface, paddingBottom: insets.bottom + 16, paddingTop: 16 }}
      >
        {isNotified && waitlistConfirmationDeadline && (
          <View className="mb-3">
            <WaitlistCountdown
              deadline={waitlistConfirmationDeadline}
              onExpire={() => {
                setBookingState('available')
                setExistingBookingId(null)
                setWaitlistNotifiedAt(null)
                setWaitlistConfirmationDeadline(null)
              }}
            />
          </View>
        )}

        {/* 🔴 GYM-352 — LE CRÉDIT EST VISIBLE AU MOMENT DE CONFIRMER.
            Le membre revient d'un achat fait POUR CE COURS : lui montrer ce qu'il vient
            d'obtenir, juste au-dessus du bouton, est ce qui transforme « j'ai payé, et
            après ? » en un geste évident. `droitsMembre.detail` couvre les deux cas —
            « 1 séance » comme « Illimité jusqu'au 12/10 ». */}
        {intentionArmee && droitsMembre.isActive && droitsMembre.detail && (
          <View className="mb-3 rounded-xl px-3 py-2" style={{ backgroundColor: tokens.actionBg + '1A' }}>
            <Text className="font-dmsans text-xs" style={{ color: tokens.onSurface }}>
              {/* 🔴 GYM-352 — LE COURS S'EST REMPLI PENDANT LE PAIEMENT. Le membre vient
                  de payer : le renvoyer au planning lui ferait perdre le cours ET le fil.
                  On lui propose la liste d'attente comme SECOND GESTE explicite (le bouton
                  dit déjà « LISTE D'ATTENTE » quand `isFull`), et on lui dit les deux
                  choses qu'il a besoin de savoir.

                  ⚠️ LE DÉLAI VIENT DE LA SALLE, jamais 30 en dur : `notify-waitlist` lit
                  `gym.waitlist_confirmation_minutes ?? 30`, configurable par salle. Si on
                  ne le connaît pas encore, on ne l'annonce pas — la variante sans délai.

                  ✅ ET LE CRÉDIT RESTE ENTIER : `create-booking` le dit explicitement —
                  « le débit du crédit est déplacé APRÈS la confirmation du siège. Aucun
                  débit ici, ni sur le chemin waitlist ». Le membre vient de payer, il doit
                  savoir qu'il ne perd rien en s'inscrivant sur la liste. */}
              {isFull
                ? gym?.waitlistConfirmationMinutes
                  ? t('session.intent_full_waitlist', { minutes: gym.waitlistConfirmationMinutes })
                  : t('session.intent_full_waitlist_nodelay')
                : reservationAutoEnCours
                  // GYM-379 — l'appel automatique est en vol : on dit ce qui se passe.
                  ? t('session.auto_booking_in_progress', { detail: droitsMembre.detail })
                  : t('session.intent_credit_ready', { detail: droitsMembre.detail })}
            </Text>
          </View>
        )}

        <View className="flex-row items-center">
          <View className="flex-1">
            <Text className="font-dmsans-bold text-sm" style={{ color: tokens.onSurface }}>
              {dayLabel} {time ? `· ${time}` : ''}
            </Text>
            <Text className="font-dmsans text-xs" style={{ color: tokens.onBackgroundMuted }}>
              {activity} · {t('home.duration_min', { duration })}
            </Text>
          </View>

          {bookingState === 'confirmed' ? (
            <TouchableOpacity
              onPress={() => setCancelModalVisible(true)}
              activeOpacity={0.8}
              className="rounded-xl border-2 px-6 py-3.5"
              style={{ borderColor: SEMANTIC.danger }}
            >
              <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 16, color: SEMANTIC.danger }}>
                {t('session.cancel').toUpperCase()}
              </Text>
            </TouchableOpacity>
          ) : bookingState === 'waitlisted' && isNotified ? (
            <TouchableOpacity
              onPress={handleConfirmWaitlist}
              disabled={loading}
              activeOpacity={0.8}
              style={{ backgroundColor: tokens.actionBg }} className="rounded-xl px-6 py-3.5"
            >
              {loading ? (
                <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 16, color: tokens.onAction }}>...</Text>
              ) : (
                <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 16, color: tokens.onAction }}>
                  {t('session.confirm_my_place').toUpperCase()}
                </Text>
              )}
            </TouchableOpacity>
          ) : bookingState === 'waitlisted' ? (
            <TouchableOpacity
              onPress={() => setCancelModalVisible(true)}
              activeOpacity={0.8}
              className="rounded-xl border-2 px-6 py-3.5"
              style={{ borderColor: SEMANTIC.warning }}
            >
              <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 16, color: SEMANTIC.warning }}>
                {t('session.quit_waitlist').toUpperCase()}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={handleBook}
              disabled={loading}
              activeOpacity={0.8}
              // reste en classe. La branche `bg-orange-500` est un SIGNAL (liste d'attente)
              // et pourrait passer à `SEMANTIC.warning` — mais le ternaire porte les deux
              // dans la même chaîne : les séparer inverserait l'ordre des couleurs du
              // fichier sans rien gagner tant que l'autre branche ne peut pas bouger.
              // ⚠️ `bg-orange-500` VAUT EXACTEMENT #F97316, c'est-à-dire `SEMANTIC.warning` — ce
              // n'est pas une approximation mais la MÊME valeur, donc une migration licite
              // (règle absolue de 286b : on ne migre que sur une égalité exacte).
              style={{ backgroundColor: isFull ? SEMANTIC.warning : tokens.actionBg }}
              className="rounded-xl px-6 py-3.5"
            >
              {loading ? (
                <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 16, color: tokens.onAction }}>...</Text>
              ) : (
                <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 16, color: isFull ? '#FFFFFF' : tokens.onAction }}>
                  {/* GYM-352 — « CONFIRMER MA RÉSERVATION » quand le membre revient d'un
                      achat fait POUR CE COURS. Le geste reste le même (handleBook, donc
                      create_booking_atomic inchangé) ; c'est le libellé qui cesse de
                      faire croire qu'il recommence à zéro. Le cas « complet » garde son
                      libellé de liste d'attente : il prime, c'est l'état du cours. */}
                  {isFull
                    ? t('session.waitlist').toUpperCase()
                    : intentionArmee
                      ? t('session.confirm_booking').toUpperCase()
                      : t('session.enroll').toUpperCase()}
                </Text>
              )}
            </TouchableOpacity>
          )}
        </View>

        {isNotified && (
          <TouchableOpacity
            onPress={() => setCancelModalVisible(true)}
            activeOpacity={0.7}
            className="mt-3 self-center"
          >
            <Text className="font-dmsans-bold text-xs underline" style={{ color: tokens.onBackgroundMuted }}>
              {t('session.decline')}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Booking success modal */}
      <BookingModal
        visible={bookingModalVisible}
        activity={activity}
        date={dayLabel}
        time={time}
        waitlistPosition={waitlistPosition}
        confirmedTitle={reserveeAutomatiquement ? t('session.auto_booked_title') : undefined}
        onViewBookings={() => {
          setBookingModalVisible(false)
          setWaitlistPosition(null)
          setReserveeAutomatiquement(false)
          router.replace('/(tabs)/bookings')
        }}
        onClose={() => {
          setBookingModalVisible(false)
          setWaitlistPosition(null)
          setReserveeAutomatiquement(false)
        }}
      />

      {/* Cancel confirmation modal */}
      <CancelModal
        visible={cancelModalVisible}
        isLate={isLateCancellation}
        onConfirm={handleCancel}
        onClose={() => setCancelModalVisible(false)}
      />

      <MaxBookingsModal
        visible={maxBookingsVisible}
        limit={maxBookingsLimit}
        onViewBookings={() => {
          setMaxBookingsVisible(false)
          router.replace('/(tabs)/bookings' as never)
        }}
        onClose={() => setMaxBookingsVisible(false)}
      />

      <SuspensionModal
        visible={suspensionModal.visible}
        suspendedUntil={suspensionModal.until}
        onClose={() => setSuspensionModal({ visible: false, until: null })}
      />

      <PaymentRequiredSheet
        visible={paymentRequiredVisible}
        slotId={slotId}
        paiementPrecedent={paiementPrecedent}
        onClose={() => {
          setPaymentRequiredVisible(false)
          // GYM-379 — la feuille rend la main (droit vu par sa boucle, ou membre qui ferme) :
          // on relit l'intention — l'accord y a été écrit après la pose — et le droit. Si
          // les deux sont là, le déclencheur ci-dessus réserve.
          void relireIntention()
          rafraichirDroits()
        }}
        context={isFull ? 'waitlist' : 'book'}
      />
    </View>
  )
}
