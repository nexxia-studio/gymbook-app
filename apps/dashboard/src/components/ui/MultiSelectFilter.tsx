// GYM-128 — Menu déroulant de filtre à sélection multiple.
//
// LE PROBLÈME. Les filtres de /planning s'affichaient en pastilles étalées : une par coach,
// une par activité, une par statut, plus les trois « Tous ». Avec 3 coachs et 2 activités
// c'était tenable ; Nico en aura SIX ET SIX — soit une quinzaine de pastilles en travers de
// l'écran, dès l'ouverture de la page. Sur 380 px, c'est inutilisable.
//
// ⚠️ CRÉÉ, PAS RÉUTILISÉ — et c'est un constat, pas un choix. Le dépôt n'a ni shadcn/ui, ni
// Radix, ni Headless UI (vérifié dans package.json), et components/ui ne contient que des
// briques simples (Button, Input, ConfirmModal, Toast…). Il n'existait aucun menu déroulant
// réutilisable. D'où ce composant, écrit GÉNÉRIQUE et placé dans components/ui plutôt que
// dans components/planning : /members et /revenus portent des filtres de même nature et
// pourront s'en servir sans le réécrire.
//
// Le motif d'ouverture (calque plein écran + panneau absolu) est repris de
// MemberActionsMenu (GYM-147), déjà en place dans le dépôt : même façon de fermer au clic
// extérieur, même z-index, même ancrage.
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Search, X } from 'lucide-react'

export interface MultiSelectOption {
  value: string
  label: string
  /** Pastille de couleur devant l'intitulé (activités du planning). Optionnel. */
  color?: string
}

interface MultiSelectFilterProps {
  /** Intitulé du bouton (« Coachs »), affiché même quand rien n'est sélectionné. */
  label: string
  options: MultiSelectOption[]
  /** Valeurs cochées. Tableau VIDE = aucun filtre, donc « tout ». */
  selected: string[]
  onChange: (next: string[]) => void
  /**
   * Au-delà de ce nombre d'options, un champ de recherche apparaît dans le menu.
   * En deçà, il serait du bruit : on voit déjà toute la liste.
   */
  searchThreshold?: number
  /** Sens d'ouverture — comme MemberActionsMenu (GYM-147). */
  openUpward?: boolean
}

export function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  searchThreshold = 8,
  openUpward = false,
}: MultiSelectFilterProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()

  const showSearch = options.length > searchThreshold

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.label.toLowerCase().includes(q))
  }, [options, query])

  // Réouverture → repartir d'une liste entière : une recherche laissée en place ferait
  // croire que la salle n'a que deux coachs.
  useEffect(() => { if (!open) setQuery('') }, [open])

  // ── Clavier ────────────────────────────────────────────────────────────────
  // Échap ferme et REND LE FOCUS au bouton : sans ça, la tabulation repartirait du début
  // du document et l'utilisateur au clavier perdrait sa place dans la barre de filtres.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // Fermeture quand le focus quitte l'ensemble bouton + panneau (tabulation sortante).
  // Le calque ne gère que la SOURIS ; sans ce filet, un utilisateur au clavier laisserait
  // le menu ouvert derrière lui.
  function handleBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false)
  }

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value])
  }

  const count = selected.length

  return (
    <div className="relative" onBlur={handleBlur}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 font-body text-xs font-medium transition-colors ${
          count > 0 ? 'bg-accent text-[#17102E]' : 'bg-card text-secondary hover:bg-dark/5'
        }`}
      >
        {label}
        {/* Le NOMBRE de sélections, lisible sans ouvrir : c'est ce qui remplace la vue
            d'ensemble que donnaient les pastilles étalées. */}
        {count > 0 && (
          <span className="rounded bg-[#17102E]/15 px-1 py-px font-body text-[10px] font-bold">
            {count}
          </span>
        )}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        <>
          {/* Calque de fermeture au clic extérieur (motif MemberActionsMenu). */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            ref={panelRef}
            className={`absolute left-0 z-20 w-56 rounded-xl border border-border bg-card py-1 shadow-lg ${
              openUpward ? 'bottom-full mb-1' : 'top-full mt-1'
            }`}
          >
            {showSearch && (
              <div className="mx-1 mb-1 flex items-center gap-2 rounded-lg bg-dark/[0.03] px-2 py-1.5">
                <Search className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('filters.search_placeholder')}
                  aria-label={t('filters.search_placeholder')}
                  className="w-full bg-transparent font-body text-xs text-dark outline-none placeholder:text-muted"
                />
              </div>
            )}

            {/* Défilement INTERNE : une salle à vingt activités ne doit pas allonger la
                page, seulement le menu. */}
            <div
              id={listboxId}
              role="listbox"
              aria-multiselectable="true"
              aria-label={label}
              className="max-h-64 overflow-y-auto"
            >
              {visible.length === 0 ? (
                <p className="px-3 py-2 font-body text-xs text-muted">{t('filters.no_result')}</p>
              ) : (
                visible.map((o) => {
                  const checked = selected.includes(o.value)
                  return (
                    <button
                      key={o.value}
                      type="button"
                      role="option"
                      // `aria-selected` porte l'état à voix haute : un lecteur d'écran
                      // annonce « coché » / « non coché », là où la seule coche visuelle
                      // ne dirait rien.
                      aria-selected={checked}
                      onClick={() => toggle(o.value)}
                      className="flex min-h-[36px] w-full items-center gap-2 px-3 py-1.5 text-left font-body text-sm text-dark hover:bg-dark/5"
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          checked ? 'border-dark bg-dark' : 'border-border'
                        }`}
                        aria-hidden="true"
                      >
                        {checked && <Check className="h-3 w-3 text-white" />}
                      </span>
                      {o.color && (
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: o.color }}
                          aria-hidden="true"
                        />
                      )}
                      <span className="truncate">{o.label}</span>
                    </button>
                  )
                })
              )}
            </div>

            {/* Tout décocher — depuis le menu, sans avoir à défaire coche par coche. */}
            {count > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="mt-1 flex w-full items-center gap-1.5 border-t border-border px-3 py-2 font-body text-xs font-semibold text-muted hover:bg-dark/5"
              >
                <X className="h-3 w-3" aria-hidden="true" />
                {t('filters.clear_one', { label })}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
