// GYM-285 — RÉGLAGES → APPARENCE. Le wizard-couleurs, devenu éditable.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// LE MANQUE QUE CETTE PAGE COMBLE
// ═════════════════════════════════════════════════════════════════════════════════════
// Depuis le wizard self-serve (GYM-248), un gérant choisit ses couleurs UNE fois, à
// l'étape 1 de son onboarding — puis le wizard se ferme et ne se rouvre jamais. Il n'y
// avait plus AUCUN chemin pour les changer : ni écran, ni lien, ni contournement. Une
// couleur choisie en trente secondes le premier jour devenait définitive.
//
// ⚠️ CE N'EST PAS UNE RÉINVENTION. Le champ couleur (`ColorField`), la palette suggérée et
// le chemin d'écriture sont ceux du wizard, à l'identique — `ColorField` a été EXTRAIT
// plutôt que recopié. Deux implémentations auraient fini par diverger sur le seul point qui
// compte : ce que veut dire un champ vide.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// LE CHEMIN D'ÉCRITURE — LE MÊME, ET IL EST DÉJÀ SANCTIONNÉ
// ─────────────────────────────────────────────────────────────────────────────────────
// UPDATE RLS direct sur `nexxia_gyms`, exactement comme l'étape 1 du wizard et comme
// `GymSettingsCard`. La policy (GYM-180) est `FOR UPDATE USING (id = get_my_gym_id() AND
// is_gym_admin())`, doublée d'un GRANT colonne par colonne : `logo_url`, `primary_color`
// et `secondary_color` y figurent. Aucun nouveau chemin n'est créé ici.
//
// 🔴 `short_name` N'Y FIGURAIT PAS. La colonne a été posée en staging par le cockpit, mais
// une colonne ne suffit pas : sans `GRANT UPDATE (short_name)`, PostgREST refuse l'écriture
// (« permission denied for column »). La migration qui l'ajoute accompagne ce lot — c'est
// la MÊME policy, étendue d'une colonne, pas un second chemin.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { ColorField, VINIZ_PRIMARY, VINIZ_SECONDARY } from '@/components/ui/ColorField'
import { supabase } from '@/lib/supabase'
import { useGymStore } from '@/stores/useGymStore'
import { useToastStore } from '@/hooks/useToast'
import { forecastBrand, previewBrand } from '@/lib/brandContrast'

export function AppearanceCard() {
  const { t } = useTranslation()
  const gym = useGymStore((s) => s.gym)
  const addToast = useToastStore((s) => s.addToast)

  // ⚠️ `null` N'EST PAS `''`. Un champ vide veut dire « pas choisi » et part en base comme
  // `null` ; c'est ce qui permet de DÉFAIRE un choix, et ce qu'un état initialisé à une
  // couleur par défaut rendrait impossible. Voir la règle du lot : on n'écrit jamais de
  // défaut, ni en base ni en repli d'enregistrement.
  const [primary, setPrimary] = useState<string | null>(null)
  const [secondary, setSecondary] = useState<string | null>(null)
  const [logoUrl, setLogoUrl] = useState('')
  const [shortName, setShortName] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!gym?.id) return
    let cancelled = false
    void (async () => {
      const { data } = await supabase
        .from('nexxia_gyms')
        .select('logo_url, primary_color, secondary_color, short_name')
        .eq('id', gym.id)
        .single()
      if (cancelled || !data) return
      setLogoUrl(data.logo_url ?? '')
      setShortName(data.short_name ?? '')
      setPrimary(data.primary_color ?? null)
      setSecondary(data.secondary_color ?? null)
      setLoaded(true)
    })()
    return () => { cancelled = true }
  }, [gym?.id])

  const forecast = forecastBrand(primary, secondary)
  const preview = previewBrand(primary, secondary)

  async function handleSave() {
    if (!gym?.id) return
    setSaving(true)
    // 🔴 CHAQUE CHAMP VIDE PART EN `null`, JAMAIS EN CHAÎNE VIDE NI EN DÉFAUT. `''` en base
    // se lit comme « renseigné, mais vide » : le mobile afficherait alors un nom court vide
    // au lieu de retomber sur le nom complet, et un logo `''` casserait le rendu au lieu
    // de laisser la place aux initiales.
    const { error } = await supabase
      .from('nexxia_gyms')
      .update({
        logo_url: logoUrl.trim() || null,
        short_name: shortName.trim() || null,
        primary_color: primary,
        secondary_color: secondary,
      })
      .eq('id', gym.id)
    setSaving(false)
    if (error) {
      addToast(t('settings.appearance.save_error'), 'warning')
      return
    }
    addToast(t('settings.appearance.saved'))
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      {/* ── Le formulaire ─────────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-card p-6">
        <h2 className="font-display text-xl font-black tracking-tight text-dark">
          {t('settings.appearance.title')}
        </h2>
        <p className="mt-1 font-body text-sm text-muted">
          {t('settings.appearance.subtitle')}
        </p>

        <div className="mt-5 flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <ColorField
              label={t('settings.appearance.primary_label')}
              value={primary}
              suggestion={VINIZ_PRIMARY}
              hint={t('settings.appearance.color_hint')}
              onChange={setPrimary}
            />
            <ColorField
              label={t('settings.appearance.secondary_label')}
              value={secondary}
              suggestion={VINIZ_SECONDARY}
              hint={t('settings.appearance.color_hint')}
              onChange={setSecondary}
            />
          </div>

          {/* ── 🔴 L'AVERTISSEMENT — ON PRÉVIENT, ON N'INTERDIT PAS ───────────────────
              Le garde-fou de l'app protège déjà le RENDU : une couleur inutilisable est
              écartée et remplacée par la palette Viniz. Ce qu'il ne fait pas, c'est le
              DIRE — le gérant enregistrait deux pastels et l'app les ignorait sans que
              personne ne l'en informe. Il croyait avoir choisi.

              ⚠️ Et il reste NON BLOQUANT, délibérément. Interdire l'enregistrement ferait
              de nous le juge du goût d'un client, sur une règle qu'il ne voit pas ; et une
              couleur écartée aujourd'hui peut devenir utilisable demain si l'autre change.
              On annonce la conséquence, il décide. */}
          {forecast.hasWarning && (
            <div className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <div className="flex flex-col gap-1">
                <p className="font-body text-sm font-semibold text-amber-900">
                  {t('settings.appearance.warning_title')}
                </p>
                <ul className="flex flex-col gap-0.5">
                  {forecast.backgroundFallsBack && (
                    <li className="font-body text-xs text-amber-800">
                      {t('settings.appearance.warning_background')}
                    </li>
                  )}
                  {forecast.accentCarriesNoText && (
                    <li className="font-body text-xs text-amber-800">
                      {t('settings.appearance.warning_accent_text')}
                    </li>
                  )}
                  {forecast.accentInvisibleOnBackground && (
                    <li className="font-body text-xs text-amber-800">
                      {t('settings.appearance.warning_accent_invisible')}
                    </li>
                  )}
                </ul>
              </div>
            </div>
          )}

          <Input
            label={t('settings.appearance.short_name_label')}
            name="shortName"
            value={shortName}
            onChange={(e) => setShortName(e.target.value)}
            placeholder={gym?.name ?? ''}
            helper={t('settings.appearance.short_name_helper')}
          />

          <Input
            label={t('settings.appearance.logo_label')}
            name="logoUrl"
            type="url"
            placeholder="https://…"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            helper={t('settings.appearance.logo_helper')}
          />

          <Button onClick={handleSave} isLoading={saving} disabled={!loaded} className="w-full sm:w-auto">
            <Check className="h-4 w-4" />
            {t('settings.appearance.submit')}
          </Button>
        </div>
      </div>

      {/* ── L'aperçu ──────────────────────────────────────────────────────────────── */}
      <BrandPreviewPanel
        preview={preview}
        nom={shortName.trim() || gym?.name || ''}
        titre={t('settings.appearance.preview_title')}
        note={t('settings.appearance.preview_note')}
        action={t('settings.appearance.preview_action')}
        corps={t('settings.appearance.preview_body')}
      />
    </div>
  )
}

/**
 * 🔴 L'APERÇU MONTRE LE RÉSULTAT, PAS LA SAISIE.
 *
 * Peindre bêtement les deux couleurs saisies mentirait exactement là où l'aperçu sert : sur
 * les cas où l'app va les ÉCARTER. Le gérant verrait ses deux pastels côte à côte, les
 * enregistrerait satisfait, et découvrirait autre chose sur le téléphone de ses membres —
 * sans jamais faire le lien. `previewBrand` rejoue donc les replis : ce qui s'affiche ici
 * est ce que les membres verront. L'avertissement dit POURQUOI, l'aperçu montre QUOI.
 *
 * ⚠️ IL SE MET À JOUR À LA FRAPPE, AVANT TOUT ENREGISTREMENT. C'est la seule façon de
 * transformer un choix de couleur en décision informée : essayer, voir, corriger.
 */
function BrandPreviewPanel({ preview, nom, titre, note, action, corps }: {
  preview: { background: string; onBackground: string; accent: string; onAccent: string }
  nom: string
  titre: string
  note: string
  action: string
  corps: string
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <h3 className="font-display text-base font-black tracking-tight text-dark">{titre}</h3>
      <p className="mt-1 font-body text-xs text-muted">{note}</p>

      <div
        className="mt-4 overflow-hidden rounded-xl"
        style={{ backgroundColor: preview.background }}
      >
        <div className="px-5 pb-6 pt-5">
          <p
            className="font-display text-2xl font-black tracking-tight"
            style={{ color: preview.onBackground }}
          >
            {nom.toUpperCase()}
          </p>
          <p className="mt-2 font-body text-xs" style={{ color: preview.onBackground, opacity: 0.7 }}>
            {corps}
          </p>
          <div
            className="mt-5 rounded-xl px-4 py-3 text-center font-body text-sm font-bold"
            style={{ backgroundColor: preview.accent, color: preview.onAccent }}
          >
            {action}
          </div>
        </div>
      </div>
    </div>
  )
}
