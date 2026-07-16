# @viniz/links — infra de liens (links.viniz.app)

Projet **web statique** (pas de SPA, pas de build) déployé comme **projet Vercel séparé**
sur `links.viniz.app`. Rôle : héberger l'infra de **Universal Links multi-app** de Viniz
(fichier `apple-app-site-association` + pages de fallback/cible des liens).

## Structure

```
public/
  .well-known/apple-app-site-association     # AASA (JSON, SANS extension, SANS redirection)
  dopamine/confirm-waitlist/index.html        # page confirm-waitlist (fallback + cible UL)
vercel.json                                   # static, header JSON sur l'AASA, PAS de rewrite catch-all
```

## apple-app-site-association

Format `applinks` avec un **tableau `details`** (multi-app dès le départ). Aujourd'hui, une
seule app : **Dopamine** (`2B239M7MJL.be.dopamineclub.app`) sur les paths `/dopamine/*`.

- `2B239M7MJL` = Team ID Apple.
- `be.dopamineclub.app` = bundle identifier de l'app Dopamine (vérifié en lecture seule dans
  `apps/mobile/app.config.ts`).

### Ajouter l'app Viniz (multi-tenant) plus tard

Ajouter une **2e entrée** dans `details`, sans toucher à celle de Dopamine :

```json
{
  "appID": "2B239M7MJL.be.viniz.app",   // appID réel de l'app Viniz à confirmer
  "paths": ["/viniz/*"]
}
```

puis créer les pages sous `public/viniz/…`. Ne PAS créer cette entrée maintenant.

## Servir l'AASA correctement (contraintes Apple)

- Servi tel quel à `https://links.viniz.app/.well-known/apple-app-site-association`
- **Content-Type `application/json`** (header explicite dans `vercel.json`)
- **Aucune redirection**, **aucune extension** de fichier
- **Pas de rewrite catch-all** vers `index.html` (le piège classique qui casse l'AASA)

## Cycle Universal Links (GYM-45)

- **Moitié A (ce projet)** : infra web = AASA + page fallback. Les emails/notifications
  pointent déjà vers `https://links.viniz.app/dopamine/confirm-waitlist?booking=…`.
- **Moitié B (après review App Store)** : ajouter les **Associated Domains**
  (`applinks:links.viniz.app`) dans le **build iOS**. iOS interceptera alors les URLs
  `/dopamine/*` et ouvrira l'app directement. La page confirm-waitlist reste le fallback
  (app non installée / navigateur).
