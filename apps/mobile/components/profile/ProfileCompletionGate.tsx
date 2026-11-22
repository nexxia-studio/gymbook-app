// GYM-387 — LE TÉLÉPHONE EST OBLIGATOIRE : tant que `profiles.phone` est vide, l'écran
// « Complète ton profil » recouvre l'app. Il couvre les deux populations que le formulaire
// d'inscription ne voit pas : les comptes Apple / Google (aucun téléphone transmis) et les
// membres existants. Elle ne concerne QUE le rôle `member` (voir `doitCompleterProfil`).
//
// ─────────────────────────────────────────────────────────────────────────────────────
// 🔴 L'ÉCRAN NE SORT QUE SUR UNE LECTURE RÉUSSIE — L'INVERSE DE LA PORTE LÉGALE
// ─────────────────────────────────────────────────────────────────────────────────────
// `LegalAcceptanceGate` bloque sur une lecture en échec : laisser passer ferait du mode
// avion le contournement d'un consentement. Ici la règle est RENVERSÉE, et c'est voulu :
// un numéro de téléphone manquant n'est pas une faute, et prendre une coupure réseau pour
// « téléphone vide » enfermerait un membre en règle derrière un écran sans « Plus tard »
// (même famille que GYM-385). Profil pas encore lu, erreur, ligne absente → RIEN.
// La décision est dans `doitCompleterProfil` (lib/profilComplet.ts), testée seule.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// 🔴 L'ÉCRAN EST SUPERPOSÉ, `children` RESTE MONTÉ
// ─────────────────────────────────────────────────────────────────────────────────────
// Remplacer `children` démonterait tout l'arbre de navigation au moment où la lecture
// répond — donc toutes les `<Modal>`, et tout navigateur de paiement présenté par-dessus
// (le mode de panne étudié dans GYM-352). L'écran est donc posé AU-DESSUS, en plein
// cadre : il prend tous les gestes, et l'arbre dessous est retiré de l'accessibilité.
// Un lien profond ou un tap de notification navigue dessous et apparaît une fois le
// profil complété — il ne contourne rien.
//
// ⚠️ LA LECTURE VIT DANS UN HOOK APPELÉ PAR LA RACINE, pas ici : ce composant est monté
// SOUS la porte légale, qui attend son propre aller-retour. Lancées ensemble, les deux
// lectures ont en général répondu quand la porte s'ouvre — l'accueil n'a pas le temps
// d'apparaître avant l'écran.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AppState, StyleSheet, View } from 'react-native'
import * as Sentry from '@sentry/react-native'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/useAuthStore'
import {
  doitCompleterProfil, estEmailRelaisApple,
  type EtatLectureProfil, type ProfilContact,
} from '../../lib/profilComplet'
import { CompleteProfileScreen } from './CompleteProfileScreen'

interface Lecture {
  /** Le compte que cette lecture décrit. Une réponse arrivée pour un AUTRE compte ne vaut rien. */
  pour: string | null
  etat: EtatLectureProfil
  profil: ProfilContact | null
}

export interface LectureProfilContact {
  etat: EtatLectureProfil
  profil: ProfilContact | null
  /** Pose le téléphone qui vient d'être ENREGISTRÉ : l'écran se ferme sans relecture. */
  marquerComplete: (phone: string, contactEmail: string | null) => void
}

const NON_CHARGE: Lecture = { pour: null, etat: 'non_charge', profil: null }

export function useLectureProfilContact(userId: string | null): LectureProfilContact {
  const [lecture, setLecture] = useState<Lecture>(NON_CHARGE)
  const courant = useRef(userId)
  courant.current = userId

  const lire = useCallback(async () => {
    if (!userId) { setLecture(NON_CHARGE); return }
    let suivant: Lecture
    try {
      // ⚠️ REQUÊTE À PART, et non une colonne de plus dans `refreshProfile` : si
      // `contact_email` manque en base (migration pas encore appliquée), c'est CETTE lecture
      // qui échoue — donc aucun écran — et pas le chargement du profil entier.
      const { data, error } = await supabase
        .from('profiles')
        .select('role, phone, email, contact_email')
        .eq('id', userId)
        .maybeSingle()
      if (error) {
        // Un refus du SERVEUR porte un code (colonne absente, droit manquant) : il doit
        // remonter. Une coupure réseau n'en porte pas, et n'apprend rien à personne.
        if (error.code) Sentry.captureException(error, { tags: { area: 'gym387_profile_completion_read' } })
        suivant = { pour: userId, etat: 'erreur', profil: null }
      } else {
        suivant = {
          pour: userId,
          etat: 'charge',
          profil: data
            ? { role: data.role, phone: data.phone, email: data.email, contactEmail: data.contact_email }
            : null,
        }
      }
    } catch {
      suivant = { pour: userId, etat: 'erreur', profil: null }
    }
    if (courant.current === userId) setLecture(suivant)
  }, [userId])

  useEffect(() => { void lire() }, [lire])

  // Hors ligne au lancement : la lecture a échoué, personne n'est bloqué — et personne
  // n'est sollicité non plus. On la rejoue au retour au premier plan, tant qu'elle n'a
  // pas réussi ; une lecture réussie n'est jamais rejouée.
  const enErreur = lecture.pour === userId && lecture.etat === 'erreur'
  useEffect(() => {
    if (!enErreur) return
    const sub = AppState.addEventListener('change', (etat) => { if (etat === 'active') void lire() })
    return () => sub.remove()
  }, [enErreur, lire])

  const marquerComplete = useCallback((phone: string, contactEmail: string | null) => {
    setLecture((l) => (l.profil ? { ...l, profil: { ...l.profil, phone, contactEmail: contactEmail ?? l.profil.contactEmail } } : l))
  }, [])

  // Une lecture faite pour un autre compte (changement d'utilisateur en cours) est « non chargée ».
  const aJour = lecture.pour === userId
  return {
    etat: aJour ? lecture.etat : 'non_charge',
    profil: aJour ? lecture.profil : null,
    marquerComplete,
  }
}

function estCoupureReseau(err: { message?: string; code?: string }): boolean {
  if (err.code) return false
  return /network|fetch|timeout|connexion/i.test(err.message ?? '')
}

export function ProfileCompletionGate({ lecture, children }: { lecture: LectureProfilContact; children: ReactNode }) {
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const signOut = useAuthStore((s) => s.signOut)
  const refreshProfile = useAuthStore((s) => s.refreshProfile)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const bloque = !!userId && doitCompleterProfil(lecture.profil, lecture.etat)
  const { marquerComplete } = lecture

  const enregistrer = useCallback(async ({ phone, contactEmail }: { phone: string; contactEmail: string | null }) => {
    if (!userId) return
    setSubmitting(true)
    setError(null)
    let echec: { message?: string; code?: string } | null = null
    try {
      const res = await supabase.from('profiles').update({ phone }).eq('id', userId)
      echec = res.error
    } catch (e) {
      echec = { message: (e as Error)?.message }
    }
    if (echec) {
      setSubmitting(false)
      if (echec.code) Sentry.captureException(echec, { tags: { area: 'gym387_profile_completion_write' } })
      // 🔴 UN ÉCHEC NE FAIT PAS PASSER : l'écran reste, avec un message et le bouton.
      setError(estCoupureReseau(echec) ? 'profile_completion.save_failed_network' : 'profile_completion.save_failed')
      return
    }

    // ⚠️ L'EMAIL DE CONTACT PART À PART, ET SON ÉCHEC NE RETIENT PAS LE MEMBRE. Le téléphone
    // — la seule chose obligatoire — est enregistré. Garder quelqu'un derrière un écran sans
    // issue pour un champ FACULTATIF serait pire que de perdre la saisie : elle se refait
    // dans Profil → Mes informations, où l'échec est affiché.
    let emailEnregistre: string | null = null
    if (contactEmail) {
      try {
        const res = await supabase.from('profiles').update({ contact_email: contactEmail }).eq('id', userId)
        if (res.error) Sentry.captureException(res.error, { tags: { area: 'gym387_contact_email_write' } })
        else emailEnregistre = contactEmail
      } catch {
        // coupure entre les deux écritures : même issue, le membre passe.
      }
    }

    setSubmitting(false)
    marquerComplete(phone, emailEnregistre)
    void refreshProfile()
  }, [userId, marquerComplete, refreshProfile])

  const quitter = useCallback(async () => {
    setError(null)
    await signOut()
  }, [signOut])

  return (
    <View style={styles.cadre}>
      <View
        style={styles.cadre}
        accessibilityElementsHidden={bloque}
        importantForAccessibility={bloque ? 'no-hide-descendants' : 'auto'}
      >
        {children}
      </View>
      {bloque && (
        <View style={StyleSheet.absoluteFill}>
          <CompleteProfileScreen
            proposerEmailContact={estEmailRelaisApple(lecture.profil?.email)}
            submitting={submitting}
            error={error}
            onSubmit={enregistrer}
            onSignOut={quitter}
          />
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({ cadre: { flex: 1 } })
