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

### GYM-102 (4/5) — l'entrée Viniz est désormais présente

Le fichier sert maintenant **deux applications**, et l'ordre y est porteur de sens.

```
details[0]  be.dopamineclub.app   paths: ["/dopamine/*"]          ← INCHANGÉ
details[1]  app.viniz             components:
                                    1. "/dopamine/*"  exclude ← DOIT RESTER EN PREMIER
                                    2. "/*"
```

**🔴 Le risque que ces deux règles écartent.** `links.viniz.app` sert `/dopamine/*` à
l'app de Nico. Si l'app Viniz revendiquait les mêmes chemins, deux apps se disputeraient
le même lien sur un appareil où les deux sont installées, et iOS trancherait de façon
imprévisible : un membre de Dopamine cliquant son lien de réinitialisation de mot de passe
pourrait ouvrir l'app Viniz, où il n'a pas de compte. **Rien dans le fichier ne signale
cette erreur** — elle ne se voit que sur un téléphone, chez un client.

Deux garanties indépendantes sont donc posées :

1. **L'ordre des dictionnaires.** Apple : « The order of the dictionaries in the array
   determines the order the system follows when looking for a match. » Dopamine est en
   premier.
2. **L'exclusion explicite.** Apple : « You can exclude such subsections by specifying the
   `exclude` key with a Boolean value of `true`. This key has the same behavior as a `not`
   keyword that you used in the old `paths` key. » Et : « the system evaluates each path
   […] in the order it is specified — and stops evaluating when a positive or negative
   match is found ». D'où l'exclusion **avant** le `/*`.

**⚠️ `exclude` n'existe QUE dans `components`.** Le mot-clé `NOT ` de l'ancien format
`paths` n'est pas reconnu dans `components`, et réciproquement. Les deux entrées de ce
fichier utilisent donc des formats différents — c'est volontaire : celle de Dopamine n'est
pas touchée, celle de Viniz utilise le format moderne (iOS 13+, très en dessous de la
cible de l'app).

**⚠️ `appID` À CONFIRMER AVANT DÉPLOIEMENT.** `2B239M7MJL.app.viniz` est le bundle
identifier attendu de l'app Viniz de production, qui **n'existe pas encore** (lot 5).
Le Team ID `2B239M7MJL` est celui de Dopamine. Un `appID` faux ne produit **aucune
erreur** : l'association échoue en silence et les liens s'ouvrent dans le navigateur.

**La variante « Viniz Staging » (`app.viniz.staging`) n'est PAS dans ce fichier**, et c'est
cohérent : `app.config.ts` lui **retire** ses `associatedDomains` (GYM-258). Elle ignore
donc cet AASA. Le jour où quelqu'un lui rend ses associated domains, il devra ajouter son
appID ici — sans quoi ses liens resteront muets.

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
