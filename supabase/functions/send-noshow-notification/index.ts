// GYM-33 → GYM-174 — Balayage périodique des créneaux terminés.
//
// INVERSION GYM-174 : "non pointé = présent". process_no_shows NE DÉTECTE PLUS de no-show
// et N'APPLIQUE PLUS de pénalité — la détection d'absence est désormais un acte explicite
// du gérant (Edge mark-attendance). La RPC refondue se contente de finaliser en 'attended'
// les réservations 'confirmed' dont le créneau est terminé depuis plus de 24h.
//
// Cette fonction (toujours appelée par pg_cron toutes les 30 min via X-Internal-Secret)
// devient donc un simple déclencheur du RPC refondu. Elle N'ENVOIE PLUS AUCUNE notification :
// une finalisation "présent par défaut" n'est pas un événement à notifier au membre.
//
// Nom de fonction conservé pour ne pas casser le job pg_cron existant.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const INTERNAL_SECRET = Deno.env.get('INTERNAL_FUNCTIONS_SECRET') ?? ''

interface FinalizedBooking {
  finalized_booking_id: string
  member_id: string
  gym_id: string
}

Deno.serve(async (req) => {
  const providedSecret = req.headers.get('X-Internal-Secret')
  if (!INTERNAL_SECRET || providedSecret !== INTERNAL_SECRET) {
    console.warn('[send-noshow-notification] Unauthorized — invalid X-Internal-Secret')
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, serviceKey)

    // Finalise en 'attended' les réservations dont le créneau est clos depuis > 24h.
    // Aucune pénalité, aucune notification (inversion GYM-174).
    const { data: finalized, error } = await supabase.rpc('process_no_shows')
    if (error) {
      console.error('[send-noshow-notification] RPC error:', error)
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      })
    }

    const count = (finalized as FinalizedBooking[] | null)?.length ?? 0
    console.log('[send-noshow-notification] finalized as attended (GYM-174 inversion):', count)
    return new Response(JSON.stringify({ finalized: count }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[send-noshow-notification] uncaught:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
})
