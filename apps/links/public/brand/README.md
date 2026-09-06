# Les fichiers de marque Viniz, publics et stables

**Ce dossier est une URL, pas un répertoire de travail.** `apps/links` est un site
STATIQUE sans build : tout ce qui est ici est servi tel quel sur
`https://links.viniz.app/brand/…`, et ces URL sont citées dans du code déployé ailleurs.
Renommer un fichier casse ce qui le cite ; le supprimer casse des emails déjà partis.

| fichier | dimensions | qui le consomme |
|---|---|---|
| `viniz-wordmark-lime.svg` | toile 1500 × 1500 | la SOURCE. Les deux PNG en sont tirés, et `_viniz/reset-password.html` l'affiche. |
| `viniz-wordmark-lime.png` | 250 × 50, alpha | les surfaces qui rendent à ~125 px. |
| `viniz-wordmark-lime@2x.png` | 499 × 98, alpha | **l'en-tête des emails d'authentification** (`supabase/functions/auth-email-hook`). |

## Pourquoi un PNG, alors que le SVG existe

Gmail et Outlook ne rendent pas les SVG. `_shared/gym-branding.ts` le sait et s'en
protège : `headerHtml` n'affiche une `<img>` que si l'URL est en `https` **et** finit par
`.png` — sinon il retombe sur le nom en texte. « Un logo cassé est pire qu'un texte
juste ». Pointer ce hook vers le SVG ne l'aurait donc pas cassé : ça n'aurait simplement
rien fait, en silence.

## Pourquoi le `@2x` dans l'email et pas le 1x

`headerHtml` rend le logo à `width="160"` en dur (Outlook ignore les largeurs relatives).
Le 1x mesure 250 px : il est déjà réduit, et flou sur un écran à haute densité. Le `@2x`
en fait 499, soit ~3× la taille rendue — net partout, pour 10 Ko.

## ⚠️ Ce dossier ne touche pas à l'AASA

`links.viniz.app` déclare `/*` comme Universal Link de l'app Viniz. Ces fichiers sont
servis par l'étape FILESYSTEM de Vercel, **avant** les rewrites, et `vercel.json` n'a pas
été modifié : aucun chemin déclaré par l'AASA n'est altéré, et
`/.well-known/apple-app-site-association` n'est intercepté par rien. Un `<img src>` est
une requête HTTPS ordinaire — les Universal Links n'interceptent que des NAVIGATIONS, pas
des chargements d'image. Voir `apps/links/scripts-verif-aasa.sh`.

## ⚠️ Ce SVG est le MÊME fichier que celui du tableau de bord

`apps/dashboard/src/assets/brand/viniz-logo-horizontal-lime.svg` a le même md5. Le
tableau de bord le bundle par Vite ; ce site est statique et n'a pas de bundler, il lui
faut donc sa propre copie servie par URL. **Les deux doivent rester identiques** : si l'un
change, changer l'autre.

## Le logotype est posé dans une toile CARRÉE — il se recadre à l'affichage

L'art occupe `x [121, 1288]`, `y [635, 862]` de la toile de 1500, soit un ratio de **5,12**,
centré à 1,5 px près. Affiché tel quel, il flotterait dans le vide.

Le produit le cadre depuis toujours dans une boîte 5:1 à `overflow:hidden`, image centrée —
`AuthLayout` (200 × 40), `Sidebar` (180 × 36 et 140 × 28). Trois boîtes, un seul ratio. Les
deux PNG exportés le recoupent (5,00 et 5,09). **Reprends cette boîte plutôt que d'inventer
un `viewBox`**, c'est la technique déjà en production.

## Régénérer les PNG## Régénérer les PNG

Le dépôt n'a pas de rastériseur (`sharp` absent, cf. `apps/mobile/scripts/generate-icons.js`).
Les deux PNG viennent du SVG ci-dessus, recadrés sur l'emprise du logotype et exportés en
250 × 50 et 499 × 98 avec fond TRANSPARENT. Le fond de l'en-tête d'email vient de
`secondary_color`, lu en base : un PNG à fond opaque y afficherait un rectangle.
