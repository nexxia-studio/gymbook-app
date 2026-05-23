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

function renderInvoiceHtml(args: {
  invoiceNumber: string; formattedDate: string; memberName: string
  memberEmail: string; addressLine: string; cityLine: string
  planName: string; amountStr: string; unitPrice: string; reference: string
}): string {
  const a = args
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Facture ${esc(a.invoiceNumber)} — Dopamine</title>
</head>
<body style="margin:0;padding:0;background:#F5F4F0;font-family:'DM Sans','Helvetica Neue',Arial,sans-serif;color:#111">
  <div style="max-width:700px;margin:0 auto;background:#FFFFFF;padding:48px 40px">
    <table style="width:100%;border-collapse:collapse;margin-bottom:40px">
      <tr>
        <td style="vertical-align:top">
          <div style="background:#111111;padding:14px 20px;border-radius:6px;display:inline-block">
            <span style="font-family:'Arial Black',Arial,sans-serif;font-size:22px;color:#C8F000;letter-spacing:3px">DOPAMINE</span>
          </div>
          <div style="color:#6B7280;font-size:11px;margin-top:8px">Performance Club — Neupré, Belgique</div>
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
          <div style="font-weight:700;font-size:15px;color:#111">Dopamine Performance Club</div>
          <div style="font-size:13px;color:#4B5563">Neupré, Belgique</div>
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
          <th style="text-align:right;font-size:11px;color:#6B7280;text-transform:uppercase;border-bottom:1px solid #E5E7EB;padding:10px 0;font-weight:600;width:120px">Prix unit.</th>
          <th style="text-align:right;font-size:11px;color:#6B7280;text-transform:uppercase;border-bottom:1px solid #E5E7EB;padding:10px 0;font-weight:600;width:100px">Total</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="padding:16px 0;border-bottom:1px solid #F3F4F6">
            <div style="font-weight:600;font-size:14px;color:#111">${esc(a.planName)}</div>
            <div style="font-size:11px;color:#9CA3AF;font-family:'Courier New',monospace;margin-top:4px">Réf : ${esc(a.reference)}</div>
          </td>
          <td style="padding:16px 0;border-bottom:1px solid #F3F4F6;text-align:center;font-size:14px;color:#111">1</td>
          <td style="padding:16px 0;border-bottom:1px solid #F3F4F6;text-align:right;font-size:14px;color:#111">${esc(a.unitPrice)}</td>
          <td style="padding:16px 0;border-bottom:1px solid #F3F4F6;text-align:right;font-size:14px;font-weight:700;color:#111">${esc(a.amountStr)}</td>
        </tr>
      </tbody>
    </table>
    <div style="background:#F9FAFB;border-radius:8px;padding:20px 24px;margin-bottom:16px">
      <table style="width:100%;border-collapse:collapse">
        <tr>
          <td style="font-size:14px;color:#4B5563;text-transform:uppercase;font-weight:600">Total TTC</td>
          <td style="text-align:right;font-size:28px;font-weight:800;color:#111">${esc(a.amountStr)}</td>
        </tr>
      </table>
    </div>
    <div style="text-align:right;font-size:11px;color:#9CA3AF;margin-bottom:48px">TVA non applicable — Art. 44 du Code TVA</div>
    <div style="border-top:1px solid #E5E7EB;padding-top:24px;text-align:center">
      <div style="font-size:12px;color:#6B7280;line-height:1.8">
        <strong style="color:#111">Dopamine Performance Club</strong><br>
        Neupré, Belgique<br>
        <span style="color:#9CA3AF;font-size:11px">Document généré par GymBook — ${esc(a.formattedDate)}</span>
      </div>
    </div>
  </div>
</body>
</html>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    const { data: { user } } = await supabase.auth.getUser(token)
    if (!user) return json({ error: true, code: 'UNAUTHORIZED' }, 401)

    const body = await req.json() as { payment_id?: string }
    const paymentId = body.payment_id ?? ''
    if (!paymentId) return json({ error: true, code: 'MISSING_PAYMENT_ID' }, 400)

    const { data: payment } = await supabase
      .from('payments')
      .select('id, member_id, plan_id, plan_name, amount, status, paid_at, created_at, mollie_payment_id, invoice_number')
      .eq('id', paymentId)
      .single()

    if (!payment) return json({ error: true, code: 'NOT_FOUND' }, 404)
    if (payment.member_id !== user.id) return json({ error: true, code: 'FORBIDDEN' }, 403)
    if (payment.status !== 'paid') return json({ error: true, code: 'NOT_PAID' }, 400)

    const isOneTime = payment.plan_id === 'drop_in' || payment.plan_id === 'pack_10'
    if (!isOneTime) return json({ error: true, code: 'NOT_ONE_TIME' }, 400)

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

    if (!profile?.email) return json({ error: true, code: 'NO_EMAIL' }, 400)

    const memberName = `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || profile.email
    const issueDate = new Date(payment.paid_at ?? payment.created_at ?? Date.now())
    const formattedDate = issueDate.toLocaleDateString('fr-BE', { day: '2-digit', month: 'long', year: 'numeric' })
    const amountStr = `${Number(payment.amount).toFixed(2)}€`

    const invoiceHtml = renderInvoiceHtml({
      invoiceNumber: invoiceNumber!,
      formattedDate,
      memberName,
      memberEmail: profile.email,
      addressLine: profile.address_line ?? '',
      cityLine: [profile.postal_code, profile.city].filter(Boolean).join(' '),
      planName: payment.plan_name ?? '—',
      amountStr,
      unitPrice: amountStr,
      reference: payment.mollie_payment_id ?? payment.id,
    })

    if (!RESEND_KEY) return json({ error: true, code: 'RESEND_NOT_CONFIGURED' }, 500)

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: 'Dopamine <noreply@nexxia.net>',
        to: [profile.email],
        subject: `Facture ${invoiceNumber} — ${payment.plan_name ?? 'Dopamine'}`,
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
