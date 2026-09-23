const { withPodfile } = require('expo/config-plugins')

/**
 * ╔═══════════════════════════════════════════════════════════════════════════════════════╗
 * ║  XCODE 27 — LES BUNDLES DE RESSOURCES GARDENT LEUR CIBLE, ET PERSONNE NE LES CORRIGE ║
 * ╚═══════════════════════════════════════════════════════════════════════════════════════╝
 *
 * 🔴 POURQUOI `expo-build-properties` NE SUFFIT PAS — mesuré, pas supposé.
 *
 * Relevé dans `ios/Pods/Pods.xcodeproj` du projet généré localement :
 *
 *     216 × IPHONEOS_DEPLOYMENT_TARGET = 15.1
 *       2 × 13.4   ·   2 × 12.4   ·   2 × 11.0
 *
 * Six réglages récalcitrants — soit TROIS cibles × deux configurations (Debug/Release).
 * Et ces trois-là ne sont pas des pods : ce sont des BUNDLES DE RESSOURCES —
 * `RNCAsyncStorage_resources`, `RNSVGFilters`, et le bundle de confidentialité de `Sentry`.
 *
 * C'est ce qui explique que le réglage global ne les atteigne pas :
 *   · le `platform :ios` du Podfile vaut DÉJÀ 15.1 (valeur par défaut du SDK 54) ;
 *   · `react_native_post_install` appelle bien `updateOSDeploymentTarget`, qui relève
 *     chaque pod à `min_ios_version_supported` (15.1) — mais il n'itère que
 *     `pod_target_installation_results[].native_target`, JAMAIS les bundles de ressources ;
 *   · `expo-build-properties` écrit `ios.deploymentTarget` dans `Podfile.properties.json`
 *     et règle le projet de l'APP — deux endroits qui étaient déjà à 15.1.
 *
 * Autrement dit : sans ce greffon, déclarer `ios.deploymentTarget` ne changerait
 * strictement RIEN, ni en local ni à distance. Les six réglages fautifs resteraient, et
 * Xcode 27 continuerait de refuser la compilation.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * CE QUE CE GREFFON FAIT, ET RIEN DE PLUS
 * ─────────────────────────────────────────────────────────────────────────────────────
 * Il insère, DANS le `post_install` existant du Podfile, une boucle qui relève toute cible
 * du projet Pods située EN DESSOUS de la valeur voulue — et elles seules. Une cible déjà
 * plus haute n'est jamais abaissée.
 *
 * ⚠️ `ios/` EST IGNORÉ PAR GIT et régénéré à chaque `prebuild` — c'est précisément pourquoi
 * un correctif à la main ne survit pas, et pourquoi ceci est un greffon plutôt qu'une
 * retouche. Le réglage vient du dépôt, comme demandé.
 *
 * ⚠️ IL NE CHANGE RIEN AUX BUILDS EAS DISTANTS. La valeur posée est celle qui est DÉJÀ
 * effective (15.1) : les 216 cibles conformes le restent, et les six autres montent à la
 * même valeur que leurs voisines. Aucun binaire ne cible une version plus haute qu'avant.
 */
const ANCRE = ':ccache_enabled => ccache_enabled?(podfile_properties),\n    )'

module.exports = function withPodsDeploymentTarget(config, { deploymentTarget } = {}) {
  const cible = deploymentTarget || '15.1'

  return withPodfile(config, (cfg) => {
    const podfile = cfg.modResults.contents

    // Idempotence : `prebuild` peut rejouer les greffons sur un Podfile déjà patché.
    if (podfile.includes('GYM — Xcode 27')) return cfg

    if (!podfile.includes(ANCRE)) {
      // 🔴 ON ÉCHOUE BRUYAMMENT PLUTÔT QUE DE NE RIEN FAIRE. Un greffon qui ne trouve pas
      // son ancre et se tait laisserait croire que le réglage est appliqué — c'est le
      // motif que ce dépôt corrige depuis des semaines (le retour non lu). Si le gabarit
      // de Podfile change, on veut l'apprendre au `prebuild`, pas à la compilation.
      throw new Error(
        'withPodsDeploymentTarget : ancre introuvable dans le Podfile. '
        + 'Le gabarit Expo a changé — relire le post_install généré et corriger ce greffon.',
      )
    }

    const bloc = ANCRE + `

    # GYM — Xcode 27 n'accepte qu'une cible de déploiement entre 15.0 et 27.0, et TROIS
    # BUNDLES DE RESSOURCES gardent celle de leur podspec : RNCAsyncStorage_resources
    # (13.4), RNSVGFilters (12.4) et le bundle de confidentialité de Sentry (11.0).
    # \`updateOSDeploymentTarget\` de React Native ne les voit pas — il n'itère que les
    # cibles natives des pods, jamais leurs bundles de ressources.
    #
    # On relève donc TOUTE cible sous ${cible} — et ELLES SEULES : le test \`< ${cible}\`
    # n'abaisse jamais une cible déjà plus haute, et les 216 cibles déjà conformes ne
    # bougent pas d'un octet.
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |bc|
        actuel = bc.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if actuel.nil? || actuel.to_f < ${cible}
          bc.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${cible}'
        end
      end
    end`

    cfg.modResults.contents = podfile.replace(ANCRE, bloc)
    return cfg
  })
}
