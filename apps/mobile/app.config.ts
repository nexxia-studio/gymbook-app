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
// 🔴 LA VARIANTE RÉPOND À UNE SEULE QUESTION : QUELLE APP BÂTIT-ON ?
//   (absente) → Dopamine Performance Club  · be.dopamineclub.app
//   'staging' → Viniz Staging              · app.viniz.staging
//   'viniz'   → Viniz                      · app.viniz
//
// ⚠️ ELLE NE DIT PAS L'ENVIRONNEMENT, et c'est pourquoi cette valeur ne s'appelle PAS
// « production ». La build de production de Dopamine ne pose AUCUNE variante : lire
// `EXPO_PUBLIC_APP_VARIANT=production` dans eas.json ferait naturellement penser qu'elle
// la décrit, alors qu'elle décrirait une AUTRE app. L'environnement est déjà porté par le
// nom du profil et par `distribution` — le doubler ici n'ajouterait que l'ambiguïté.
const isViniz = variant === 'viniz'

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
    // 1.0.6 — train 1.0.5 FERMÉ : son build 22 est publié sur l'App Store ET sur le Play
    // Store (confirmé le 26/08). Le numéro de version doit donc être supérieur
    // (ITMS-90186 / ITMS-90062) — contrairement à l'ouverture de 1.0.5, il n'y a ici
    // aucune incertitude à arbitrer.
    //
    // ⚠️ AUCUN NUMÉRO DE BUILD N'EST ANNONCÉ ICI, et c'est délibéré : le bloc 1.0.5
    // annonçait « build 21 », le train est finalement parti en 22. L'autoIncrement d'EAS
    // décide, pas ce commentaire — écrire une prévision revient à inscrire une valeur qui
    // sera fausse et que personne ne viendra corriger.
    //
    // Incrément PATCH — aucune fonctionnalité nouvelle côté membre : ce train est
    // entièrement consacré à l'OBSERVABILITÉ et à trois défauts constatés en test, à trois
    // semaines de l'ouverture de Dopamine. Ce qu'il apporte :
    //  · GYM-269 — fin des déconnexions inexpliquées téléphone verrouillé. Le jeton de
    //    session est réécrit en AFTER_FIRST_UNLOCK ; l'entrée existante est SUPPRIMÉE puis
    //    recréée, sans quoi la migration n'aurait touché aucun membre déjà connecté.
    //  · GYM-270 — erreurs des Edge Functions enfin lisibles (le code métier était dans un
    //    corps que supabase-js ne lit pas), refus normaux retirés de Sentry, et message
    //    « Pas de connexion » sur Réserver ET Annuler — deux boutons qui ne faisaient
    //    RIEN hors ligne.
    //  · GYM-271 — source maps Sentry : une stacktrace désigne un fichier et une ligne, au
    //    lieu de `main.jsbundle:110664`.
    //  · GYM-272 — capture des écrans. L'autocapture n'avait JAMAIS fonctionné (le hook de
    //    navigation de PostHog est monté au-dessus du navigateur d'Expo Router) : zéro
    //    $screen en trente jours.
    //  · GYM-273 — événements métier : paiement, connexion, liste d'attente, et
    //    booking_failed avec son code. `gym_id` en super-propriété — l'ajouter plus tard
    //    ne rattraperait jamais l'historique.
    //  · GYM-277 — les événements portent leur environnement (staging / production), pour
    //    que le banc d'essai ne pollue pas les chiffres de la salle.
    //
    // ⚠️ RIEN DE TOUT CELA N'EST VISIBLE À L'ÉCRAN, à trois exceptions près : les deux
    // messages hors ligne et l'absence de déconnexions intempestives. C'est un train de
    // diagnostic — il est publié maintenant parce que l'historique d'usage des premières
    // semaines ne se rattrape pas.
    //
    // 1.1.0 — PREMIER SAUT MINOR. 🔴 LA 1.0.6 N'A JAMAIS ÉTÉ SOUMISE : elle est restée en
    // BROUILLON chez Apple, et un brouillon ne ferme pas de train. Son numéro de version
    // marketing n'est donc PAS consommé — ITMS-90186 / ITMS-90062 ne s'appliquent qu'aux
    // versions effectivement PUBLIÉES. Rien n'obligeait à passer par 1.0.7 : le numéro
    // était libre, et c'est la seule raison pour laquelle ce saut ne coûte rien.
    //
    // ⚠️ NE PAS LIRE CE BLOC COMME UN PRÉCÉDENT. Sauter des numéros ne se décide que
    // lorsque le train précédent est resté non publié. Dès que la 1.1.0 sera sur l'App
    // Store, la règle des blocs 1.0.3 → 1.0.6 reprend telle quelle : incrément strict
    // au-dessus du train fermé.
    //
    // POURQUOI MINOR ET NON PATCH. Le bloc 1.0.6 décrit un train de diagnostic, invisible à
    // l'écran. Celui-ci est l'exact inverse : c'est le passage de l'app Dopamine à une app
    // WHITE-LABEL, et un membre voit la différence dès le premier écran.
    //  · GYM-102 — le socle multi-salles : résolveur de salle, écran « trouver sa salle »,
    //    plafond membres côté Edge, et le mode DÉCLARÉ plutôt que déduit (cf. le bloc de
    //    `extra.gymMode` plus bas, qui est né de ce lot).
    //  · GYM-286 / GYM-290 — le DESIGN SYSTEM PAR SALLE. Les couleurs ne sont plus des
    //    constantes Dopamine dispersées dans les écrans : elles passent par des jetons
    //    sémantiques (74 fichiers migrés) alimentés par la salle, et le garde-fou de
    //    lisibilité tranche sur un contraste MESURÉ, non sur une teinte devinée.
    //  · GYM-288 / GYM-291 / GYM-292 / GYM-293 / GYM-300 / GYM-301 — le MULTI-SALLES côté
    //    membre : adhésion à plusieurs salles, écran de choix, changement de salle, sortie
    //    « ce n'est pas ma salle », et l'inscription multi rouverte parce que le
    //    rattachement existe enfin.
    //  · GYM-297 / GYM-302 / GYM-303 — le nom et le logo d'un client cessent d'être des
    //    constantes ; /reset-password était brandée Dopamine POUR TOUT LE MONDE.
    //  · GYM-313 / GYM-318 — le PARCOURS DE RESET réparé de bout en bout : le lien finit
    //    sur la page qui sait le terminer, et le slug vient du choix local et non du repli
    //    de build.
    //
    // ⚠️ DEUX ITEMS DU LOT NE TOUCHENT PAS CE BINAIRE, et autant le savoir avant d'en
    // chercher la trace ici : GYM-308 (toute salle créée en self-serve naissait à 0 % de
    // TVA) et GYM-305 / GYM-215 (upload du logo de salle) sont ENTIÈREMENT côté cockpit —
    // zéro fichier sous apps/mobile. Ils pèsent dans l'ampleur du lot, pas dans cette build.
    //
    // 🔴 LE BUILD 23, LUI, EST BEL ET BIEN TÉLÉVERSÉ SUR APP STORE CONNECT. C'est la
    // distinction que ce saut rend facile à manquer : la VERSION MARKETING était libre, le
    // NUMÉRO DE BUILD ne l'est pas. Le prochain doit être ≥ 24, sinon Apple refuse le
    // téléversement. Ce n'est pas une déduction — le compteur a été LU avant ce commit
    // (`eas build:version:get --platform ios --profile production` → 23), et il concorde
    // avec le binaire déposé chez Apple. Conformément au bloc 1.0.6 ci-dessus, AUCUN numéro
    // de build n'est annoncé ici : seul le PLANCHER l'est.
    //
    // Le buildNumber, lui, n'est PAS déclaré ici : eas.json le gère
    // (appVersionSource "remote" + autoIncrement).
    //
    // 🔴 CETTE VERSION EST CELLE DE DOPAMINE, ET D'ELLE SEULE. Depuis la variante `viniz`,
    // ce champ n'est plus la version « de l'app » : c'est la version d'UNE des trois. Viniz
    // pose la sienne dans son bloc, en bas de fichier — elle repart de 1.0.0, parce qu'une
    // app neuve sur l'App Store n'hérite pas de l'historique d'une autre.
    version: '1.1.0',
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
      // 🔴 `organization` / `project` SONT ÉCRITS ICI, ET PLUS LUS DANS L'ENVIRONNEMENT.
      //
      // La première version les laissait à `undefined` en comptant sur le repli du plugin
      // vers SENTRY_ORG / SENTRY_PROJECT. Ce repli EXISTE bien — sentry.properties reçoit
      // « falling back to SENTRY_ORG environment variable » — mais il ne vaut que si les
      // variables sont réellement posées. Elles ne l'ont jamais été, et la build
      // preview-staging a échoué à l'étape sentry-cli :
      //     « A project ID or slug is required (provide with --project) »
      // Le plugin tournait, chargeait sentry.properties, et n'y trouvait aucune cible.
      //
      // Ces deux valeurs ne sont NI des secrets NI des données de salle : ce sont les
      // coordonnées du projet Sentry de l'app mobile, identiques pour tous les profils de
      // build. Les versionner ici, c'est UNE source, qui ne peut pas manquer à l'appel —
      // à l'inverse d'une variable d'environnement qu'il faut penser à poser sur chaque
      // profil, et dont l'absence ne se voit qu'au milieu d'une build.
      //
      // ⚠️ SEUL LE JETON RESTE UN SECRET (SENTRY_AUTH_TOKEN, secret EAS). Le plugin refuse
      // explicitement `authToken` dans cette config — il avertit et le retire avant
      // écriture. Ne jamais l'ajouter ici.
      //
      // Forme conforme au typage de la version installée (7.2.0,
      // plugin/build/withSentry.d.ts) :
      //     interface PluginProps { organization?, project?, authToken?, url?,
      //                             experimental_android? }
      [
        '@sentry/react-native/expo',
        {
          organization: 'nexxia-studio',
          project: 'dopamine-mobile',
          url: 'https://sentry.io/',
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
      // ── GYM-102 (5a) — LE MODE, DÉCLARÉ. PAS DÉDUIT. ──────────────────────────────
      //
      // 🔴 LE REPLI EST `single`, ET C'EST TOUT LE POINT. Oublier de poser cette variable
      // doit produire le comportement de Dopamine — jamais un écran de recherche de salle
      // chez ses membres. C'est le seul sens dans lequel l'oubli est sans danger.
      //
      // POURQUOI UNE VARIABLE ET PAS UNE DÉDUCTION. Le mode se lisait jusqu'ici dans la
      // PRÉSENCE de `gymId`. Deux faits ont fermé cette voie :
      //  · EAS REFUSE une valeur vide (« is not allowed to be empty ») — la build échoue
      //    avant de démarrer, donc `EXPO_PUBLIC_GYM_ID: ""` n'est pas exprimable ;
      //  · une variable ABSENTE traverse le `??` ci-dessus et rend l'uuid de Dopamine.
      // Entre les deux, le mode `multi` était tout simplement inatteignable par un profil.
      //
      // Et le BUNDLE ne peut pas trancher non plus : `app.viniz.staging` sert DÉJÀ les
      // deux modes — `preview-staging` en single, `preview-viniz` en multi. Un même
      // identifiant Apple, deux comportements : la déduction n'a rien à quoi se raccrocher.
      gymMode: process.env.EXPO_PUBLIC_GYM_MODE ?? 'single',
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

// ── Variante « Viniz » (PRODUCTION) ───────────────────────────────────────────────
// Tout ce qui suit ne s'exécute QUE si EXPO_PUBLIC_APP_VARIANT vaut 'viniz'. La build de
// Dopamine ne traverse ni ce bloc ni le précédent.
//
// 🔴 SANS CE BLOC, LE PROFIL `production-viniz` AURAIT BÂTI DOPAMINE. C'est le piège de ce
// lot, et il est silencieux : `isStaging` est faux pour toute valeur autre que 'staging',
// donc une variante inconnue retombe sur la configuration Dopamine ÉCRITE PLUS HAUT —
// bundle be.dopamineclub.app, nom « Dopamine », icône Dopamine. Le build aurait réussi, et
// serait parti sur la fiche App Store de Nico.
if (isViniz) {
  const e = config.expo

  e.name = 'Viniz'
  // ⚠️ `slug` et `extra.eas.projectId` NE CHANGENT PAS — même raison qu'en staging : ils
  // identifient le PROJET EAS, pas l'application. Les trois apps vivent dans le même
  // projet et se distinguent par leur profil de build.

  // 🔴 LA VERSION REPART DE 1.0.0, ET CE N'EST PAS UN OUBLI.
  // `app.viniz` est une app NEUVE sur l'App Store : sa fiche (ascAppId 6809463633) n'a
  // jamais rien reçu. Les contraintes ITMS-90186 / ITMS-90062 portent sur l'historique
  // d'UNE fiche — celui de Dopamine ne la concerne pas. Reprendre 1.1.0 annoncerait à ses
  // premiers utilisateurs une app déjà passée par onze trains qui n'existent pas pour elle.
  e.version = '1.0.0'

  e.ios.bundleIdentifier = 'app.viniz'
  e.android.package = 'app.viniz'

  // ⚠️ SCHEME 'viniz' — CHOIX DE CE LOT, à connaître. Le laisser à 'dopamine' ferait se
  // disputer deux apps le même `dopamine://` sur un appareil qui a les deux, et iOS
  // trancherait de façon imprévisible. 'viniz-staging' est déjà pris par l'autre variante.
  e.scheme = 'viniz'

  // 🔴 `associatedDomains` EST CONSERVÉ, ET C'EST LA DIFFÉRENCE AVEC LE BLOC STAGING.
  // L'AASA servie par apps/links déclare `2B239M7MJL.app.viniz` avec le composant `/*`
  // (toutes les salles, sauf /dopamine/* explicitement exclu) : CETTE app est celle que ce
  // composant désigne. Sans `applinks:links.viniz.app` dans le binaire, la moitié app de
  // l'appariement manquerait — les Universal Links de toutes les salles s'ouvriraient dans
  // le navigateur, sans qu'aucune erreur ne le signale.
  //
  // Le bloc staging, lui, SUPPRIME ce domaine, et pour la raison inverse : `app.viniz.staging`
  // n'est déclaré nulle part dans l'AASA, et le revendiquer ferait concurrence à celle-ci.
  //
  // ⚠️ apps/links/README.md marque `2B239M7MJL.app.viniz` « appID À CONFIRMER AVANT
  // DÉPLOIEMENT ». Ce lot est ce qui le confirme : le bundle existe désormais, avec
  // l'équipe 2B239M7MJL (cf. le profil submit d'eas.json). La note du README pourra tomber
  // quand la première build sera passée — elle n'est pas retirée ici, aucune build n'ayant
  // encore prouvé l'appariement sur un téléphone.

  // La chaîne de permission est affichée par iOS dans une alerte système : y laisser
  // « Dopamine » sur une app nommée « Viniz » désigne la mauvaise application au membre.
  e.ios.infoPlist.NSFaceIDUsageDescription =
    'Viniz utilise Face ID pour sécuriser ta connexion.'

  // ── L'ICÔNE DE PRODUCTION ─────────────────────────────────────────────────────────
  // Rastérisée depuis `assets/viniz/viniz-icon.svg` — c'est-à-dire depuis le VECTEUR, et
  // non par agrandissement de `icon-512.png` : un 512 poussé à 1024 aurait été flou, le
  // motif exact pour lequel `dopamine-logo-d.png` avait été écarté en GYM-241.
  //
  // Vérifié sur le fichier lui-même, pas sur sa description :
  //   · 1024×1024, PNG type 2 (truecolor RGB), 8 bits, non entrelacé ;
  //   · AUCUN canal alpha et AUCUN chunk `tRNS`. C'est une exigence de l'App Store, pas
  //     une préférence : une icône transparente est refusée en ITMS-90717, à la
  //     soumission — donc après la build, quand le train est déjà lancé ;
  //   · fond #4827B4 plein jusqu'aux quatre coins, marque en #C8FF3D (le lime Viniz) ;
  //   · aucun bandeau « STAGING » — ce n'est pas un dérivé des assets de la variante.
  e.icon = './assets/viniz/icon-1024.png'

  // 🔴 L'ICÔNE ADAPTATIVE ANDROID N'EST DÉLIBÉRÉMENT PAS POSÉE SUR CE FICHIER.
  //
  // Android ne garantit d'afficher que le CERCLE CENTRAL de 66 % de l'avant-plan ; le
  // reste est rogné par le masque du lanceur. Mesuré sur ce fichier : le motif atteint
  // 85,2 % du demi-côté — la barre horizontale du pouls court de x=77 à x=948. Ses deux
  // extrémités seraient COUPÉES, et le pouls deviendrait un accent sans ligne.
  //
  // Le point de comparaison est dans ce fichier même, quelques lignes plus haut :
  // `adaptive-icon-dopamine.png` a été généré pour GYM-241 précisément pour cela, et
  // mesure 48,2 %. `icon-dopamine.png`, ÉCARTÉ pour cet usage par ce lot-là, mesure 57,4 %
  // — moins que celui-ci. Poser ce fichier en avant-plan referait, en pire, l'erreur que
  // GYM-241 a corrigée.
  //
  // ⚠️ CONSÉQUENCE ASSUMÉE ET NON MASQUÉE : sur Android, l'app Viniz porte encore l'icône
  // adaptative de Dopamine (héritée du bloc principal). C'est visible et corrigeable ; une
  // barre tronquée, elle, aurait l'air d'un choix graphique. Le geste qui manque est le
  // même qu'en GYM-241 : remettre la marque à l'échelle sur un fond #4827B4 de 1024, sous
  // 66 % — `scripts/generate-viniz-staging-assets.js` porte déjà ce `safeRatio`.
  //
  // ⚠️ L'ÉCRAN DE DÉMARRAGE reste lui aussi celui de Dopamine : `splash-dopamine.png` est
  // un 1080×1080 sur fond noir, et le dépôt n'a pas son équivalent Viniz de production
  // (`splash-staging.png` porte le bandeau). Hors du périmètre de ce lot, qui livre
  // l'icône ; à traiter avant la première soumission.
}

export default config
