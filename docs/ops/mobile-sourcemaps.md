# GYM-271 — Source maps Sentry sur l'app mobile

> Ce document décrit des **gestes de console et de terminal** à faire par Antoine. Le dépôt ne contient ni jeton, ni identifiant de compte Sentry, et **aucune commande `eas` n'a été exécutée** par ce lot.

## 1. Le problème

Une stacktrace de production se lit aujourd'hui `main.jsbundle:110664` : le bundle Hermes est minifié, et sans source maps un crash ne désigne **aucun fichier, aucune ligne, aucune fonction**. Diagnostiquer un bug membre revient à deviner.

## 2. La méthode retenue, et pourquoi

**Plugin de config officiel de la version installée** — `@sentry/react-native` **7.2.0** (vérifié dans `node_modules`, pas supposé : les méthodes d'upload diffèrent d'une version à l'autre).

`@sentry/react-native/expo` exporte `withSentry`, qui écrit `sentry.properties` et branche les étapes natives d'upload (`scripts/sentry-xcode.sh` côté iOS, `sentry.gradle` côté Android). L'upload se fait alors **pendant le build natif EAS** :

> « Source maps for the `Release` version of your application are uploaded automatically during the native application build. »
> — docs.sentry.io, plateforme React Native, setup Expo

**Forme utilisée : une entrée du tableau `plugins`**, et non le wrapper `withSentry(config, …)` montré par la doc. Expo résout `'@sentry/react-native/expo'` vers ce même `withSentry` et l'appelle avec les mêmes props — **les deux formes exécutent le même code**. L'entrée de tableau laisse intacte la structure de `app.config.ts`, ce qu'impose la règle posée par GYM-258 : la configuration Dopamine reste écrite d'un seul tenant, la variante staging l'altère dans son bloc isolé. Re-shaper l'export aurait touché la ligne même que ce fichier protège.

**Alternative écartée** : `scripts/expo-upload-sourcemaps.js` (upload manuel après `expo export`). Il suppose un pipeline d'export JS séparé, que ce projet n'a pas — il construit des binaires natifs via EAS. L'upload au build est le chemin natif du projet.

## 3. Ce qu'Antoine doit poser — **un seul secret**

### 3.1 Créer le jeton Sentry

Sur **sentry.io → Settings → Developer Settings → Organization Tokens** (jeton d'organisation, pas un jeton personnel).

**Scopes minimaux** — n'en donner aucun autre :

| Scope | Pourquoi |
|---|---|
| `project:releases` | créer la release et y attacher les source maps |
| `org:read` | résoudre l'organisation |

> ⚠️ Ne **jamais** accorder `project:write` ni `project:admin` : l'upload n'en a pas besoin, et un jeton de build finit toujours par circuler dans des logs.

### 3.2 Poser le jeton en secret EAS

```bash
cd apps/mobile
eas secret:create --scope project --name SENTRY_AUTH_TOKEN --type string --value "<le jeton>"
```

> 🔴 **Jamais dans le dépôt, jamais dans `eas.json`.** Le plugin lui-même refuse le jeton en clair : passer `authToken` dans sa config déclenche « Detected unsecure use of authToken » et il le retire avant écriture. `eas.json` est versionné — un jeton posé là serait publié.

### 3.3 L'organisation et le projet : **plus rien à poser**

Ils sont désormais **écrits dans `app.config.ts`**, en paramètres du plugin :

```ts
['@sentry/react-native/expo', {
  organization: 'nexxia-studio',
  project: 'dopamine-mobile',
  url: 'https://sentry.io/',
}]
```

🔴 **Pourquoi ce changement.** La première version les laissait à `undefined` en comptant sur le repli du plugin vers `SENTRY_ORG` / `SENTRY_PROJECT`. Ce repli existe bien, mais il ne vaut que si les variables sont réellement posées — elles ne l'ont jamais été, et la build `preview-staging` a échoué à l'étape `sentry-cli` :

```
A project ID or slug is required (provide with --project)
```

Le plugin tournait, chargeait `sentry.properties`, et n'y trouvait aucune cible.

Ces deux valeurs ne sont **ni des secrets, ni des données de salle** : ce sont les coordonnées du projet Sentry de l'app mobile, identiques pour tous les profils. Les versionner, c'est **une** source qui ne peut pas manquer à l'appel — à l'inverse d'une variable d'environnement qu'il faut penser à poser sur chaque profil, et dont l'absence ne se voit qu'au milieu d'une build.

**Seul `SENTRY_AUTH_TOKEN` reste un secret EAS.**

## 4. Portée : production et preview-staging uniquement

Un secret EAS est visible de **tous** les profils. On neutralise donc explicitement là où l'on n'en veut pas, plutôt que d'espérer qu'il n'y soit pas — `eas.json`, profils `development` et `preview` :

```json
"env": { "SENTRY_DISABLE_AUTO_UPLOAD": "true" }
```

Variable honorée par les deux chaînes de la version installée (`sentry.gradle` : `System.getenv('SENTRY_DISABLE_AUTO_UPLOAD') != 'true'` ; `sentry-xcode.sh` : `if [ "$SENTRY_DISABLE_AUTO_UPLOAD" != true ]`).

Restent donc actifs : **`production`** et **`preview-staging`**, exactement comme demandé.

## 4bis. Une build ne doit pas échouer parce que Sentry est en panne

`SENTRY_ALLOW_FAILURE=true` est posé sur `production` et `preview-staging`.

**L'intention** : un jeton expiré, une coupure réseau ou une panne de Sentry ne doivent **jamais** empêcher de livrer un correctif. L'upload de source maps est un confort de diagnostic, pas une dépendance de production.

### 🔴 Constat à connaître : dans la version installée, cette variable ne fait RIEN

Vérifié dans `@sentry/react-native` **7.2.0** et `@sentry/cli` **2.55.0** :

```bash
grep -rn "ALLOW_FAILURE" node_modules/@sentry/ | grep -v "To disable\|To allow failing"
# → aucun résultat
```

`SENTRY_ALLOW_FAILURE` n'apparaît que dans **deux chaînes de message d'erreur**, qui la suggèrent à l'utilisateur — et **n'est lue nulle part**. Dans `scripts/sentry-xcode.sh`, un upload en échec pose `exitCode=1` puis `exit $exitCode`, sans consulter aucune variable :

```sh
else
  echo "error: sentry-cli - ... Or to allow failing upload, set SENTRY_ALLOW_FAILURE=true"
  exitCode=1
fi
...
exit $exitCode
```

La variable est donc posée **par anticipation** : elle est inoffensive, et deviendra effective si une version ultérieure la câble. **Mais aujourd'hui, un échec d'upload fait toujours échouer la build.**

### Le levier qui marche vraiment, en attendant

Si une build est bloquée par Sentry et qu'il faut livrer **maintenant**, relancer avec l'upload désactivé :

```bash
SENTRY_DISABLE_AUTO_UPLOAD=true eas build --profile production --platform ios
```

La build passe ; la release Sentry n'aura pas de source maps, et les stacktraces de cette version-là resteront non symbolisées. C'est le bon arbitrage dans l'urgence — mais il doit être **conscient**, pas subi.

### À revérifier à chaque montée de version

```bash
grep -rn "ALLOW_FAILURE" apps/mobile/node_modules/@sentry/react-native/ | grep -v "To disable\|To allow failing"
```

Un résultat = la variable est enfin câblée, et la protection devient réelle sans rien changer à `eas.json`.

## 5. Release et dist

`Sentry.init` côté app et `sentry-cli` côté build dérivent tous deux la release de l'identité **native** du binaire :

```
be.dopamineclub.app@1.0.5+22
└──── bundleIdentifier ────┘ │  └ buildNumber (posé par EAS, appVersionSource "remote" + autoIncrement)
                       version (app.config.ts)
```

⚠️ **Rien de tout cela n'est écrit à la main, et il ne faut pas commencer.** Poser un `release`/`dist` explicite dans `Sentry.init` créerait deux identités à tenir d'accord — celle de l'app et celle de l'upload — et la première divergence rendrait les source maps inertes sans le moindre message d'erreur. Le `version` de `app.config.ts` et l'auto-incrément EAS suffisent.

Sur la variante staging, le `bundleIdentifier` est `app.viniz.staging` : ses releases apparaissent donc distinctement dans Sentry, sans se mélanger à la production.

## 6. Recette de vérification

### 6.1 Pendant le build

Dans les logs EAS, chercher `sentry-cli`. Attendu :

```
> Analyzing 2 sources
> Uploaded release files to Sentry
> File upload complete
```

**Signes d'échec à ne pas laisser passer** :
- `no auth token found` → le secret `SENTRY_AUTH_TOKEN` n'est pas posé, ou pas visible du profil ;
- `A project ID or slug is required (provide with --project)` → les paramètres `organization` / `project` ont disparu d'`app.config.ts` (c'est l'échec qui a motivé le correctif de §3.3) ;
- `SENTRY_DISABLE_AUTO_UPLOAD=true, skipping sourcemaps upload` sur `production` → la variable a fui hors des profils où on la voulait.

⚠️ **Un upload raté fait aujourd'hui échouer la build** (cf. §4bis) : c'est bruyant, donc difficile à manquer. Le jour où `SENTRY_ALLOW_FAILURE` sera câblé, ce ne sera plus le cas — et un upload silencieusement raté ne se détectera **que** par une stacktrace non symbolisée dans Sentry, ou par une release sans artifact (§6.2). C'est la contrepartie assumée de ne plus bloquer les livraisons.

### 6.2 Dans Sentry

**Releases** → une entrée `be.dopamineclub.app@<version>+<build>` doit apparaître, avec des **Artifacts** (les `.map`). Une release sans artifact = upload non fait.

### 6.3 Sur l'appareil — le seul test qui compte

Provoquer une erreur dans la build installée, puis ouvrir l'événement dans Sentry :

- **Avant** : `main.jsbundle:110664`
- **Attendu après** : `stores/useBookingStore.ts:137`, avec le code source autour de la ligne

⚠️ **Ne pas tester en développement** : « During development, the source code is resolved using the Metro Server and source maps aren't used » (doc Sentry). Le test doit se faire sur une build EAS `production` ou `preview-staging`.

### 6.4 Non-régression de la configuration

```bash
cd apps/mobile
npx expo config --json                                  # défaut Dopamine
EXPO_PUBLIC_APP_VARIANT=staging npx expo config --json  # variante
```

Comparés à la référence d'avant ce lot, le **seul** écart attendu est l'entrée `@sentry/react-native/expo` dans `plugins` (et son marqueur `_internal.pluginHistory`). Tout le reste — nom, bundle, icônes, splash, `associatedDomains`, `extra.gymId` — doit être identique. La preuve est dans la PR GYM-271.
