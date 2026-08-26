<!-- GYM-102 (2/5) — spec d'animation de l'écran de lancement Viniz.
     Versionnée ici parce que son absence du dépôt a bloqué un cycle entier : le
     cadrage la disait « fournie et complète », elle n'existait que sur le poste
     d'Antoine. Copie fidèle du fichier de la maquette (Claude Design), non
     retouchée. Les assets qu'elle décrit sont dans apps/mobile/assets/viniz/. -->

# Pulse-V tracé + point lumineux — spec d'implémentation

Effet : le pulse-V se dessine de gauche à droite comme sur un moniteur cardiaque, une bille
lumineuse court à la pointe du tracé, puis s'éteint quand la ligne est complète.
Le wordmark apparaît ensuite, puis la signature « Ta salle, vivante. »

## Asset

`viniz-pulse-line.svg` — le pulse-V seul, **fond transparent** (les deux rectangles pleins
`#ffffff` et `#4827b4` du SVG d'origine ont été supprimés). viewBox 1500×1500, art lime
`#C8FF3D` occupant x 7 %→93 %, y 15,5 %→83 % de la boîte.

## Géométrie de référence (boîte 117 × 89 px)

L'image est posée à `width:124px; height:124px; margin-top:-17px` dans une boîte de
117 × 89. Sommets du tracé, en px dans cette boîte :

| point | x | y |
|---|---|---|
| départ plat | 9 | 57 |
| fin du plat gauche | 38 | 57 |
| petit pic | 49 | 37 |
| creux du V | 64 | 88 |
| grand pic | 86 | 8 |
| retour ligne | 97 | 57 |
| fin plat droite | 115 | 57 |

Pour une autre taille, tout est proportionnel à la largeur de la boîte.

## Timings (cycle unique de 3,4 s, en boucle)

| % | tracé (largeur du masque) | point |
|---|---|---|
| 0 | 0 px, opacité 0 | opacité 0 |
| 6 | 12 px, opacité 1 | apparaît au départ plat |
| 17,6 | — | fin du plat gauche |
| 22,1 | — | petit pic |
| 28,6 | — | creux du V |
| 38,5 | — | grand pic |
| 43,4 | — | retour ligne |
| 51 | 117 px | fin plat droite |
| 60 | — | opacité 0 |
| 88 | 117 px, opacité 1 | — |
| 100 | opacité 0 | — |

Interpolation **linéaire** des deux animations : c'est ce qui garde le point collé à la pointe.
Wordmark : fondu 0,8 s à partir de 1,5 s. Signature : fondu 0,7 s à partir de 2,1 s.

## Web (CSS)

```css
@keyframes vztrace{
  0%{width:0;opacity:0} 6%{width:12px;opacity:1}
  52%{width:117px;opacity:1} 88%{width:117px;opacity:1} 100%{width:117px;opacity:0}
}
@keyframes vzdot{
  0%{opacity:0;transform:translate(4px,52px)} 5%{opacity:1;transform:translate(4px,52px)}
  17.6%{transform:translate(33px,52px)} 22.1%{transform:translate(44px,32px)}
  28.6%{transform:translate(58px,83px)} 38.5%{transform:translate(81px,3px)}
  43.4%{transform:translate(92px,52px)} 50.9%{opacity:1;transform:translate(110px,52px)}
  60%{opacity:0;transform:translate(110px,52px)} 100%{opacity:0;transform:translate(110px,52px)}
}
```

```html
<!-- boîte de référence 117 × 89 -->
<div style="position:relative;width:117px;height:89px">
  <!-- masque qui s'élargit : révèle le tracé -->
  <div style="position:absolute;left:0;top:0;width:117px;height:89px;overflow:hidden;
              animation:vztrace 3.4s linear infinite">
    <img src="viniz-pulse-line.svg"
         style="width:124px;height:124px;margin-top:-17px;display:block">
  </div>
  <!-- point lumineux, hors du masque pour ne pas être rogné -->
  <div style="position:absolute;left:0;top:0;width:10px;height:10px;border-radius:50%;
              background:#F3F0FF;
              box-shadow:0 0 8px 2px rgba(200,255,61,.95),0 0 22px 8px rgba(200,255,61,.45);
              animation:vzdot 3.4s linear infinite"></div>
</div>
```

Les `translate` du point sont déjà décalés de −5 px (rayon de la bille) : ce sont des
coordonnées de coin, pas de centre.

Sur le site vitrine, une variante plus fluide est possible : remplacer le masque par un
`<path>` réellement tracé (`stroke-dasharray` / `stroke-dashoffset`) et positionner le point
avec `offset-path: path(...)`. Il faut alors une version **filaire** du pulse (contour, pas
forme pleine) — le SVG actuel est une forme remplie.

## React Native / Expo

Pas de `stroke-dashoffset` : on garde la logique masque + point, en deux valeurs animées
sur le même driver natif.

```jsx
import Animated, { useSharedValue, withRepeat, withTiming, Easing,
  useAnimatedStyle, interpolate, withSequence } from 'react-native-reanimated';

const W = 117, H = 89;
const XS = [0, .06, .176, .221, .286, .385, .434, .51, .6, 1];
const DOT_X = [4, 4, 33, 44, 58, 81, 92, 110, 110, 110];
const DOT_Y = [52, 52, 52, 32, 83, 3, 52, 52, 52, 52];
const DOT_O = [0, 1, 1, 1, 1, 1, 1, 1, 0, 0];

const t = useSharedValue(0);
useEffect(() => {
  t.value = withRepeat(withTiming(1, { duration: 3400, easing: Easing.linear }), -1, false);
}, []);

const mask = useAnimatedStyle(() => ({
  width: interpolate(t.value, [0, .06, .52, .88, 1], [0, 12, W, W, W]),
  opacity: interpolate(t.value, [0, .06, .88, 1], [0, 1, 1, 0]),
}));

const dot = useAnimatedStyle(() => ({
  opacity: interpolate(t.value, XS, DOT_O),
  transform: [
    { translateX: interpolate(t.value, XS, DOT_X) },
    { translateY: interpolate(t.value, XS, DOT_Y) },
  ],
}));
```

```jsx
<View style={{ width: W, height: H }}>
  <Animated.View style={[{ height: H, overflow: 'hidden' }, mask]}>
    <PulseLineSvg width={124} height={124} style={{ marginTop: -17 }} />
  </Animated.View>
  <Animated.View style={[{
    position: 'absolute', width: 10, height: 10, borderRadius: 5,
    backgroundColor: '#F3F0FF',
    shadowColor: '#C8FF3D', shadowOpacity: .95, shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 }, elevation: 0,
  }, dot]} />
</View>
```

Notes :
- `PulseLineSvg` = le SVG converti via `react-native-svg-transformer` (import direct
  du `.svg`), ou `<SvgXml>` avec le contenu du fichier.
- Le halo est une **ombre statique**, pas un flou animé : aucun coût par frame.
  Sur Android, `shadowRadius` ne rend pas — doubler la bille avec un cercle lime
  de 26 px à `opacity:.35` sous le point, ou une petite image de halo.
- Une seule `sharedValue` pilote les deux vues : tout reste sur le thread UI.
- Respecter `AccessibilityInfo.isReduceMotionEnabled()` : dans ce cas, afficher
  le pulse complet + le wordmark sans animation.
