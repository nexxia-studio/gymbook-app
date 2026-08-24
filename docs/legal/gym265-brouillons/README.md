# GYM-265 — Brouillons légaux v0, pour relecture juridique

⚠️ **Ces fichiers sont GÉNÉRÉS depuis le code**, pas l'inverse.

La source de vérité est `apps/dashboard/src/lib/legalContent.ts` (textes) et
`apps/dashboard/src/lib/legalEditor.ts` (identité de l'éditeur). Ces markdown sont un
**rendu figé**, produit pour que la relecture juridique se fasse sur des fichiers simples
plutôt que dans du TypeScript. Les annoter ici est utile ; les corriger ici ne change
**rien** au site.

C'est l'inverse de la convention des autres fichiers de `docs/legal/`
(`cgv-v1.md`, `politique-confidentialite-v1.md`), qui sont eux la source des textes
recopiés dans le code. À trancher lors de la validation : quelle direction on garde.

## Contenu

| Fichier | Ce que c'est |
|---|---|
| `cgu-plateforme-v0.fr.md` / `.en.md` | **CGU plateforme** — Nexxia ↔ le gérant. Document NOUVEAU, sans équivalent antérieur. |
| `cgv-salle-v0.fr.md` / `.en.md` | **CGV de la salle** — gabarit rendu avec une salle COMPLÈTE (données réelles de Dopamine, GYM-180). |
| `cgv-salle-INCOMPLETE.fr.md` | Le même gabarit avec une salle qui n'a **rien** saisi : montre où apparaît `[à compléter par la salle]`. |
| `cgv-salle-GENERIQUE.fr.md` | Ce que voit un visiteur **sans salle résolue** dans l'URL. |
| `privacy-v0.fr.md` / `.en.md` | **Politique de confidentialité** — URL publiée sur les stores, identité corrigée, section 2 « votre salle et vos données » ajoutée. |

## Statut

Les trois documents portent, sur le site, un bandeau **« Version provisoire — en attente
de validation juridique »**. Il se retire document par document en basculant son drapeau
dans `LEGAL_DRAFT` (`legalContent.ts`).

La liste des points à faire trancher est dans la description de la PR GYM-265.
