// GYM-239 — Champ de mot de passe. C'EST ICI QUE LES ESPACES SONT ROGNÉES.
//
// VÉCU LE 18/08 : un futur client de Dopamine n'a pas pu créer son compte. Son mot de
// passe validait les cinq règles EN VERT, et la confirmation répondait « les mots de passe
// ne correspondent pas ». Le clavier avait ajouté une espace après le caractère spécial
// final — invisible dans un champ masqué, indiagnosticable pour lui. Il a abandonné. Le
// code de comparaison, lui, était juste : égalité stricte, aucune transformation.
//
// ⚠️ POURQUOI À LA SAISIE, ET SURTOUT PAS À LA VALIDATION. Rogner au moment de valider
// l'INSCRIPTION créerait un compte enregistré SANS l'espace ; à la connexion, l'utilisateur
// retaperait son mot de passe AVEC, et serait refusé sans jamais comprendre. Le trim doit
// valoir PARTOUT ou NULLE PART — et le seul endroit qui garantit « partout », c'est le
// composant que tous les écrans traversent. Un écran ne peut pas l'oublier.
//
// ⚠️ AccountActivation EST LE CAS LE PLUS GRAVE (GYM-202) : c'est là qu'un gérant invité
// définit son PREMIER mot de passe. Une espace enregistrée là rendrait son compte
// définitivement inaccessible à la connexion — et il n'aurait aucun moyen de le deviner.
//
// ⚠️ CE QUE ÇA NE FAIT PAS. `trim()` ne retire que les espaces de DÉBUT et de FIN :
// « Mon mot 2026! » reste intact, espaces intérieures comprises. Aucun mot de passe
// légitime ne se distingue d'un autre par une espace en bordure — un champ masqué ne
// permet ni de la voir ni de la retaper de façon fiable.
//
// Jumeau de apps/mobile/components/ui/PasswordInput.tsx, corrigé au même lot.
import { forwardRef, useState, type InputHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'

interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string
  error?: string
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  // ⚠️ `onChange` EST SORTI DES PROPS DIFFUSÉES et réintroduit explicitement plus bas :
  // laissé dans `{...props}`, il écraserait le handler qui rogne et court-circuiterait
  // silencieusement tout le correctif. `type` est déjà hors d'atteinte — `Omit<…, 'type'>`
  // l'interdit à l'appel et il est posé en dur ici.
  ({ label, error, className = '', id, onChange, ...props }, ref) => {
    const [visible, setVisible] = useState(false)
    const inputId = id ?? props.name

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="font-body text-sm font-medium text-dark">
            {label}
          </label>
        )}
        <div className="relative">
          <input
            ref={ref}
            id={inputId}
            type={visible ? 'text' : 'password'}
            // Rogné À CHAQUE FRAPPE : l'appelant ne voit jamais la valeur non rognée, donc
            // aucun écran ne peut en enregistrer une par inadvertance.
            //
            // L'événement est RÉÉMIS avec la valeur rognée plutôt que transmis tel quel :
            // les appelants lisent `e.target.value`, pas une valeur passée à part. Muter
            // `e.target.value` avant l'appel garde donc leur code inchangé.
            onChange={(e) => {
              e.target.value = e.target.value.trim()
              onChange?.(e)
            }}
            className={`w-full rounded-xl border bg-card px-4 py-3 pr-12 font-body text-sm text-dark outline-none transition-colors placeholder:text-dark/30 ${
              error
                ? 'border-red-400 focus:border-red-500'
                : 'border-[#E8E6E0] focus:border-dark'
            } ${className}`}
            {...props}
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-dark/30 transition-colors hover:text-dark/60"
            tabIndex={-1}
          >
            {visible ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    )
  }
)

PasswordInput.displayName = 'PasswordInput'
