// GYM-282 — LE GESTE GÉRANT « ENVOYER UN PUSH À UN MEMBRE », AVEC SON AUTORISATION.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// POURQUOI CETTE FONCTION EXISTE PLUTÔT QU'UNE GARDE DE PLUS DANS send-notification
// ═════════════════════════════════════════════════════════════════════════════════════
// `send-notification` est un TUYAU — son propre commentaire le dit : « cette fonction est un
// tuyau appelé par d'autres ». Un tuyau ne devrait jamais être joignable publiquement, et
// l'autorisation n'est pas son travail : elle appartient à la fonction MÉTIER, qui seule sait
// ce qu'elle envoie et à qui.
//
// L'audit (#239) a montré qu'un appelant CLIENT existait — le dashboard, avec la clé anon et
// le JWT du gérant. Poser le secret partagé sur le tuyau l'aurait cassé, et aucune variante
// ne pouvait le sauver : un navigateur ne peut pas détenir un secret partagé sans le publier.
//
// Cette fonction est la réponse retenue (option 1). Elle garde `verify_jwt = true` — le JWT
// du gérant est ce qui l'identifie — et ajoute les trois vérifications qui manquaient.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// 🔴 LE JETON PUSH EST RÉSOLU ICI, ET LE DASHBOARD NE LE VOIT PLUS
// ─────────────────────────────────────────────────────────────────────────────────────
// Avant, le dashboard LISAIT `profiles.push_token` puis le transmettait dans le corps de la
// requête. Deux problèmes, dont un seul saute aux yeux :
//   · le tuyau poussait un jeton fourni par le client — donc n'importe quel jeton ;
//   · et le navigateur manipulait une donnée qu'il n'a aucune raison de connaître.
// Le jeton ne quitte plus le serveur. Le dashboard envoie un IDENTIFIANT DE MEMBRE, ce qui
// est vérifiable ; un jeton, lui, ne l'est pas.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { INTERNAL_SECRET_ENV, INTERNAL_SECRET_HEADER } from '../_shared/internal-auth.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  try {
    const { member_id: memberId, title, body } = await req.json() as {
      member_id?: string
      title?: string
      body?: string
    }
    if (!memberId || !title || !body) return json({ error: true, code: 'BAD_REQUEST' }, 400)

    // ── 1. QUI APPELLE ? ───────────────────────────────────────────────────────────
    // ⚠️ L'IDENTITÉ VIENT DU JETON, JAMAIS DU CORPS. C'est la règle de `switch_active_gym`
    // (GYM-283) et elle vaut ici pour la même raison : accepter un `admin_id` en paramètre
    // permettrait à n'importe qui d'agir au nom d'un gérant.
    const authHeader = req.headers.get('Authorization') ?? ''
    const asCaller = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user } } = await asCaller.auth.getUser()
    if (!user) return json({ error: true, code: 'UNAUTHENTICATED' }, 401)

    // ── 2. EST-IL GÉRANT, ET DE QUELLE SALLE ? ─────────────────────────────────────
    // Lu en SERVICE_ROLE : la RLS de `profiles` ne laisserait pas l'appelant lire la ligne
    // d'un AUTRE membre à l'étape 3, et on veut les deux lectures sous le même régime pour
    // que la comparaison de salle porte sur la même vérité.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE)
    const { data: caller } = await admin
      .from('profiles')
      .select('role, gym_id')
      .eq('id', user.id)
      .single()

    const ROLES_ADMIN = ['gym_admin', 'super_admin']
    if (!caller || !caller.role || !ROLES_ADMIN.includes(caller.role)) {
      return json({ error: true, code: 'FORBIDDEN' }, 403)
    }
    if (!caller.gym_id) return json({ error: true, code: 'NO_GYM' }, 403)

    // ── 3. LE MEMBRE VISÉ EST-IL DE SA SALLE ? ─────────────────────────────────────
    // 🔴 C'EST LA VÉRIFICATION QUI MANQUAIT, et elle ne peut se faire qu'ici : le tuyau ne
    // reçoit qu'un jeton Expo, qui ne dit rien de la salle à laquelle il appartient.
    //
    // ⚠️ ON COMPARE À `member_gyms`, PAS À `profiles.gym_id`. Cette dernière est la salle
    // ACTIVE du membre : un membre de la salle du gérant qui consulte une AUTRE de ses
    // salles porterait un `gym_id` différent, et le gérant ne pourrait plus le joindre —
    // alors qu'il en est bien le gérant. L'appartenance est dans `member_gyms`, c'est la
    // table de vérité depuis GYM-283.
    const { data: lien } = await admin
      .from('member_gyms')
      .select('member_id')
      .eq('member_id', memberId)
      .eq('gym_id', caller.gym_id)
      .maybeSingle()
    if (!lien) return json({ error: true, code: 'MEMBER_NOT_IN_GYM' }, 403)

    // ── 4. LE JETON, RÉSOLU CÔTÉ SERVEUR ───────────────────────────────────────────
    const { data: cible } = await admin
      .from('profiles')
      .select('push_token')
      .eq('id', memberId)
      .single()
    // Pas de jeton = application jamais installée ou notifications refusées. Ce n'est pas
    // une erreur serveur : c'est un code métier dédié, pour un message dédié.
    if (!cible?.push_token) return json({ error: true, code: 'NO_PUSH_TOKEN' }, 200)

    // ── 5. LE TUYAU, EN SERVEUR-À-SERVEUR ──────────────────────────────────────────
    // ⚠️ `gym_id` TOUJOURS FOURNI (GYM-282) : c'est ce qui réactive la garde de plan de
    // GYM-246, que l'appel du dashboard contournait en ne la renseignant pas.
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SERVICE_ROLE}`,
        [INTERNAL_SECRET_HEADER]: Deno.env.get(INTERNAL_SECRET_ENV) ?? '',
      },
      body: JSON.stringify({
        tokens: [cible.push_token],
        title,
        body,
        data: { type: 'admin_message' },
        gym_id: caller.gym_id,
      }),
    })
    if (!resp.ok) {
      // On relaie le CODE du tuyau sans le réinterpréter : c'est lui qui sait pourquoi il a
      // refusé (plan insuffisant, salle irrésolue), et le dashboard sait déjà les afficher.
      const detail = await resp.json().catch(() => ({}))
      return json({ error: true, code: (detail as { code?: string }).code ?? 'PUSH_FAILED' }, 502)
    }

    return json({ ok: true })
  } catch (e) {
    console.error('[admin-send-push]', e instanceof Error ? e.message : 'unknown')
    return json({ error: true, code: 'INTERNAL' }, 500)
  }
})
