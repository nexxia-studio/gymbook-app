export default {
  expo: {
    name: 'Dopamine',
    slug: 'dopamine',
    version: '1.0.0',
    orientation: 'portrait' as const,
    icon: './assets/icon-dopamine.png',
    userInterfaceStyle: 'automatic' as const,
    newArchEnabled: true,
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain' as const,
      backgroundColor: '#F5F4F0',
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
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#F5F4F0',
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
