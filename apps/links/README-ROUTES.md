# `apps/links` — routes, et pourquoi elles sont écrites ainsi

> GYM-287 / GYM-303 / GYM-320. Ce fichier existe parce que la règle qui protège les Universal Links
> de Dopamine n'est lisible NULLE PART ailleurs : elle tient à un détail de l'ordre
> d'évaluation de Vercel, et quiconque ajouterait un rewrite sans le connaître casserait
> les liens d'un client sans qu'aucune erreur ne le signale.

## 🔴 LA RÈGLE QUI PROTÈGE L'AASA

Vercel évalue dans cet ordre : **`headers` → `redirects` → SYSTÈME DE FICHIERS → `rewrites`**.

Un rewrite n'est donc consulté que si **aucun fichier réel** ne correspond. Cela suffit à
garantir les deux invariants du ticket, **par construction et non par vigilance** :

| chemin | fichier réel ? | verdict |
|---|---|---|
| `/.well-known/apple-app-site-association` | ✅ oui | servi par le FICHIER, aucun rewrite ne le voit |
| `/dopamine/reset-password` … `/dopamine/payment-success` | ✅ oui (5 `index.html`) | servis par les FICHIERS, inchangés |
| `/studio-kama/reset-password` | ❌ non | rewrite → relais générique |
| `/studio-kama/confirm` | ❌ non | rewrite → relais de confirmation (GYM-320) |
| `/studio-kama/bookings` | ❌ non | rewrite → 404 Viniz |

⚠️ **`:slug` capture aussi `dopamine`** — et c'est sans conséquence, précisément parce que
les fichiers de Dopamine existent et gagnent avant tout rewrite. Ne PAS « corriger » cela
par une exclusion : elle donnerait l'illusion que la protection vient de là.

## Pourquoi des routes ÉNUMÉRÉES et pas un attrape-tout

Un `/(.*)` → 404 serait, d'après la règle ci-dessus, tout aussi sûr. Le ticket demande la
version conservatrice au moindre doute : **elle est ici**. Les six noms de page sont les
seuls que l'app et les emails fabriquent (`memberLink`, `gymUrls.ts`), donc l'énumération
couvre 100 % du trafic réel.

> **Alternative remontée au cockpit, non appliquée** : un attrape-tout
> `{ "source": "/(.*)", "destination": "/_viniz/404.html" }` placé APRÈS ces six règles
> couvrirait aussi les chemins inventés (`/studio-kama/nimporte-quoi`), qui rendent
> aujourd'hui le 404 nu de Vercel. Il repose entièrement sur l'ordre d'évaluation ci-dessus.

## Routes — AVANT / APRÈS

| route | AVANT | APRÈS |
|---|---|---|
| `/.well-known/apple-app-site-association` | 200 · `application/json` | **inchangé** |
| `/dopamine/{5 pages}` | 200 · pages Dopamine | **inchangé, octet pour octet** |
| `/<autre-slug>/reset-password` | **404 nu (79 o)** | 200 · relais Viniz → dashboard `?gym=<slug>` |
| `/<slug>/confirm` **y compris `/dopamine/confirm`** | **404 nu (79 o)** | 200 · relais de confirmation brandé (GYM-320) |
| `/<autre-slug>/bookings` | **404 nu (79 o)** | 200 · 404 Viniz |
| `/<autre-slug>/confirm-waitlist` | **404 nu (79 o)** | 200 · 404 Viniz |
| `/<autre-slug>/delete-account` | **404 nu (79 o)** | 200 · 404 Viniz |
| `/<autre-slug>/payment-success` | **404 nu (79 o)** | 200 · 404 Viniz |
| `/<autre-slug>/<inconnu>` | 404 nu | **404 nu** (voir alternative ci-dessus) |

## Vérification

```bash
bash apps/links/scripts-verif-aasa.sh            # production
bash apps/links/scripts-verif-aasa.sh <preview>  # déploiement de preview
```

Les deux sorties doivent être **identiques** sur les blocs « AASA » et « chemins déclarés ».

## GYM-320 — `/:slug/confirm`

`apps/mobile/lib/gymUrls.ts` fabrique `links.viniz.app/<slug>/confirm` depuis GYM-293 et le
passe en `emailRedirectTo`. **La page n'avait jamais été écrite** : mesuré le 07/09,
`/dopamine/confirm`, `/studio-inconnu/confirm`, `/confirm` et `/_viniz/confirm` rendaient
tous le 404 nu de Vercel (79 octets).

⚠️ **`/dopamine/confirm` change de comportement, et c'est voulu.** Ce chemin est couvert par
la déclaration `/dopamine/*` de l'AASA, mais **aucun fichier ne l'a jamais servi** — il
tombait dans le 404 nu. Il passe donc au relais générique, comme toute autre salle. Les
**cinq** pages Dopamine qui existent en fichier restent servies par leurs fichiers, octet
pour octet : c'est la règle du système de fichiers ci-dessus, vérifiée au sha256 en PR.

🔴 **`/confirm` NU (sans slug) RESTE EN 404, délibérément.** `/:slug/confirm` exige deux
segments. Aucun émetteur ne produit cette forme — `gymUrls.ts` écrit toujours un slug, avec
`GYM_SLUG` en repli — et la couvrir demanderait soit une seconde règle, soit l'attrape-tout
qui appartient à **GYM-322**. Une ligne suffirait le jour où on le veut :
`{ "source": "/confirm", "destination": "/_viniz/confirm.html" }`.
