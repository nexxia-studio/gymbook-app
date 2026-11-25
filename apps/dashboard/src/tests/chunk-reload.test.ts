// GYM-315 — recharge après déploiement : la DÉCISION, sans navigateur.
//
//     npm --prefix apps/dashboard run test:chunk-reload
//
// Script à corps de module, comme `logo-colors.test.ts` : pas de cadre de test dans ce
// dépôt. Lire la sortie et le code de sortie.
//
// Ce banc n'ouvre aucune page : stockage, horloge et recharge sont injectés. Il protège
// trois promesses — on ne recharge QUE pour un fichier de page disparu, UNE fois par
// fenêtre de 30 s, et JAMAIS si le marqueur anti-boucle ne peut pas être lu ou écrit.
import {
  RELOAD_WINDOW_MS,
  createReloader,
  isChunkLoadError,
  loadOrReload,
  readMarker,
  shouldReload,
  writeMarker,
  type MarkerStorage,
} from '../lib/chunkReload'

let failures = 0
function check(label: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ✓ ${label}`)
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}

function memoryStorage(initial: Record<string, string> = {}): MarkerStorage & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = value },
  }
}
const KEY = 'viniz.chunkReload'
const T0 = 1_800_000_000_000

console.log('\nCAS 1 — les messages réels d\'un fichier de page disparu sont reconnus')
{
  const reels = [
    'Failed to fetch dynamically imported module: https://app.viniz.app/assets/Revenue-DZ6IBpv1.js',
    "'text/html' is not a valid JavaScript MIME type.",
    'Importing a module script failed.',
    'error loading dynamically imported module: https://app.viniz.app/assets/Planning-e938wYDG.js',
  ]
  for (const message of reels) {
    check(message.slice(0, 50), isChunkLoadError(new TypeError(message)))
  }
  check('préchargement CSS de Vite', isChunkLoadError(new Error('Unable to preload CSS for /assets/Planning-BqZ3kT1x.css')))
  check('insensible à la casse', isChunkLoadError(new Error('FAILED TO FETCH DYNAMICALLY IMPORTED MODULE')))
  check('une simple chaîne', isChunkLoadError('Importing a module script failed.'))
  check('un objet { message }', isChunkLoadError({ message: reels[0] }))
  const nommee = new Error('Loading chunk 12 failed')
  nommee.name = 'ChunkLoadError'
  check('name === ChunkLoadError', isChunkLoadError(nommee))
}

console.log('\nCAS 2 — tout le reste suit son chemin actuel')
{
  check('« Failed to fetch » réseau générique', !isChunkLoadError(new TypeError('Failed to fetch')))
  check('« Load failed » (Safari, réseau)', !isChunkLoadError(new TypeError('Load failed')))
  check('TypeError quelconque', !isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'map')")))
  check('Error vide', !isChunkLoadError(new Error()))
  check('null', !isChunkLoadError(null))
  check('undefined', !isChunkLoadError(undefined))
  check('nombre', !isChunkLoadError(42))
  check('objet sans message', !isChunkLoadError({ code: 'PGRST116' }))
  check('message non textuel', !isChunkLoadError({ message: 404 }))
}

console.log('\nCAS 3 — fenêtre de 30 secondes, aux bornes')
{
  check('la fenêtre vaut 30 s', RELOAD_WINDOW_MS === 30_000)
  check('jamais rechargé → on recharge', shouldReload(null, T0))
  check('rechargé à l\'instant → refus', !shouldReload(T0, T0))
  check('29,999 s → refus', !shouldReload(T0, T0 + RELOAD_WINDOW_MS - 1))
  check('30 s pile → on recharge', shouldReload(T0, T0 + RELOAD_WINDOW_MS))
  check('bien après → on recharge', shouldReload(T0, T0 + 3_600_000))
  check('marqueur dans le futur → refus', !shouldReload(T0 + 1, T0))
  check('marqueur illisible (NaN) → refus', !shouldReload(Number.NaN, T0))
  check('marqueur infini → refus', !shouldReload(Number.POSITIVE_INFINITY, T0))
}

console.log('\nCAS 4 — lecture et écriture du marqueur')
{
  const storage = memoryStorage()
  check('absent → null', readMarker(storage) === null)
  check('écriture réussie', writeMarker(storage, { at: T0, path: '/revenue', reason: 'lazy' }))
  const lu = readMarker(storage)
  check('relu à l\'identique', lu !== null && lu.at === T0 && lu.path === '/revenue' && lu.reason === 'lazy')

  for (const brut of ['pas du json', '{}', '{"at":"hier"}', 'null', '[]', '']) {
    const m = readMarker(memoryStorage({ [KEY]: brut }))
    check(`illisible « ${brut} » → horodatage NaN`, m !== null && Number.isNaN(m.at))
  }
  const sansChemin = readMarker(memoryStorage({ [KEY]: `{"at":${T0},"path":7}` }))
  check('champs annexes douteux → chaînes vides', sansChemin !== null && sansChemin.at === T0 && sansChemin.path === '' && sansChemin.reason === '')

  const leveEnLecture: MarkerStorage = { getItem: () => { throw new Error('SecurityError') }, setItem: () => {} }
  const m = readMarker(leveEnLecture)
  check('lecture qui lève → horodatage NaN', m !== null && Number.isNaN(m.at))
  const leveEnEcriture: MarkerStorage = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError') } }
  check('écriture qui lève → false', writeMarker(leveEnEcriture, { at: T0, path: '/', reason: 'lazy' }) === false)
}

console.log('\nCAS 5 — tenter la recharge : une fois, et jamais sans marqueur')
{
  const monter = (storage: MarkerStorage | (() => MarkerStorage), now = T0, isOnline: () => boolean = () => true) => {
    let reloads = 0
    const reloader = createReloader({
      isOnline,
      getStorage: typeof storage === 'function' ? storage : () => storage,
      now: () => now,
      getPath: () => '/revenue',
      reload: () => { reloads++ },
    })
    return { reloader, count: () => reloads }
  }

  {
    const storage = memoryStorage()
    const { reloader, count } = monter(storage)
    check('rien de déclenché au départ', !reloader.hasTriggered())
    check('premier échec → recharge', reloader.attempt('lazy') === true && count() === 1)
    check('marqueur écrit avec chemin et motif', readMarker(storage)?.at === T0 && readMarker(storage)?.path === '/revenue' && readMarker(storage)?.reason === 'lazy')
    check('drapeau levé', reloader.hasTriggered())
    check('second point d\'entrée, même échec → pris en charge, pas de 2e recharge', reloader.attempt('preload') === true && count() === 1)
    check('le motif du marqueur reste celui du premier', readMarker(storage)?.reason === 'lazy')
  }
  {
    // Page fraîchement rechargée : nouvelle instance, marqueur récent.
    const storage = memoryStorage()
    writeMarker(storage, { at: T0 - 5_000, path: '/revenue', reason: 'lazy' })
    const { reloader, count } = monter(storage)
    check('l\'erreur revient dans la fenêtre → refus', reloader.attempt('lazy') === false && count() === 0)
    check('refus → drapeau baissé (Sentry doit recevoir l\'erreur)', !reloader.hasTriggered())
    check('refus → marqueur intact', readMarker(storage)?.at === T0 - 5_000)
  }
  {
    const storage = memoryStorage()
    writeMarker(storage, { at: T0 - RELOAD_WINDOW_MS, path: '/revenue', reason: 'lazy' })
    const { reloader, count } = monter(storage)
    check('après 30 s → recharge de nouveau', reloader.attempt('preload') === true && count() === 1)
    check('marqueur rafraîchi', readMarker(storage)?.at === T0 && readMarker(storage)?.reason === 'preload')
  }
  {
    const { reloader, count } = monter(memoryStorage({ [KEY]: 'corrompu' }))
    check('marqueur illisible → pas de recharge', reloader.attempt('lazy') === false && count() === 0)
  }
  {
    const { reloader, count } = monter({ getItem: () => { throw new Error('SecurityError') }, setItem: () => {} })
    check('lecture qui lève → pas de recharge', reloader.attempt('lazy') === false && count() === 0)
  }
  {
    const { reloader, count } = monter({ getItem: () => null, setItem: () => { throw new Error('QuotaExceededError') } })
    check('écriture qui lève → pas de recharge', reloader.attempt('lazy') === false && count() === 0 && !reloader.hasTriggered())
  }
  {
    const { reloader, count } = monter(() => { throw new Error('sessionStorage interdit') })
    check('accès au stockage qui lève → pas de recharge', reloader.attempt('lazy') === false && count() === 0)
  }
  {
    const storage = memoryStorage()
    let enLigne = false
    const { reloader, count } = monter(storage, T0, () => enLigne)
    check('hors ligne → pas de recharge', reloader.attempt('lazy') === false && count() === 0)
    check('hors ligne → marqueur non écrit', readMarker(storage) === null)
    check('hors ligne → drapeau baissé', !reloader.hasTriggered())
    enLigne = true
    check('de nouveau en ligne → la recharge est accordée', reloader.attempt('lazy') === true && count() === 1 && readMarker(storage)?.at === T0)
  }
  {
    let lectures = 0
    const espion: MarkerStorage = { getItem: () => { lectures++; return null }, setItem: () => {} }
    const { reloader } = monter(espion, T0, () => false)
    reloader.attempt('preload')
    check('hors ligne → le stockage n\'est même pas lu', lectures === 0)
  }
}

console.log('\nCAS 6 — le chargement d\'une page : relancer, attendre, ou rendre le module')
{
  type Etat = 'en attente' | 'résolue' | 'rejetée'
  // « En attente » = ni résolue ni rejetée après plusieurs tours de microtâches.
  const observer = async <T>(promise: Promise<T>): Promise<{ etat: Etat; valeur?: T; erreur?: unknown }> => {
    const vu: { etat: Etat; valeur?: T; erreur?: unknown } = { etat: 'en attente' }
    promise.then(
      (valeur) => { vu.etat = 'résolue'; vu.valeur = valeur },
      (erreur) => { vu.etat = 'rejetée'; vu.erreur = erreur },
    )
    for (let i = 0; i < 10; i++) await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    return vu
  }
  const monter = (marqueur?: number) => {
    const storage = memoryStorage()
    if (marqueur !== undefined) writeMarker(storage, { at: marqueur, path: '/revenue', reason: 'lazy' })
    let reloads = 0
    const reloader = createReloader({
      isOnline: () => true,
      getStorage: () => storage,
      now: () => T0,
      getPath: () => '/revenue',
      reload: () => { reloads++ },
    })
    return { reloader, count: () => reloads }
  }
  const disparu = new TypeError('Failed to fetch dynamically imported module: https://app.viniz.app/assets/Revenue-DZ6IBpv1.js')

  {
    const { reloader, count } = monter()
    const module = { default: 'Page' }
    const vu = await observer(loadOrReload(() => Promise.resolve(module), reloader))
    check('import réussi → le module, tel quel', vu.etat === 'résolue' && vu.valeur === module && count() === 0)
  }
  {
    const { reloader, count } = monter()
    const bug = new TypeError("Cannot read properties of undefined (reading 'map')")
    const vu = await observer(loadOrReload(() => Promise.reject(bug), reloader))
    check('erreur non reconnue → relancée telle quelle, sans recharge', vu.etat === 'rejetée' && vu.erreur === bug && count() === 0 && !reloader.hasTriggered())
  }
  {
    const { reloader, count } = monter()
    const vu = await observer(loadOrReload(() => Promise.reject(disparu), reloader))
    check('fichier disparu, recharge accordée → promesse en attente', vu.etat === 'en attente' && count() === 1)
  }
  {
    const { reloader, count } = monter(T0 - 5_000)
    const vu = await observer(loadOrReload(() => Promise.reject(disparu), reloader))
    check('fichier disparu, recharge refusée → l\'erreur d\'origine est relancée', vu.etat === 'rejetée' && vu.erreur === disparu && count() === 0)
  }
  {
    // L'écouteur vite:preloadError a rechargé et annulé l'événement : Vite résout à undefined.
    const { reloader, count } = monter()
    reloader.attempt('preload')
    const vu = await observer(loadOrReload(() => Promise.resolve(undefined), reloader))
    check('undefined après preventDefault → promesse en attente, une seule recharge', vu.etat === 'en attente' && count() === 1)
  }
  {
    const { reloader, count } = monter()
    const vu = await observer(loadOrReload(() => Promise.resolve(undefined), reloader))
    check('undefined sans recharge en route → rendu tel quel (rien d\'avalé)', vu.etat === 'résolue' && vu.valeur === undefined && count() === 0)
  }
}

console.log(failures === 0 ? '\nTOUT PASSE\n' : `\n${failures} ÉCHEC(S)\n`)
process.exit(failures === 0 ? 0 : 1)
