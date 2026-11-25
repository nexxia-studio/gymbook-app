# GYM-391, partie mobile : écran Messages derrière la cloche

Le serveur écrit déjà une ligne par message dans `public.notifications` (en prod depuis le 25/11). Ce lot ajoute la lecture dans l'app membre. Aucune migration, aucune Edge Function, aucune dépendance nouvelle.

## Données

- Table `public.notifications` : `id, gym_id, member_id, type, title, body, data jsonb, read boolean (nullable, défaut false), read_at, created_at`.
- Accès : le membre lit ses lignes (`member_id = auth.uid()`), et ne peut modifier que `read` et `read_at` (droits par colonne, migration `20261123140500`). Un UPDATE qui porte une autre colonne est refusé : la charge utile ne contient donc que `read` et `read_at`.
- La RLS ne filtre pas la salle : toute requête filtre `member_id = user.id` ET `gym_id = salle active` (`useActiveGymId`, garde si absente, comme `hooks/useProfileStats.ts`).
- « Non lu » = `read` n'est pas `true` (un `null` compte comme non lu).
- La ligne porte le type dans la colonne `type`, pas dans `data`.

## Critères d'acceptation

1. **Cloche** (`app/(tabs)/index.tsx`) : touchable, ouvre l'écran Messages. Pastille avec le nombre de non lus, « 9+ » au-delà de 9, aucune pastille à 0. Libellé d'accessibilité.
2. **Écran Messages** (`app/messages/index.tsx`) : du plus récent au plus ancien ; par ligne une icône selon le type, le titre, le corps, la date relative ; les non lus mis en évidence ; état vide ; tirer pour rafraîchir ; bouton « Tout marquer comme lu » (visible seulement s'il y a des non lus) ; pagination par 30 (chargement de la page suivante en fin de liste).
3. **Date relative** : « à l'instant » sous 1 minute, « il y a N min » sous 1 heure, « il y a N h » sous 24 heures écoulées. Au-delà, on compte en jours de calendrier (heure locale de l'appareil) : « hier » pour la veille, « il y a N j » de 2 à 7 jours, puis la date (jour et mois, avec l'année si elle diffère de l'année en cours). Une date dans le futur (horloge décalée) s'affiche « à l'instant ».
4. **Toucher un message** : le marque comme lu (`read = true`, `read_at = maintenant`) s'il ne l'est pas, puis ouvre l'écran lié. L'échec du marquage n'empêche pas la navigation.
   - `booking_confirmed`, `waitlist_promoted`, `session_cancelled_by_gym`, `session_updated_by_gym` : la fiche du cours (`/session/[id]`) si `data.slot_id` existe et que le cours n'est pas passé, sinon Mes réservations (`/(tabs)/bookings`). Cours introuvable ou heure inconnue : Mes réservations.
   - `subscription_activated`, `subscription_payment_failed`, `credits_purchased` : Ma formule (`/profile/subscription`).
   - `no_show_suspension` : Profil (`/(tabs)/profile`).
   - `communication` : le message en entier (`app/messages/[id].tsx`).
   - Tout autre type autorisé par la base : marqué comme lu, le message en entier, icône générique.
5. **Navigation push existante** : `handleNotificationTap` (`hooks/usePushNotifications.ts`) garde exactement les mêmes destinations pour les mêmes `data.type`. Un test fige la table actuelle.
6. **Compteur** : rafraîchi à l'ouverture de l'app (session connue), au retour au premier plan, à la réception d'un push, à la sortie de l'écran Messages. Remis à zéro à la déconnexion et au changement de salle.
7. **Thème** : couleurs par `useTheme().tokens` (et `SEMANTIC` pour les couleurs-signal). Aucun littéral de couleur, aucune classe `move-*` dans les fichiers nouveaux. Rendu correct en variante Dopamine et en variante Viniz.
8. **Textes** : i18n fr et en, tutoiement, aucun « — » ni « – ».
9. **Tests** de logique pure (date relative, routage par type, libellé de pastille, table du push) en scripts `npx tsx tests/<fichier>.test.ts`, comme les tests existants. `npx tsc --noEmit` vert.

## Hors périmètre

- Carte « Nouvelle version disponible » (`app_version_policy` n'a pas de colonne pour la dernière version).
- Temps réel, changement de version de l'app, textes du dashboard.
- Correction des écarts entre les types de push émis par le serveur et le `switch` de `handleNotificationTap`.

## Plan

- **T1, logique pure** : `lib/messages/` (date relative, routage, pastille, table de routage du push extraite à l'identique) et leurs tests.
- **T2, données et compteur** : accès à `notifications` (page, compteur, marquer lu, tout marquer lu), store du compteur, déclencheurs, cloche et pastille.
- **T3, écrans** : liste, message en entier, i18n fr et en.

## Scénarios

1. Cloche : pastille avec le bon nombre, aucune pastille à 0, « 9+ » au-delà de 9.
2. Liste : ordre, icônes, dates relatives, non lus en évidence.
3. Toucher un message de cours à venir : passe en lu, ouvre la fiche du cours.
4. Toucher un message de cours passé : passe en lu, ouvre Mes réservations.
5. Toucher une communication : passe en lu, affiche le message en entier.
6. Tout marquer comme lu : plus aucun non lu, la pastille disparaît au retour à l'accueil.
7. État vide.
8. Tirer pour rafraîchir, pagination au-delà de 30.
