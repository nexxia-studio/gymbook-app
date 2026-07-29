// Lit le code d'erreur métier renvoyé par une Edge Function.
//
// supabase-js emballe une réponse HTTP en erreur dans une FunctionsHttpError dont le corps
// original n'est accessible que via `error.context` (une Response non consommée). Sans ça,
// on ne dispose que d'un « Edge Function returned a non-2xx status code » inexploitable
// pour afficher un message précis à l'utilisateur.
export async function extractErrorCode(error: unknown): Promise<string | undefined> {
  const ctx = (error as { context?: Response } | null)?.context
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json()
      return body?.code as string | undefined
    } catch {
      /* corps non-JSON */
    }
  }
  return undefined
}
