// GYM-258 — VARIANTE D'APPLICATION.
//
// `EXPO_PUBLIC_APP_VARIANT=staging` (posé par le profil EAS "preview-staging") produit une
// app iOS/Android DISTINCTE — bundle, nom, scheme et icône propres — depuis le MÊME code
// source, pointée sur le Supabase de staging et le clone Dopamine.
//
// ⚠️ RÈGLE DE CE FICHIER : sans la variable, l'objet résolu doit être STRICTEMENT celui
// d'avant ce lot. C'est pourquoi la configuration Dopamine reste écrite telle quelle, d'un
// seul tenant, et que la variante l'ALTÈRE ensuite dans un bloc isolé — plutôt que de
// truffer chaque champ de ternaires, où une faute de frappe changerait la build de
// production sans que personne ne le voie. L'ordre des clés est préservé au passage, donc
// `npx expo config --json` sans variante rend un diff vide (prouvé en PR).
const variant = process.env.EXPO_PUBLIC_APP_VARIANT
const isStaging = variant === 'staging'

const config = {
  expo: {
    name: 'Dopamine',
    slug: 'dopamine',
    // GYM — version marketing (CFBundleShortVersionString). 1.0.0, 1.0.1 puis 1.0.2 sont
    // publiées sur l'App Store : leur train est fermé aux nouvelles soumissions
    // (ITMS-90186) et toute build doit porter une version supérieure (ITMS-90062). Le
    // build 15 est parti en 1.0.1 et a été rejeté pour cette raison, comme le build 14 la
    // semaine d'avant.
    //
    // 1.0.3 — build 19, ouvert après approbation et publication du build 18 (train 1.0.2
    // fermé). Incrément PATCH : GYM-229 (plus de ligne coach vide sur les créneaux Open
    // Gym) et GYM-224 (numéro de badge d'accès dans le hero de /profile) — deux
    // ajustements d'affichage, aucune fonctionnalité nouvelle côté membre.
    //
    // 1.0.4 — build 20, ouvert après approbation du build 19 par Apple le 17/08 (train
    // 1.0.3 fermé). Incrément PATCH : GYM-228 volet 5 (les créneaux Open Gym d'une même
    // journée regroupés en une carte unique sur /accueil et /planning) et GYM-239 (minimum
    // ramené à 8 caractères, aligné sur la politique serveur, et espaces de bordure rognées
    // à la saisie du mot de passe).
    //
    // 1.0.5 — build 21. ⚠️ OUVERT ALORS QUE LE BUILD 20 EST ENCORE EN REVIEW, et c'est
    // délibéré : le train 1.0.4 sera fermé à son approbation, donc attendre ne changerait
    // pas le numéro à poser ici — cela ne ferait que retarder le build. Le seul risque
    // serait un REJET du build 20 : 1.0.4 resterait alors libre, et 1.0.5 sauterait
    // simplement un numéro. Sauter un numéro n'a aucune conséquence côté App Store ; le
    // réutiliser après publication en a une (ITMS-90186 / ITMS-90062).
    // Incrément PATCH : GYM-241 (icônes Dopamine, écran de démarrage noir, logo dans
    // l'animation d'accueil), GYM-242 (horizon de planning réglable à 30 jours, filtres en
    // feuille modale, carte Open Gym annonçant des créneaux et non une somme de places),
    // GYM-93 (frontières de semaine sur le fuseau de la salle, heure juste dans les
    // rappels) et GYM-240 (rejets réseau capturés au lieu d'alerter Sentry pour rien).
    //
    // Le buildNumber, lui, n'est PAS déclaré ici : eas.json le gère
    // (appVersionSource "remote" + autoIncrement).
    version: '1.0.5',
    orientation: 'portrait' as const,
    icon: './assets/icon-dopamine.png',
    userInterfaceStyle: 'automatic' as const,
    newArchEnabled: true,
    // GYM-241 — ÉCRAN DE DÉMARRAGE NATIF. Il affichait `splash-icon.png`, qui était le
    // PLACEHOLDER PAR DÉFAUT D'EXPO (cercles gris concentriques) : même fichier, au SHA
    // près, qu'`adaptive-icon.png`. Jamais remplacé depuis la création du projet — encore
    // le motif « la ressource existe, le consommateur ne la lit pas » (GYM-216/220/224/228),
    // sauf qu'ici c'est la toute première image que voit un membre à l'ouverture.
    //
    // ⚠️ FOND #000000 ET NON #F5F4F0, ET C'EST LE POINT. L'écran animé qui suit
    // (app/index.tsx) est passé au noir pur lui aussi, et affiche EXACTEMENT ce fichier :
    // le passage du natif à l'animé ne se voit plus. Un fond beige suivi d'un fond noir
    // produisait un flash à chaque lancement.
    splash: {
      image: './assets/splash-dopamine.png',
      resizeMode: 'contain' as const,
      backgroundColor: '#000000',
    },
    ios: {
      supportsTablet: false,
      bundleIdentifier: 'be.dopamineclub.app',
      usesAppleSignIn: true,
      // Universal Links (GYM-45 moitié B) : les liens https://links.viniz.app/dopamine/*
      // (ex. confirm-waitlist du mail waitlist) ouvrent l'app au lieu du fallback web.
      // AASA servie par apps/links (/.well-known/apple-app-site-association, paths /dopamine/*).
      associatedDomains: ['applinks:links.viniz.app'],
      infoPlist: {
        NSFaceIDUsageDescription: 'Dopamine utilise Face ID pour sécuriser ta connexion.',
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      // GYM-241 — ICÔNE ANDROID. `adaptive-icon.png` était le placeholder Expo : c'est le
      // logo que Nico et les membres voyaient dans la liste des applications.
      //
      // ⚠️ CE FICHIER EST GÉNÉRÉ, ET IL FALLAIT LE GÉNÉRER. Android ne garantit d'afficher
      // que le CERCLE CENTRAL de 66 % de l'avant-plan ; tout ce qui déborde est rogné par
      // le masque du lanceur. Mesuré sur `icon-dopamine.png` (le « D » en 1024) : le motif
      // atteint 75 % du demi-côté — les pointes de la lettre auraient été coupées.
      // `adaptive-icon-dopamine.png` est ce même « D » remis à l'échelle sur un fond noir
      // 1024×1024, mesuré à 64,1 % : il tient dans la zone sûre avec une marge.
      //
      // ⚠️ `dopamine-logo-d.png` N'A PAS ÉTÉ RETENU malgré son nom : 256×256, soit un
      // quart de la résolution attendue. Il aurait été agrandi par le lanceur, donc flou.
      //
      // backgroundColor NOIR, accordé au fond du logo : l'avant-plan est opaque, un fond
      // beige serait apparu en anneau autour du masque circulaire.
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon-dopamine.png',
        backgroundColor: '#000000',
      },
      package: 'be.dopamineclub.app',
      edgeToEdgeEnabled: true,
    },
    web: {
      favicon: './assets/favicon.png',
      bundler: 'metro' as const,
      output: 'single' as const,
    },
    plugins: [
      'expo-router',
      'expo-secure-store',
      'expo-apple-authentication',
      'expo-local-authentication',
      [
        'expo-notifications',
        {
          icon: './assets/notification-icon.png',
          color: '#C8F000',
        },
      ],
      'expo-web-browser',
      'expo-localization',
      'expo-font',
      // GYM-152 — purpose strings explicites (rejet Apple #2). Le plugin écrit
      // NSPhotoLibraryUsageDescription / NSCameraUsageDescription dans Info.plist.
      // Seul usage réel : app/profile/edit.tsx (photo de profil, pickFromLibrary + caméra).
      // microphonePermission: false → retire NSMicrophoneUsageDescription (pas de vidéo).
      [
        'expo-image-picker',
        {
          photosPermission:
            'Dopamine accède à ta photothèque pour te permettre de choisir une photo de profil, affichée sur ton compte membre.',
          cameraPermission:
            "Dopamine utilise l'appareil photo pour te permettre de prendre une photo de profil, affichée sur ton compte membre.",
          microphonePermission: false,
        },
      ],
      // ── GYM-271 — SOURCE MAPS SENTRY ────────────────────────────────────────────
      // Aujourd'hui une stacktrace de production se lit `main.jsbundle:110664` : le
      // bundle Hermes est minifié, et sans source maps un crash ne désigne aucun
      // fichier, aucune ligne, aucune fonction. Diagnostiquer un bug membre revient à
      // deviner.
      //
      // MÉTHODE RETENUE — le plugin de config officiel de la version INSTALLÉE
      // (@sentry/react-native 7.2.0, vérifié dans node_modules) :
      // `@sentry/react-native/expo` exporte `withSentry`, qui écrit `sentry.properties`
      // et branche les étapes natives (script `sentry-xcode.sh` côté iOS, `sentry.gradle`
      // côté Android). L'upload se fait alors PENDANT le build natif EAS — « Source maps
      // for the Release version of your application are uploaded automatically during the
      // native application build » (docs.sentry.io, plateforme react-native, setup Expo).
      //
      // ⚠️ POURQUOI LA FORME « ENTRÉE DE plugins » ET NON LE WRAPPER `withSentry(config)`
      // MONTRÉ PAR LA DOC : Expo résout `'@sentry/react-native/expo'` vers ce même
      // `withSentry` et l'appelle avec ces props — les deux formes exécutent le même code.
      // Celle-ci laisse la STRUCTURE de ce fichier intacte, ce qui est la règle posée par
      // GYM-258 : la configuration Dopamine reste écrite d'un seul tenant, et la variante
      // staging continue de l'altérer dans son bloc isolé. Re-shaper l'export pour le
      // wrapper aurait touché la ligne même que ce fichier protège.
      //
      // ⚠️ AUCUN TOKEN ICI, JAMAIS. Le plugin AVERTIT explicitement si on lui passe
      // `authToken` (« Detected unsecure use of authToken ») et le retire de la config
      // avant écriture. Le jeton vient de `SENTRY_AUTH_TOKEN`, posé en secret EAS par
      // Antoine — cf. docs/ops/mobile-sourcemaps.md.
      //
      // `organization` / `project` sont lus dans l'environnement plutôt qu'écrits en dur :
      // ce sont des identifiants de compte Sentry, ils n'ont pas leur place dans le dépôt
      // d'une plateforme multi-salles. Laissés à `undefined`, le plugin écrit dans
      // sentry.properties un repli explicite (« falling back to SENTRY_ORG environment
      // variable ») et sentry-cli lit les variables d'environnement du build — comportement
      // lu dans le code du plugin installé, pas supposé.
      [
        '@sentry/react-native/expo',
        {
          url: process.env.SENTRY_URL ?? 'https://sentry.io/',
          organization: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
    scheme: 'dopamine',
    extra: {
      eas: {
        projectId: '3c7e7738-841a-4edb-811f-7247ec1678f9',
      },
      // Active gym id. Override per environment via EXPO_PUBLIC_GYM_ID;
      // defaults to the Dopamine gym so behavior is unchanged without the var.
      gymId: process.env.EXPO_PUBLIC_GYM_ID ?? 'a0000000-0000-0000-0000-000000000001',
    },
  },
}

// ── Variante « Viniz Staging » ────────────────────────────────────────────────────
// Tout ce qui suit ne s'exécute QUE si EXPO_PUBLIC_APP_VARIANT vaut 'staging'. La build
// de production ne traverse jamais ce bloc.
if (isStaging) {
  const e = config.expo

  e.name = 'Viniz Staging'
  // ⚠️ `slug` et `extra.eas.projectId` NE CHANGENT PAS : ils identifient le PROJET EAS,
  // pas l'application. Les deux variantes vivent dans le même projet EAS et se
  // distinguent par leur profil de build et leur canal — changer le slug reviendrait à
  // créer un second projet et à perdre l'historique de builds et les credentials.

  e.ios.bundleIdentifier = 'app.viniz.staging'
  e.android.package = 'app.viniz.staging'
  e.scheme = 'viniz-staging'

  // ⚠️ AUCUN associatedDomains. Les Universal Links https://links.viniz.app/* sont
  // revendiqués par l'app de PRODUCTION via son AASA ; les revendiquer aussi ici ferait
  // se disputer deux apps le même lien sur un même appareil. Conséquence assumée et
  // documentée en PR : sur la variante staging, les liens de réinitialisation de mot de
  // passe et de retour de paiement Mollie ouvrent la page web de repli, pas l'app.
  delete (e.ios as { associatedDomains?: string[] }).associatedDomains

  // Marque Viniz + bandeau STAGING. Générés par scripts/generate-viniz-staging-assets.js
  // à partir des assets du dépôt viniz-site ; AUCUN asset Dopamine n'est touché.
  e.icon = './assets/viniz/icon-staging.png'
  e.splash.image = './assets/viniz/splash-staging.png'
  e.splash.backgroundColor = '#4827B4'
  e.android.adaptiveIcon.foregroundImage = './assets/viniz/adaptive-icon-staging.png'
  e.android.adaptiveIcon.backgroundColor = '#4827B4'

  // La chaîne de permission est affichée par iOS dans une alerte système : y laisser
  // « Dopamine » sur une app nommée « Viniz Staging » désigne la mauvaise application au
  // testeur. Hors de la liste du lot, mais sans effet possible sur la production.
  e.ios.infoPlist.NSFaceIDUsageDescription =
    'Viniz Staging utilise Face ID pour sécuriser ta connexion.'
}

export default config
