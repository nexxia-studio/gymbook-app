// GYM-389 — MISE À JOUR OBLIGATOIRE : quand la version installée est sous la version
// minimale déclarée en base (`app_version_policy`), l'écran « Mise à jour requise » prend
// toute l'app.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// 🔴 L'ÉCRAN NE SORT QUE SUR UNE LECTURE RÉUSSIE
// ─────────────────────────────────────────────────────────────────────────────────────
// Cet écran n'a aucune issue. Erreur, hors ligne, délai dépassé, ligne absente, version
// illisible : RIEN ne s'affiche (`doitForcerMiseAJour`, lib/versionMinimale.ts, testée
// seule). La lecture ne retient pas non plus le démarrage : l'app se monte normalement
// pendant qu'elle court, et n'est recouverte que si la réponse le demande.
//
// ⚠️ UNE RELECTURE EN ÉCHEC N'EFFACE PAS UNE LECTURE RÉUSSIE. Sans cela, passer en mode
// avion puis revenir au premier plan ferait disparaître l'écran : le contournement serait
// à un geste. Le doute ne bloque pas — mais il ne débloque pas non plus ce qu'une lecture
// réussie a établi. Un démarrage à froid hors ligne, lui, n'a aucune lecture réussie : pas
// de blocage.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// 🔴 ICI, `children` EST DÉMONTÉ — L'INVERSE DE ProfileCompletionGate, ET C'EST VOULU
// ─────────────────────────────────────────────────────────────────────────────────────
// « Complète ton profil » se superpose et laisse l'arbre monté, pour ne pas tuer un
// paiement en cours. Une superposition ne suffit pas ici : une `<Modal>` déjà ouverte
// dessous est présentée par le système AU-DESSUS de n'importe quelle vue, et resterait
// utilisable. Bloqué, l'arbre n'existe donc plus — ni route, ni modale, ni porte légale,
// ni « Complète ton profil » : il n'y a rien à atteindre, donc rien à contourner.
// ⚠️ Le démontage n'a lieu QUE sur une décision de blocage, jamais pendant la lecture :
// tant qu'on ne sait pas, l'arbre reste monté (le défaut de la porte légale, qui démonte
// pendant son aller-retour, n'est pas reproduit).
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AppState, Linking, Platform } from 'react-native'
import * as Application from 'expo-application'
import * as Sentry from '@sentry/react-native'
import { supabase } from '../../lib/supabase'
import {
  DELAI_LECTURE_MS, doitForcerMiseAJour, doitRelirePolitique, urlsStore,
  type EtatLecturePolitique, type PolitiqueVersion,
} from '../../lib/versionMinimale'
import { UpdateRequiredScreen } from './UpdateRequiredScreen'

// L'identifiant de la variante EN COURS (be.dopamineclub.app, app.viniz.staging,
// app.viniz) et la version marketing, lus du binaire — pas d'une constante du code, qui
// dirait la même chose pour les trois apps. `null` sur le web : aucune lecture, aucun écran.
const BUNDLE = Application.applicationId
const VERSION_APP = Application.nativeApplicationVersion
const PLATEFORME = Platform.OS

interface Lecture {
  etat: EtatLecturePolitique
  politique: PolitiqueVersion | null
}

type Issue = { type: 'lue'; politique: PolitiqueVersion | null } | { type: 'echec' }

let refusServeurSignale = false

/** Un seul SELECT. Tout ce qui n'est pas une réponse lisible est un échec. */
async function lirePolitique(bundle: string): Promise<Issue> {
  try {
    const { data, error } = await supabase
      .from('app_version_policy')
      .select('min_version, store_url')
      .eq('bundle_id', bundle)
      .eq('platform', PLATEFORME)
      .maybeSingle()
    if (error) {
      // Un refus du SERVEUR porte un code (table absente, droit manquant) : il remonte,
      // une fois par lancement. Une coupure réseau n'en porte pas.
      if (error.code && !refusServeurSignale) {
        refusServeurSignale = true
        Sentry.captureException(error, { tags: { area: 'gym389_version_policy_read' } })
      }
      return { type: 'echec' }
    }
    if (!data) return { type: 'lue', politique: null }
    if (typeof data.min_version !== 'string') return { type: 'echec' }
    return {
      type: 'lue',
      politique: {
        minVersion: data.min_version,
        storeUrl: typeof data.store_url === 'string' ? data.store_url : null,
      },
    }
  } catch {
    return { type: 'echec' }
  }
}

/** La lecture, bornée : passé le délai, abandon silencieux. */
function lireAvecDelai(bundle: string): Promise<Issue> {
  return new Promise<Issue>((resolve) => {
    const minuteur = setTimeout(() => resolve({ type: 'echec' }), DELAI_LECTURE_MS)
    void lirePolitique(bundle).then((issue) => { clearTimeout(minuteur); resolve(issue) })
  })
}

export function UpdateRequiredGate({ children }: { children: ReactNode }) {
  const [lecture, setLecture] = useState<Lecture>({ etat: 'non_charge', politique: null })
  const derniereLecture = useRef<number | null>(null)
  const enCours = useRef(false)
  const [opening, setOpening] = useState(false)
  const [openFailed, setOpenFailed] = useState(false)

  const bloque = doitForcerMiseAJour(VERSION_APP, lecture.politique, lecture.etat)
  const bloqueRef = useRef(bloque)
  bloqueRef.current = bloque

  const lire = useCallback(async () => {
    if (!BUNDLE || (PLATEFORME !== 'ios' && PLATEFORME !== 'android')) return
    if (enCours.current) return
    enCours.current = true
    derniereLecture.current = Date.now()
    const issue = await lireAvecDelai(BUNDLE)
    enCours.current = false
    if (issue.type === 'lue') {
      setLecture({ etat: 'charge', politique: issue.politique })
    } else {
      // Un échec ne remplace PAS une lecture réussie (voir l'en-tête).
      setLecture((l) => (l.etat === 'charge' ? l : { etat: 'erreur', politique: null }))
    }
  }, [])

  // Au démarrage : ce composant est monté au-dessus de toutes les portes, avant la connexion.
  useEffect(() => { void lire() }, [lire])

  // Au retour au premier plan, au plus une fois toutes les 10 min — sauf écran affiché.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (etat) => {
      if (etat !== 'active') return
      if (doitRelirePolitique(derniereLecture.current, Date.now(), bloqueRef.current)) void lire()
    })
    return () => sub.remove()
  }, [lire])

  const storeUrl = lecture.politique?.storeUrl ?? null
  const ouvrirStore = useCallback(async () => {
    setOpening(true)
    setOpenFailed(false)
    let ouvert = false
    for (const url of urlsStore(PLATEFORME, BUNDLE, storeUrl)) {
      try {
        await Linking.openURL(url)
        ouvert = true
        break
      } catch {
        // schéma non pris en charge sur cet appareil (pas de Play Store, pas de TestFlight) :
        // on essaie le repli suivant.
      }
    }
    setOpening(false)
    setOpenFailed(!ouvert)
  }, [storeUrl])

  if (bloque) return <UpdateRequiredScreen onUpdate={ouvrirStore} opening={opening} openFailed={openFailed} />
  return <>{children}</>
}
