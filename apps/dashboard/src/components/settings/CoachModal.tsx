import { useState, useEffect, useMemo, useRef, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useEffectivePlan } from '@/hooks/useEffectivePlan'
import { X } from 'lucide-react'
import { useGymStore } from '@/stores/useGymStore'
// 🔴 22/09 — LA ZONE DE DÉPÔT EXISTAIT DÉJÀ (GYM-305/215) : clic, glisser-déposer,
// contraintes du bucket dites avant l'envoi, nettoyage des frères d'extension, aperçu.
// Elle n'avait simplement jamais été branchée ici. En écrire une seconde aurait été la
// faute que son propre en-tête met en garde de commettre.
import { MediaUpload } from '@/components/ui/MediaUpload'
import { Button } from '@/components/ui/Button'
import type { CoachItem, CoachFormData } from '@/types/coach'

interface CoachModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: CoachFormData) => void
  editCoach?: CoachItem | null
  availableActivities: Array<{ name: string; color: string }>
  availableSites: string[]
}

type FormErrors = Partial<Record<keyof CoachFormData, string>>

export function CoachModal({ open, onClose, onSubmit, editCoach, availableActivities, availableSites }: CoachModalProps) {
  // GYM-248 — « Sites assignés » est un écran MULTI-SITES. Hors de ce cas, il n'a aucun
  // sens : une salle mono-site vit sans aucune ligne gym_sites, et le champ affichait un
  // site fabriqué en dur. On lit le drapeau résolu (GYM-245), jamais un nom de plan.
  const { features } = useEffectivePlan()
  const multiSiteEnabled = features?.multi_site_enabled === true
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const isEdit = !!editCoach

  // ── La photo ─────────────────────────────────────────────────────────────────────
  const gymId = useGymStore((s2) => s2.gym?.id) ?? null

  /**
   * 🔴 LE CHEMIN DOIT ÊTRE DÉTERMINISTE — c'est la règle de `MediaUpload`, et c'est elle
   * qui évite les orphelins : un remplacement ÉCRASE le même objet au lieu d'en créer un
   * second. Il faut donc un identifiant AVANT l'enregistrement.
   *
   * En édition, c'est celui du coach. En création, on en tire un ici et on le passe à
   * l'INSERT : le fichier et la ligne partagent la même identité dès le premier geste.
   *
   * ⚠️ CONTREPARTIE ASSUMÉE, ET ELLE EST NOUVELLE ICI : un gérant qui dépose une photo
   * puis ferme la modale sans enregistrer laisse un fichier seul dans le bucket (2 Mo au
   * pire). Les deux autres usages de `MediaUpload` n'ont pas ce cas — l'objet existe avant
   * la photo. Le retour inverse (n'envoyer qu'à l'enregistrement) priverait l'écran de
   * tout aperçu, ce qui est précisément ce qu'on vient de corriger.
   */
  const coachId = useMemo(
    () => editCoach?.id ?? (typeof crypto?.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`),
    // `open` en dépendance : une nouvelle ouverture = une nouvelle fiche, donc un
    // nouveau chemin. Sans lui, deux créations successives se partageraient un fichier.
    [editCoach, open],
  )

  const [form, setForm] = useState<CoachFormData>({
    firstName: '',
    lastName: '',
    bio: '',
    photoUrl: null,
    specialties: [],
    // Aucune pré-sélection : cocher un site à la place du gérant, c'est décider pour lui.
    sites: [],
    sortOrder: 1,
    active: true,
  })
  const [errors, setErrors] = useState<FormErrors>({})

  useEffect(() => {
    if (!open) return
    if (editCoach) {
      setForm({
        firstName: editCoach.firstName,
        lastName: editCoach.lastName,
        bio: editCoach.bio,
        photoUrl: editCoach.photoUrl,
        specialties: [...editCoach.specialties],
        sites: [...editCoach.sites],
        sortOrder: editCoach.sortOrder,
        active: editCoach.active,
      })
    } else {
      setForm({
        firstName: '', lastName: '', bio: '',
        // Une nouvelle fiche part sans photo : l'avatar retombe sur les initiales.
        photoUrl: null,
        specialties: [],
        // Aucune pré-sélection : cocher un site à la place du gérant, c'est décider pour lui.
        sites: [],
        sortOrder: 1, active: true,
      })
    }
    setErrors({})
  }, [open, editCoach, availableSites])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  function toggleSpecialty(name: string) {
    setForm((f) => ({
      ...f,
      specialties: f.specialties.includes(name)
        ? f.specialties.filter((s) => s !== name)
        : [...f.specialties, name],
    }))
  }

  function validate(): boolean {
    const e: FormErrors = {}
    if (!form.firstName.trim()) e.firstName = t('coaches.validation.first_name_required')
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleSubmit(ev: FormEvent) {
    ev.preventDefault()
    if (!validate()) return
    // `id` accompagne une CRÉATION : la ligne prend l'identifiant sous lequel la photo
    // a déjà été déposée. En édition il est ignoré (la fiche a le sien).
    onSubmit({ ...form, id: coachId })
  }


  const selectClass = 'w-full rounded-xl border border-border bg-card px-4 py-3 font-body text-sm text-dark outline-none transition-colors focus:border-dark'
  const labelClass = 'font-body text-sm font-medium text-dark'
  const errClass = 'text-xs text-red-500 mt-1'

  return (
    <dialog
      ref={dialogRef}
      onCancel={onClose}
      className="m-0 h-full w-full max-w-none bg-transparent p-0 backdrop:bg-black/40 md:m-auto md:h-auto md:max-w-[520px] md:rounded-2xl"
    >
      <div className="flex h-full flex-col bg-card md:h-auto md:max-h-[90vh] md:rounded-2xl md:shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-5">
          <h2 className="font-display text-xl font-black tracking-tight text-dark">
            {isEdit ? t('coaches.edit_title') : t('coaches.create_title')}
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-dark/5">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5">
          <div className="flex flex-col gap-5">
            {/* ═══════════════════════════════════════════════════════════════════════
                🔴 22/09 — LA PHOTO EST ENFIN BRANCHÉE.
                ═══════════════════════════════════════════════════════════════════════
                Ce bloc était DÉCORATIF : un `<button>` sans `onClick`, aucun
                `<input type="file">`, aucune zone de dépôt — et `photo_url` n'était jamais
                écrite par `useCoaches`. Le gérant cliquait sur un élément inerte.

                ⚠️ CE N'ÉTAIT PAS UNE POLITIQUE STORAGE, et c'est vérifié plutôt que
                supposé : sous l'identité d'un vrai `gym_admin`, un INSERT dans
                `gym-media` sur `<gym_id>/coaches/…` est ACCEPTÉ, et le dossier d'une autre
                salle est refusé en 42501. La politique ne regarde ni l'âge de la salle ni
                le sous-dossier — elle compare le premier segment du chemin au `gym_id` du
                gérant. Rien ne manquait côté serveur. */}
            <div>
              <MediaUpload
                label={t('coaches.photo')}
                value={form.photoUrl ?? ''}
                path={`${gymId}/coaches/${coachId}`}
                aspect="aspect-square"
                previewClassName="bg-dark/5"
                // Sans salle résolue, le chemin serait `undefined/coaches/…` : la zone le
                // DIT plutôt que d'échouer à l'envoi.
                disabled={!gymId}
                onChange={(url) => setForm((f) => ({ ...f, photoUrl: url }))}
              />
            </div>

            {/* Name row */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>{t('coaches.first_name')}</label>
                <input
                  value={form.firstName}
                  onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                  className={selectClass}
                  required
                />
                {errors.firstName && <p className={errClass}>{errors.firstName}</p>}
              </div>
              <div>
                <label className={labelClass}>{t('coaches.last_name')}</label>
                <input
                  value={form.lastName}
                  onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                  className={selectClass}
                />
              </div>
            </div>

            {/* Bio */}
            <div>
              <label className={labelClass}>{t('coaches.bio')}</label>
              <textarea
                value={form.bio}
                onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value.slice(0, 300) }))}
                placeholder={t('coaches.bio_placeholder')}
                rows={3}
                className={`${selectClass} resize-none`}
              />
              <p className="mt-1 text-right font-body text-[10px] text-muted">{form.bio.length}/300</p>
            </div>

            {/* Specialties — activity chips */}
            <div>
              <label className={labelClass}>{t('coaches.specialties')}</label>
              <p className="mb-2 font-body text-xs text-muted">{t('coaches.specialties_hint')}</p>
              <div className="flex flex-wrap gap-2">
                {availableActivities.map((act) => {
                  const selected = form.specialties.includes(act.name)
                  return (
                    <button
                      key={act.name}
                      type="button"
                      onClick={() => toggleSpecialty(act.name)}
                      className={`rounded-lg px-3 py-1.5 font-body text-xs font-medium transition-all ${
                        selected ? 'ring-2 ring-offset-1' : 'opacity-60 hover:opacity-100'
                      }`}
                      style={{
                        backgroundColor: `${act.color}20`,
                        color: act.color,
                        ...(selected ? { ringColor: act.color } : {}),
                      }}
                    >
                      {act.name}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Sites — MULTI-SITES UNIQUEMENT.
                Absente, pas grisée : un champ désactivé annonce une fonctionnalité qu'on
                pourrait débloquer ici, alors qu'elle relève du plan. Et la liste vient de
                gym_sites de LA salle, jamais d'une valeur écrite en dur. */}
            {multiSiteEnabled && availableSites.length > 0 && (
            <div>
              <label className={labelClass}>{t('coaches.sites')}</label>
              <div className="mt-2 flex flex-wrap gap-2">
                {availableSites.map((site) => {
                  const selected = form.sites.includes(site)
                  return (
                    <button
                      key={site}
                      type="button"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          sites: selected
                            ? f.sites.filter((s) => s !== site)
                            : [...f.sites, site],
                        }))
                      }
                      className={`rounded-lg px-3 py-1.5 font-body text-xs font-medium transition-all ${
                        selected
                          ? 'bg-accent text-[#17102E]'
                          : 'bg-dark/5 text-muted hover:bg-dark/10'
                      }`}
                    >
                      {site}
                    </button>
                  )
                })}
              </div>
            </div>
            )}

            {/* Sort order */}
            <div>
              <label className={labelClass}>{t('coaches.sort_order')}</label>
              <input
                type="number"
                value={form.sortOrder}
                min={1}
                onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) }))}
                className={`${selectClass} w-24`}
              />
            </div>

            {/* Active toggle */}
            <label className="flex items-center gap-3 rounded-xl border border-border p-4">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                className="h-4 w-4 rounded accent-accent"
              />
              <span className={labelClass}>
                {form.active ? t('coaches.active') : t('coaches.inactive')}
              </span>
            </label>
          </div>
        </form>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-border p-5">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={handleSubmit}>
            {isEdit ? t('common.save') : t('common.create')}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
