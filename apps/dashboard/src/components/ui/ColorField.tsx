// GYM-284 / GYM-285 — champ couleur à trois états : choisie, pas encore choisie, en cours
// de saisie.
//
// ⚠️ `<input type="color">` N'A PAS D'ÉTAT VIDE. Lui passer une chaîne vide le fait
// retomber sur #000000 : le gérant verrait du NOIR proposé, ce qui ressemble à un choix
// plutôt qu'à une absence. La pastille affiche donc la SUGGESTION quand rien n'est choisi,
// tandis que le champ texte, lui, reste vide avec la suggestion en filigrane. L'aperçu est
// conservé, le faux choix ne l'est pas.
//
// Effacer le champ texte REVIENT à « pas encore choisi » : on peut donc défaire son choix,
// ce qu'un champ pré-rempli ne permettait pas.
//
// ⚠️ EXTRAIT DU WIZARD (GYM-285), PAS RECOPIÉ. Il vivait dans OnboardingWizard.tsx ; la
// page Réglages → Apparence est ce même champ devenu éditable après coup. En recopier une
// seconde version aurait créé deux façons de dire « pas choisi » — et un jour, une seule
// des deux aurait su écrire `null`.

export function ColorField({ label, value, suggestion, hint, onChange }: {
  label: string
  value: string | null
  suggestion: string
  hint: string
  onChange: (v: string | null) => void
}) {
  const shown = value ?? suggestion
  return (
    <div className="flex flex-col gap-1.5">
      <label className="font-body text-sm font-semibold text-dark">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={shown}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 w-12 shrink-0 cursor-pointer rounded-lg border border-[#E8E6E0] bg-card p-1"
        />
        <input
          type="text"
          value={value ?? ''}
          placeholder={suggestion}
          onChange={(e) => onChange(e.target.value.trim() === '' ? null : e.target.value)}
          className="w-full rounded-xl border border-[#E8E6E0] bg-card px-3 py-2.5 font-mono text-sm text-dark outline-none transition-colors focus:border-dark"
        />
      </div>
      {value === null && (
        <p className="font-body text-xs text-secondary">{hint}</p>
      )}
    </div>
  )
}

/**
 * Palette Viniz proposée par défaut.
 *
 * ⚠️ SUGGÉRÉE, JAMAIS ENREGISTRÉE SANS GESTE : ces valeurs ne partent en base que si le
 * gérant les valide explicitement. Elles sont les mêmes que le repli des emails
 * (_shared/gym-branding.ts) et celui du thème mobile (lib/theme/resolveTheme.ts) — les
 * trois surfaces doivent replier sur la MÊME palette.
 */
export const VINIZ_PRIMARY = '#C8FF3D'
export const VINIZ_SECONDARY = '#2D1B69'
