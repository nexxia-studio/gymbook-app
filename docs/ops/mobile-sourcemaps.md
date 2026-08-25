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

## 3. Ce qu'Antoine doit poser

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

### 3.3 Poser l'organisation et le projet

`app.config.ts` lit `SENTRY_ORG` et `SENTRY_PROJECT` dans l'environnement plutôt que de les écrire en dur : ce sont des identifiants de compte, ils n'ont pas leur place dans le dépôt d'une plateforme multi-salles. Laissés vides, le plugin écrit dans `sentry.properties` un repli explicite (« falling back to `SENTRY_ORG` environment variable ») et `sentry-cli` lit l'environnement du build.

Deux façons de les fournir, au choix :

```bash
# a) variables d'environnement EAS (visibles, non secrètes)
eas env:create --scope project --name SENTRY_ORG     --value "<slug-org>"
eas env:create --scope project --name SENTRY_PROJECT --value "<slug-projet>"
```

ou **b)** les ajouter dans `eas.json`, bloc `env` des profils `production` et `preview-staging` (ce ne sont pas des secrets). Ce lot ne les a pas écrits faute de connaître les slugs — les inventer aurait produit une configuration silencieusement fausse.

## 4. Portée : production et preview-staging uniquement

Un secret EAS est visible de **tous** les profils. On neutralise donc explicitement là où l'on n'en veut pas, plutôt que d'espérer qu'il n'y soit pas — `eas.json`, profils `development` et `preview` :

```json
"env": { "SENTRY_DISABLE_AUTO_UPLOAD": "true" }
```

Variable honorée par les deux chaînes de la version installée (`sentry.gradle` : `System.getenv('SENTRY_DISABLE_AUTO_UPLOAD') != 'true'` ; `sentry-xcode.sh` : `if [ "$SENTRY_DISABLE_AUTO_UPLOAD" != true ]`).

Restent donc actifs : **`production`** et **`preview-staging`**, exactement comme demandé.

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
- `no auth token found` → le secret n'est pas posé, ou pas visible du profil ;
- `# no org found, falling back to SENTRY_ORG environment variable` **suivi d'une erreur** → `SENTRY_ORG` / `SENTRY_PROJECT` absents ;
- `SENTRY_DISABLE_AUTO_UPLOAD=true, skipping sourcemaps upload` sur `production` → la variable a fui hors des profils où on la voulait.

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
