# Xcode 27 — la cible de déploiement vient du dépôt

**Branche** `gym-xcode27-deployment-target` · **base** `develop` · aucun déploiement,
**aucun build**. Configuration native uniquement.

---

## La valeur exacte : **15.1**

Et ce n'est pas un choix arbitraire — c'est **la valeur déjà en vigueur**, vérifiée sur le
projet généré plutôt que supposée :

| Source | Valeur |
|---|---|
| Podfile du SDK 54 | `podfile_properties['ios.deploymentTarget'] \|\| '15.1'` |
| `min_ios_version_supported` de React Native 0.81 | `'15.1'` |
| Projet Xcode de l'app, avant ce lot | `IPHONEOS_DEPLOYMENT_TARGET = 15.1` (×4) |

> **On ne relève rien. On fige ce qui était déjà calculé.**

### Compatibilité avec les iPhone des membres

**Aucun membre n'est perdu, et c'est structurel** : les binaires publiés ciblent **déjà**
iOS 15.1 — c'est le projet de l'app qui détermine le `MinimumOSVersion` du binaire, et il ne
bouge pas d'un chiffre. iOS 15 couvre l'**iPhone 6s et au-delà** (2015), soit exactement le
parc que la 1.2.1 sert aujourd'hui.

---

## 🔴 Ce que j'ai trouvé en le faisant : `expo-build-properties` seul n'aurait rien changé

C'est le point qu'il faut lire avant de merger.

**Relevé sur le projet Pods généré localement, avant le lot :**

```
216 × IPHONEOS_DEPLOYMENT_TARGET = 15.1
  2 × 13.4      2 × 12.4      2 × 11.0
```

Six réglages récalcitrants — **trois cibles × deux configurations** (Debug/Release). Et ces
trois-là **ne sont pas des pods** : ce sont des **bundles de ressources** —
`RNCAsyncStorage_resources`, `RNSVGFilters`, et le bundle de confidentialité de `Sentry`.

Ce qui explique que rien ne les atteigne :

- le `platform :ios` du Podfile vaut **déjà 15.1** (défaut du SDK 54) ;
- `react_native_post_install` appelle bien `updateOSDeploymentTarget`, qui relève chaque pod
  à `min_ios_version_supported` — mais il n'itère que
  `pod_target_installation_results[].native_target`, **jamais les bundles de ressources** ;
- `expo-build-properties` écrit `ios.deploymentTarget` dans `Podfile.properties.json` **et**
  règle le projet de l'app — **deux endroits qui étaient déjà à 15.1**.

> **Déclarer `ios.deploymentTarget` seul aurait écrit 15.1 là où il y avait déjà 15.1.**
> Les six réglages fautifs seraient restés, et Xcode 27 aurait continué de refuser.

C'est pourquoi le lot ajoute **aussi** un greffon de configuration
(`plugins/withPodsDeploymentTarget.js`) qui insère, dans le `post_install` existant, une
boucle relevant **toute** cible du projet Pods située **en dessous** de 15.1 — bundles de
ressources compris. Une cible déjà plus haute n'est jamais abaissée.

⚠️ **Le greffon échoue bruyamment s'il ne trouve pas son ancre** dans le Podfile. Un greffon
qui ne trouverait rien et se tairait laisserait croire que le réglage est appliqué — c'est le
motif que ce dépôt corrige depuis des semaines : **le retour non lu**. Si le gabarit Expo
change, on l'apprendra au `prebuild`, pas à la compilation.

---

## La preuve : mesurée avant / après, sur un vrai `pod install`

`npx expo prebuild --platform ios --clean` puis `pod install`, puis recomptage du
`Pods.xcodeproj` généré.

| | Avant | Après |
|---|---|---|
| Cibles à 15.1 | 216 | **222** |
| Cibles **sous 15.0** (le refus de Xcode 27) | **6** | **0** |
| Projet de l'app | 4 × 15.1 | **4 × 15.1 — inchangé** |

Et le `Podfile.properties.json` régénéré porte bien `"ios.deploymentTarget": "15.1"`.

**Les six réglages fautifs ont disparu. Les 216 conformes n'ont pas bougé.**

---

## ⚠️ Ce que ça change pour les builds EAS distants : rien

Tu demandais de le vérifier — c'est la chaîne qui produit nos binaires publiés.

1. **Le projet de l'app est identique** : 15.1 avant, 15.1 après. C'est lui qui fixe le
   `MinimumOSVersion` du binaire.
2. **La ligne `platform :ios` résout à la même valeur** : le défaut `|| '15.1'` est remplacé
   par la propriété `'15.1'`. Même nombre, écrit explicitement.
3. **Les seuls écarts sont les six réglages de bundles de ressources**, qui montent **à la
   valeur de leurs 216 voisines**. Aucun binaire ne cible une version plus haute qu'avant —
   un bundle de ressources ne porte pas le minimum OS de l'app.

Autrement dit : **le build distant produit le même binaire, avec six avertissements en
moins.** Le seul changement observable est qu'il compile aussi **en local**.

---

## Ce que ça nous rend

La compilation locale, donc la capacité de tester un correctif mobile **sans consommer de
quota de build**. Sur les six derniers jours, l'absence de cette capacité a coûté **six
membres bloqués** et trois allers-retours de version (1.2.1 → 1.2.2 → 1.2.3) dont deux
n'auraient pas eu lieu si le correctif avait pu être essayé sur un appareil avant d'être
soumis.

---

## Les preuves

- **`tsc` mobile — exit 0**
- **`expo config --json`** résout les deux greffons, dans l'ordre, avec `15.1`
- **`prebuild` + `pod install` rejoués** : 222 cibles à 15.1, **0 sous 15.0**
- **`package.json` : une seule ligne ajoutée** (`expo-build-properties: ~1.0.10`)

⚠️ **`expo prebuild` avait réécrit deux scripts npm** (`android` et `ios`, de
`expo start --…` vers `expo run:…`). **Hors périmètre — remis en l'état.** Le diff de
`package.json` ne porte que la dépendance.

⚠️ **`ios/` reste ignoré par git** : le dossier régénéré n'entre pas dans ce lot. C'est tout
l'objet du greffon — le réglage vient du dépôt, pas d'un dossier que `prebuild` efface.

### Ce que je n'ai pas

**Aucune compilation Xcode 27.** Cette machine n'en dispose pas : ce qui est prouvé ici, c'est
que **plus aucune cible ne tombe sous 15.0** dans le projet généré — la condition exacte que
Xcode 27 refuse. Que le build aboutisse ensuite se vérifie chez toi, en une commande.
