export default {
  expo: {
    name: 'Dopamine',
    slug: 'dopamine',
    version: '1.0.0',
    orientation: 'portrait' as const,
    icon: './assets/icon.png',
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
    ],
    experiments: {
      typedRoutes: true,
    },
    scheme: 'dopamine',
  },
}
