# La photo du coach dans l'app des membres

**Branche** `gym-photo-coach-mobile` · **base** `develop` · **PR séparée, à dessein** :
c'est du **mobile**, ça partira avec la **1.2.2**. Le dashboard (PR #312) ne l'attend pas.

---

## Le recensement demandé

`coaches.photo_url` existe depuis toujours. Le dashboard la remplit désormais (PR #310/#312).
**Aucun écran de l'app ne la lisait** — seuls les types générés la mentionnaient.

### Les trois requêtes qui vont chercher un coach

| Fichier | Ce qu'elle demandait |
|---|---|
| `app/session/[id].tsx` | `coaches(name)` |
| `app/(tabs)/bookings.tsx` | `coaches(name)` |
| `stores/useBookingStore.ts` | `coaches(name)` |

**Aucune ne demandait `photo_url`.** Le défaut ne pouvait donc pas être « la photo ne
s'affiche pas » : elle n'était jamais descendue jusqu'à l'app.

### Les six endroits où un coach apparaît

| Écran | Composant | Forme actuelle |
|---|---|---|
| **Fiche de séance** | `SessionInfo` | puce `[icône] Nom` |
| Accueil | `SessionCard` | ligne de texte 13 px |
| Planning | `SlotListCard` | ligne de texte |
| Mes réservations — à venir | `UpcomingCard` | ligne de texte |
| Mes réservations — favoris | `FavoriteCard` | `{date} · {coach}` |
| Mes réservations — historique | `HistoryCard` | ligne de texte |

---

## Ce que je propose, et ce que j'ai fait

### ✅ La fiche de séance — fait

C'est **le seul écran qui a de la place, et le seul moment qui compte** : celui où le membre
décide de réserver. Savoir qui anime la séance y a une valeur ; dans une liste, c'est une
ligne secondaire qu'on survole.

La puce existante `[icône utilisateur] Nom` devient `[photo ronde] Nom`. **La photo remplace
l'icône, jamais les deux** — la puce est étroite, et lui ajouter un élément ferait sauter la
rangée. Taille alignée sur l'icône remplacée (18 px).

**Sans photo, rien ne change** : la puce retombe sur son icône, exactement comme avant. Un
coach sans photo est le cas **normal**, pas une anomalie.

### ❌ Les cinq cartes de liste — non fait, et je recommande de ne pas le faire

Trois raisons, dans l'ordre :

1. **Le nom y tient en une ligne de 13 px, secondaire.** Un avatar de 20 px à côté doublerait
   la hauteur de la ligne ou écraserait le texte.
2. **Ce sont des listes qui défilent.** Accueil, planning et historique affichent des dizaines
   de créneaux : une image par carte, c'est autant de requêtes réseau pendant le défilement,
   pour une information déjà écrite.
3. **Ça change la maquette, ce n'est pas une correction.** GYM-229 a déjà tranché la mise en
   page de ces cartes (masquer la ligne plutôt que rendre un creux) ; y ajouter un avatar est
   une décision de design, pas un défaut à réparer.

📋 **Si tu veux quand même l'essayer**, la carte du planning (`SlotListCard`) est la moins
dense des cinq et la plus proche du moment de décision — ce serait la seule que je tenterais,
et seule.

---

## Les preuves

- **`tsc` mobile — exit 0**, 165 fichiers projet (`--listFiles` hors `node_modules`, le
  chiffre honnête de GYM-350 §2).
- **Aucun build Expo**, comme demandé. Le rendu partira avec la 1.2.2.

⚠️ **Aucun téléphone n'a été ouvert.** Ce qui est vérifiable ici tient en deux points, et les
deux le sont : la requête demande enfin `photo_url`, et le composant la rend quand elle
existe. Le reste — la tête que ça a — se voit sur l'appareil.

⚠️ **Rien d'autre n'est touché.** Les deux autres requêtes (`bookings.tsx`,
`useBookingStore.ts`) gardent `coaches(name)` : leur ajouter `photo_url` chargerait une
colonne que rien n'affiche.
