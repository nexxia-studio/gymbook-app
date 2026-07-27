import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string))
}

// ─── Émetteur (GYM-180) ───────────────────────────────────────────────────────
// Toutes ces valeurs viennent de nexxia_gyms. AUCUN littéral émetteur ne doit
// réapparaître dans le HTML : une facture nomme la société qui encaisse, pas la marque
// du produit qui l'imprime.
interface Seller {
  displayName: string   // dénomination commerciale (commercial_name, repli name)
  legalName: string     // raison sociale + forme juridique, ex. « EMS 95 SRL »
  addressLine: string   // SIÈGE SOCIAL — rue
  cityLine: string      // SIÈGE SOCIAL — code postal + commune
  vatNumber: string
  email: string
  phone: string
}

// ─── Régime TVA (GYM-180) ─────────────────────────────────────────────────────
// Trois états mutuellement exclusifs, tous pilotés par la donnée :
//   'exempt'    → exonéré : total TTC seul + mention légale (vat_exempt = true)
//   'breakdown' → assujetti : décomposition HT / TVA / TTC (vat_rate > 0)
//   'none'      → régime non renseigné (vat_rate = 0, non exonéré) : total seul, SANS
//                 aucune affirmation fiscale. C'est le défaut d'un gym fraîchement créé —
//                 mieux vaut ne rien dire que d'affirmer une exonération peut-être fausse
//                 (c'était précisément le bug corrigé par GYM-180).
type VatMode = 'exempt' | 'breakdown' | 'none'

interface VatView {
  mode: VatMode
  mention: string    // mention légale d'exonération (mode 'exempt')
  rateLabel: string  // ex. « 12 % »
  htStr: string
  vatStr: string
  ttcStr: string
}

const money = (cents: number): string => `${(cents / 100).toFixed(2)}€`

/**
 * MÉTHODE A — le montant encaissé est TTC, on en EXTRAIT la TVA.
 *
 * Le membre a payé `amount`, ce montant ne bouge JAMAIS : base HT et TVA en sont dérivées.
 *
 * Tout est calculé en CENTIMES ENTIERS, et la TVA est le RELIQUAT (ttc − ht) plutôt qu'un
 * second arrondi indépendant. C'est ce qui garantit `base_ht + tva == total_ttc` au centime
 * près par construction — un `round(ttc) − round(ht)` ne peut pas dériver, là où deux
 * arrondis séparés (`round(ht)` + `round(ttc − ht)`) laisseraient passer un écart d'1 cent.
 */
function computeVat(amount: number, vatRate: number, vatExempt: boolean, mention: string): VatView {
  const totalTtcCents = Math.round(Number(amount) * 100)

  if (vatExempt) {
    return {
      mode: 'exempt', mention,
      rateLabel: '', htStr: '', vatStr: '',
      ttcStr: money(totalTtcCents),
    }
  }

  if (!(vatRate > 0)) {
    return {
      mode: 'none', mention: '',
      rateLabel: '', htStr: '', vatStr: '',
      ttcStr: money(totalTtcCents),
    }
  }

  // Une seule ligne de facture aujourd'hui ; la somme des HT de lignes est écrite
  // explicitement pour que l'ajout d'une 2e ligne reste correct sans retoucher l'invariant.
  const lineTtcCents = [totalTtcCents]
  const lineHtCents = lineTtcCents.map((c) => Math.round(c / (1 + vatRate / 100)))
  const baseHtCents = lineHtCents.reduce((a, b) => a + b, 0)
  const vatCents = totalTtcCents - baseHtCents // reliquat : absorbe tout écart d'arrondi

  return {
    mode: 'breakdown', mention: '',
    // 12.00 → « 12 % » ; 21.50 → « 21.5 % »
    rateLabel: `${Number(vatRate)} %`,
    htStr: money(baseHtCents),
    vatStr: money(vatCents),
    ttcStr: money(totalTtcCents),
  }
}

function renderInvoiceHtml(args: {
  invoiceNumber: string; formattedDate: string; memberName: string
  memberEmail: string; addressLine: string; cityLine: string
  planName: string; reference: string
  seller: Seller; vat: VatView
}): string {
  const a = args
  const s = a.seller
  const v = a.vat

  // Le tableau de lignes est exprimé en HT dès qu'il y a une TVA à décomposer
  // (pratique standard) ; sinon il porte directement le montant encaissé.
  const lineAmount = v.mode === 'breakdown' ? v.htStr : v.ttcStr
  const amountSuffix = v.mode === 'breakdown' ? ' HT' : ' TTC'

  const sellerFooterLines = [s.legalName, s.addressLine, s.cityLine,
    s.vatNumber ? `TVA : ${s.vatNumber}` : '', s.email, s.phone]
    .filter(Boolean).map((l) => esc(l)).join('<br>')

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Facture ${esc(a.invoiceNumber)} — ${esc(s.displayName)}</title>
</head>
<body style="margin:0;padding:0;background:#F5F4F0;font-family:'DM Sans','Helvetica Neue',Arial,sans-serif;color:#111">
  <div style="max-width:700px;margin:0 auto;background:#FFFFFF;padding:48px 40px">
    <table style="width:100%;border-collapse:collapse;margin-bottom:40px">
      <tr>
        <td style="vertical-align:top">
          <div style="background:#111111;padding:14px 20px;border-radius:6px;display:inline-block">
            <span style="font-family:'Arial Black',Arial,sans-serif;font-size:22px;color:#C8F000;letter-spacing:3px">${esc(s.displayName.toUpperCase())}</span>
          </div>
          ${s.legalName ? `<div style="color:#6B7280;font-size:11px;margin-top:8px">${esc(s.legalName)}</div>` : ''}
        </td>
        <td style="vertical-align:top;text-align:right">
          <div style="font-size:11px;color:#6B7280;text-transform:uppercase;letter-spacing:1px">Facture</div>
          <div style="font-size:22px;font-weight:700;color:#111;margin-top:4px">${esc(a.invoiceNumber)}</div>
          <div style="font-size:13px;color:#6B7280;margin-top:4px">${esc(a.formattedDate)}</div>
        </td>
      </tr>
    </table>
    <div style="border-top:2px solid #111;margin-bottom:32px"></div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:40px">
      <tr>
        <td style="vertical-align:top;width:50%;padding-right:24px">
          <div style="font-size:11px;color:#6B7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Vendeur</div>
          <div style="font-weight:700;font-size:15px;color:#111">${esc(s.displayName)}</div>
          ${s.legalName ? `<div style="font-size:13px;color:#4B5563">${esc(s.legalName)}</div>` : ''}
          ${s.addressLine ? `<div style="font-size:13px;color:#4B5563">${esc(s.addressLine)}</div>` : ''}
          ${s.cityLine ? `<div style="font-size:13px;color:#4B5563">${esc(s.cityLine)}</div>` : ''}
          ${s.vatNumber ? `<div style="font-size:13px;color:#4B5563;margin-top:4px">TVA : ${esc(s.vatNumber)}</div>` : ''}
          ${s.email ? `<div style="font-size:13px;color:#4B5563">${esc(s.email)}</div>` : ''}
          ${s.phone ? `<div style="font-size:13px;color:#4B5563">${esc(s.phone)}</div>` : ''}
        </td>
        <td style="vertical-align:top;width:50%">
          <div style="font-size:11px;color:#6B7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Facturé à</div>
          <div style="font-weight:700;font-size:15px;color:#111">${esc(a.memberName)}</div>
          ${a.memberEmail ? `<div style="font-size:13px;color:#4B5563">${esc(a.memberEmail)}</div>` : ''}
          ${a.addressLine ? `<div style="font-size:13px;color:#4B5563">${esc(a.addressLine)}</div>` : ''}
          ${a.cityLine ? `<div style="font-size:13px;color:#4B5563">${esc(a.cityLine)}</div>` : ''}
        </td>
      </tr>
    </table>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
      <thead>
        <tr>
          <th style="text-align:left;font-size:11px;color:#6B7280;text-transform:uppercase;border-bottom:1px solid #E5E7EB;padding:10px 0;font-weight:600">Description</th>
          <th style="text-align:center;font-size:11px;color:#6B7280;text-transform:uppercase;border-bottom:1px solid #E5E7EB;padding:10px 0;font-weight:600;width:50px">Qté</th>
          <th style="text-align:right;font-size:11px;color:#6B7280;text-transform:uppercase;border-bottom:1px solid #E5E7EB;padding:10px 0;font-weight:600;width:120px">Prix unit.${amountSuffix}</th>
          <th style="text-align:right;font-size:11px;color:#6B7280;text-transform:uppercase;border-bottom:1px solid #E5E7EB;padding:10px 0;font-weight:600;width:100px">Total${amountSuffix}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="padding:16px 0;border-bottom:1px solid #F3F4F6">
            <div style="font-weight:600;font-size:14px;color:#111">${esc(a.planName)}</div>
            <div style="font-size:11px;color:#9CA3AF;font-family:'Courier New',monospace;margin-top:4px">Réf : ${esc(a.reference)}</div>
          </td>
          <td style="padding:16px 0;border-bottom:1px solid #F3F4F6;text-align:center;font-size:14px;color:#111">1</td>
          <td style="padding:16px 0;border-bottom:1px solid #F3F4F6;text-align:right;font-size:14px;color:#111">${esc(lineAmount)}</td>
          <td style="padding:16px 0;border-bottom:1px solid #F3F4F6;text-align:right;font-size:14px;font-weight:700;color:#111">${esc(lineAmount)}</td>
        </tr>
      </tbody>
    </table>
    <div style="background:#F9FAFB;border-radius:8px;padding:20px 24px;margin-bottom:16px">
      <table style="width:100%;border-collapse:collapse">
        ${v.mode === 'breakdown' ? `
        <tr>
          <td style="font-size:13px;color:#4B5563;padding-bottom:8px">Total HT</td>
          <td style="text-align:right;font-size:15px;font-weight:600;color:#111;padding-bottom:8px">${esc(v.htStr)}</td>
        </tr>
        <tr>
          <td style="font-size:13px;color:#4B5563;padding-bottom:12px;border-bottom:1px solid #E5E7EB">TVA ${esc(v.rateLabel)}</td>
          <td style="text-align:right;font-size:15px;font-weight:600;color:#111;padding-bottom:12px;border-bottom:1px solid #E5E7EB">${esc(v.vatStr)}</td>
        </tr>
        <tr>
          <td style="font-size:14px;color:#4B5563;text-transform:uppercase;font-weight:600;padding-top:12px">Total TTC</td>
          <td style="text-align:right;font-size:28px;font-weight:800;color:#111;padding-top:12px">${esc(v.ttcStr)}</td>
        </tr>` : `
        <tr>
          <td style="font-size:14px;color:#4B5563;text-transform:uppercase;font-weight:600">Total${v.mode === 'exempt' ? ' TTC' : ''}</td>
          <td style="text-align:right;font-size:28px;font-weight:800;color:#111">${esc(v.ttcStr)}</td>
        </tr>`}
      </table>
    </div>
    ${v.mode === 'exempt' && v.mention
      ? `<div style="text-align:right;font-size:11px;color:#9CA3AF;margin-bottom:48px">${esc(v.mention)}</div>`
      : '<div style="margin-bottom:48px"></div>'}
    <div style="border-top:1px solid #E5E7EB;padding-top:24px;text-align:center">
      <div style="font-size:12px;color:#6B7280;line-height:1.8">
        <strong style="color:#111">${esc(s.displayName)}</strong><br>
        ${sellerFooterLines}${sellerFooterLines ? '<br>' : ''}
        <span style="color:#9CA3AF;font-size:11px">Document généré par ${esc(s.displayName)} — ${esc(a.formattedDate)}</span>
      </div>
    </div>
  </div>
</body>
</html>`
}

// GYM-167 — statuts pour lesquels une facture (justificatif de vente encaissée) est émise.
// paid + remboursements : la vente a bien eu lieu ; un avoir éventuel est un autre document.
const INVOICEABLE_STATUSES = ['paid', 'partially_refunded', 'refunded']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const body = await req.json() as { payment_id?: string; mode?: string }
    const paymentId = body.payment_id ?? ''
    // 'email' (défaut, historique : envoi au membre) | 'download' (retour du document, gérant).
    const mode = body.mode === 'download' ? 'download' : 'email'
    if (!paymentId) return json({ error: true, code: 'MISSING_PAYMENT_ID' }, 400)

    const { data: payment } = await supabase
      .from('payments')
      .select('id, member_id, gym_id, plan_id, plan_name, amount, status, paid_at, created_at, mollie_payment_id, invoice_number')
      .eq('id', paymentId)
      .single()

    if (!payment) return json({ error: true, code: 'NOT_FOUND' }, 404)

    // ── Autorisation (GYM-167) ── trois voies :
    //  1. Interne (envoi auto serveur, ex. admin-create-member) via X-Internal-Secret.
    //  2. Le membre propriétaire du paiement (comportement historique app mobile).
    //  3. Un gym_admin / super_admin DU GYM du paiement (nouveau : dashboard /revenus).
    const internalSecret = Deno.env.get('INTERNAL_FUNCTIONS_SECRET') ?? ''
    const providedSecret = req.headers.get('X-Internal-Secret') ?? ''
    const isInternal = internalSecret.length > 0 && providedSecret === internalSecret

    if (!isInternal) {
      const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
      const { data: { user } } = await supabase.auth.getUser(token)
      if (!user) return json({ error: true, code: 'UNAUTHORIZED' }, 401)

      let allowed = user.id === payment.member_id
      if (!allowed) {
        const { data: caller } = await supabase
          .from('profiles')
          .select('role, gym_id')
          .eq('id', user.id)
          .single()
        allowed = !!caller
          && (caller.role === 'gym_admin' || caller.role === 'super_admin')
          && caller.gym_id === payment.gym_id
      }
      if (!allowed) return json({ error: true, code: 'FORBIDDEN' }, 403)
    }

    // ── Éligibilité ── (GYM-167) l'ancienne restriction aux plans legacy 'drop_in'/'pack_10'
    // est retirée : les paiements modernes (plan_id UUID) et hors-ligne (cash/terminal) doivent
    // aussi être facturables. On facture tout encaissement réel.
    //
    // (GYM-180) Remboursements : la facture reste celle de la VENTE, au montant initialement
    // encaissé. On ne décompte JAMAIS un remboursement d'une facture déjà émise — un
    // remboursement se matérialise par une note de crédit distincte, pas par la réécriture
    // d'un document comptable. Comportement historique volontairement conservé.
    if (!INVOICEABLE_STATUSES.includes(payment.status as string)) {
      return json({ error: true, code: 'NOT_PAID' }, 400)
    }

    // Numéro idempotent : réutilise l'existant, n'alloue (nextval) que si absent.
    let invoiceNumber = payment.invoice_number as string | null
    if (!invoiceNumber) {
      const { data: alloc } = await supabase.rpc('allocate_invoice_number', { p_payment_id: payment.id })
      invoiceNumber = (alloc as string | null) ?? `INV-${new Date().getFullYear()}-${payment.id.slice(0, 6)}`
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('first_name, last_name, email, address_line, postal_code, city')
      .eq('id', payment.member_id)
      .single()

    // ── Émetteur (GYM-180) ── chargé depuis le gym du paiement : plus aucun littéral.
    const { data: gym } = await supabase
      .from('nexxia_gyms')
      .select('name, commercial_name, legal_name, legal_form, legal_address, legal_postal_code, legal_city, phone, email, vat_number, vat_rate, vat_exempt, vat_exempt_mention')
      .eq('id', payment.gym_id)
      .single()

    if (!gym) return json({ error: true, code: 'GYM_NOT_FOUND' }, 404)

    const g = gym as Record<string, unknown>
    const seller: Seller = {
      displayName: (g.commercial_name as string) || (g.name as string) || '—',
      legalName: [g.legal_name, g.legal_form].filter(Boolean).join(' '),
      addressLine: (g.legal_address as string) ?? '',
      cityLine: [g.legal_postal_code, g.legal_city].filter(Boolean).join(' '),
      vatNumber: (g.vat_number as string) ?? '',
      email: (g.email as string) ?? '',
      phone: (g.phone as string) ?? '',
    }

    const vat = computeVat(
      Number(payment.amount),
      Number(g.vat_rate ?? 0),
      Boolean(g.vat_exempt),
      (g.vat_exempt_mention as string) ?? '',
    )

    const issueDate = new Date(payment.paid_at ?? payment.created_at ?? Date.now())
    const formattedDate = issueDate.toLocaleDateString('fr-BE', { day: '2-digit', month: 'long', year: 'numeric' })

    const invoiceHtml = renderInvoiceHtml({
      invoiceNumber: invoiceNumber!,
      formattedDate,
      memberName: `${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim() || (profile?.email ?? '—'),
      memberEmail: profile?.email ?? '',
      addressLine: profile?.address_line ?? '',
      cityLine: [profile?.postal_code, profile?.city].filter(Boolean).join(' '),
      planName: payment.plan_name ?? '—',
      reference: payment.mollie_payment_id ?? payment.id,
      seller,
      vat,
    })

    // ── Mode téléchargement : retourne le document (pas d'email). Le dashboard l'ouvre
    //    pour impression / enregistrement PDF (justificatif remis au comptoir). ──
    if (mode === 'download') {
      return json({ success: true, invoice_number: invoiceNumber, html: invoiceHtml })
    }

    // ── Mode email (défaut) : envoi de la facture au membre. ──
    if (!profile?.email) return json({ error: true, code: 'NO_EMAIL' }, 400)
    if (!RESEND_KEY) return json({ error: true, code: 'RESEND_NOT_CONFIGURED' }, 500)

    // Le domaine expéditeur reste celui vérifié chez Resend ; seul le nom affiché suit
    // l'émetteur. Les caractères qui casseraient l'en-tête From sont retirés.
    const fromName = seller.displayName.replace(/[<>"@,;]/g, '').trim() || 'Facture'

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: `${fromName} <noreply@viniz.app>`,
        to: [profile.email],
        subject: `Facture ${invoiceNumber} — ${payment.plan_name ?? seller.displayName}`,
        html: invoiceHtml,
      }),
    })

    if (!resendRes.ok) {
      return json({ error: true, code: 'EMAIL_SEND_FAILED', details: await resendRes.text() }, 500)
    }

    return json({ success: true, invoice_number: invoiceNumber, email: profile.email })
  } catch (err) {
    console.error('[generate-invoice] uncaught:', err)
    return json({ error: true, code: 'SERVER_ERROR', details: (err as Error).message }, 500)
  }
})
