export default {
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
