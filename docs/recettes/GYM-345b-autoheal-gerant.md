# GYM-345b — Le filet n'attrape plus un gérant

> **Correctif déjà appliqué en production par le cockpit le 22/09.** Cette PR ne fait que
> l'**inscrire dans le dépôt**. Appliquée, elle ne change rien — et elle le **prouve**.

**Branche** `gym-autoheal-gym-owner` · **base** `develop` · **aucun déploiement**.

---

## L'incident

`nexxia.studio+gerant1@gmail.com` s'inscrit comme **gérant** (`signup_intent = 'gym_owner'`),
confirme son email à **11 h 37** — et se retrouve rattaché à Dopamine à **11 h 50**, par
`member_gyms_autoheal()`, **avant d'avoir créé sa salle**.

Entre la confirmation de l'email et la création de la salle, un futur gérant est
**exactement ce que le filet cherche** : `role = 'member'` (c'est `handle_new_user` qui force
ce rôle à tout le monde), `gym_id IS NULL`, zéro adhésion. La règle 2 le rattachait donc à la
salle d'app dédiée.

**Tout gérant en cours d'inscription était exposé** — la fenêtre dure le temps d'un
formulaire, et le cron passe toutes les heures.

⚠️ **Ce n'était pas une erreur de diagnostic, c'était un angle mort.** Le filet répondait
correctement à la question qu'on lui avait posée (« ce membre sans salle, où va-t-il ? ») ;
personne ne lui avait dit que certains comptes sans salle ne sont pas des membres, mais des
gérants qui n'ont pas fini de s'inscrire.

---

## Pourquoi ce fichier, alors que la production est déjà corrigée

🔴 **Sans lui, la prochaine migration qui touche au filet réécrit la version fautive.**
`20260914100000_gym345_filet_rattachement.sql` porte encore le corps d'origine : un
`CREATE OR REPLACE` bâti dessus — ou un simple `db reset` — rouvrirait le trou sans que
personne ne s'en aperçoive.

Un correctif appliqué à chaud qui ne redescend pas dans le dépôt n'est pas un correctif :
c'est une dette avec une date d'expiration inconnue.

---

## Les deux gardes

**① LE CANDIDAT** — un compte `signup_intent = 'gym_owner'` n'est jamais candidat.

La garde est posée **deux fois** : dans le décompte **et** dans la boucle. Ce n'est pas une
redondance — c'est le décompte qui arme le disjoncteur (`c_max_par_passage = 5`). Un gérant
**compté mais non traité** ferait monter le compteur vers le seuil et finirait par **bloquer
le filet pour de vrais membres**. Les deux prédicats doivent donc rester identiques, et le
contrôle d'application exige littéralement **deux** occurrences.

**② LA RÈGLE 2** — la salle d'app dédiée n'est servie qu'aux comptes **sans identité
`email`**, c'est-à-dire aux inscriptions Apple/Google de l'app mono-salle. C'est la
population que cette règle visait depuis le début ; elle n'avait simplement jamais été
nommée. Un compte email est passé par un formulaire : il a une salle en tête, et si on ne
sait pas laquelle, **on ne devine pas**.

**La règle 1 est inchangée**, et volontairement : « une seule adhésion » est un **fait**
observé, pas une convention — le membre *est* déjà dans cette salle, il lui manque seulement
sa salle active. Aucun gérant en cours d'inscription n'a d'adhésion ; la garde ① suffit.

---

## Les preuves

### 1. Le corps est **exactement** celui du déployé — empreinte, pas bonne foi

Le corps a été lu sur la **production** (`pg_get_functiondef`), pas reconstruit depuis
l'ancien fichier. Seuls des **commentaires** ont été ajoutés.

| | `pg_get_functiondef` brut | Commentaires retirés + blancs normalisés |
|---|---|---|
| **Production** | 3 588 octets | **`b1138a3e718a603064ca5e736da29032`** · 3 148 car. |
| **Staging** | 3 876 octets | **`b1138a3e718a603064ca5e736da29032`** · 3 148 car. |

> **Les deux environnements portent le même corps exécutable.** Leurs sources diffèrent de
> 288 octets — **c'était du commentaire, rien d'autre.** Le cockpit avait gardé quatre lignes
> d'explication en staging qui n'ont pas été reportées en prod.

Le **§ 2 de la migration** recalcule cette empreinte *après* son propre `CREATE OR REPLACE`
et **échoue** si elle ne correspond pas. Vérifié : la migration appliquée dans une
transaction sur staging **passe le contrôle**.

⚠️ **Ce contrôle est volontairement fragile.** Toute réécriture future de cette fonction
**doit** casser ici, pour forcer celui qui la réécrit à relire l'incident du 22/09 et à
mettre à jour l'empreinte **en connaissance de cause**.

**Falsification** : en retirant la garde ② du corps déployé (dans une transaction annulée),
l'empreinte change et le contrôle lève. Il n'est pas creux.

### 2. Le comportement — banc transactionnel, **12 / 12**

`supabase/tests/gym345b_autoheal_gym_owner.sql`, joué sur staging en `BEGIN … ROLLBACK`.
La migration y est appliquée par `\i` dans la même transaction : **son contrôle d'empreinte
s'exécute avant les douze cas.**

Quatre situations, et il en faut quatre :

| # | Cas | Obtenu |
|---|---|---|
| ② | La garde ① ramène le **décompte** à 3 sur 4 | ✅ |
| ⑤⑥ | **Gérant email : ignoré** — `gym_id` NULL, 0 adhésion | ✅ |
| ⑦ | **Membre Google : rattaché** à la salle dédiée (règle 2) | ✅ |
| ⑧ | **Membre email sans adhésion : non deviné** | ✅ |
| ⑨ | **Règle 1 inchangée** : adhésion unique → rattaché | ✅ |
| ⑩ | Bilan : 2 réparés / 1 bloqué | ✅ |
| ⑪⑫ | Le journal distingue **deux silences** : 1 ligne ouverte pour le membre, **aucune** pour le gérant | ✅ |

**⑧ et ⑨ sont le contrôle négatif du lot** : un correctif qui refuse tout le monde est aussi
faux qu'un correctif qui accepte tout le monde. C'est le couple qui le montre.

**⑪⑫ disent la différence de nature** : un membre qu'on refuse de deviner laisse une ligne
**ouverte** (quelqu'un doit trancher) ; un gérant ne laisse **rien** — il n'a jamais été
examiné, il n'y a pas de décision en attente.

⚠️ Le banc modifie `auth.users` et `auth.identities` **dans la transaction**, parce que les
deux gardes portent précisément là-dessus. **Étanchéité revérifiée après coup** : 0 profil
membre sans salle, 0 identité `google`, l'identité `email` de retour, aucune metadata
ajoutée, 0 ligne ouverte au journal, empreinte inchangée.

### 3. L'état de la flotte, mesuré

| | Production |
|---|---|
| Candidats du filet (après garde ①) | **0** |
| Comptes exclus par la garde ① | **0** |
| Lignes ouvertes au journal `member-gyms-autoheal` | **0** |
| Salles `dedicated_app_gym` | 1 |

**Le compte de l'incident est réparé** : `nexxia.studio+gerant1@gmail.com` est aujourd'hui
`gym_admin` de **The Pulse Box**, sa propre salle. Rien à rattraper.

### 4. Contrôles de types

`deno check` **36 / 36** · `tsc --build` dashboard **exit 0**. Aucun TypeScript n'est touché
par ce lot ; les deux sont lancés parce que la convention GYM-350 ne fait pas d'exception.

---

# 📋 SIGNALÉ, NON CORRIGÉ — la boucle du dashboard

## La boucle, et sa mécanique exacte

Elle demande **trois conditions simultanées** :

1. en base, `profiles.gym_id IS NOT NULL` ;
2. dans le magasin client (`useAuthStore`), `gym_id` vaut encore **`null`** ;
3. `signup_intent = 'gym_owner'` sur le compte.

Alors :

```
/signup/confirmed  →  create_gym_self_serve  →  PT409 « Ce compte gère déjà une salle »
        ↑                                                      │
        │                                          lien « Aller à mon tableau de bord »
        │                                                      ↓
   /pending  ←──  ProtectedRoute lit le magasin PÉRIMÉ  ←──  /dashboard
   (PendingOrCreateGym : !gymId && intent==='gym_owner' → /signup/confirmed)
```

🔴 **Le défaut tient en une ligne.** Dans `SignupConfirmed.handleSubmit`, `refreshProfile()`
n'est appelé que sur le **chemin de succès** :

```ts
if (error) { setBanner(...); return }   // ← le magasin n'apprend jamais rien
await refreshProfile()                  // ← seulement après un succès
navigate('/dashboard', { replace: true })
```

Le serveur vient pourtant de dire, dans ce refus même, une information que le client ignore :
**ce compte a une salle**. `PT409 / GYM_ALREADY_IN_GYM` est la seule réponse qui *prouve*
que le magasin est périmé — et c'est la seule qu'on n'exploite pas.

⚠️ **C'est aussi la trace visible de l'incident du 22/09** : le compte rattaché par le filet
est resté `role = 'member'` (`attach_profile_to_gym` reçoit `NULL` comme rôle et ne promeut
personne), avec `gym_id` en base et un magasin client chargé avant le rattachement.

⚠️ **Note de parcours** : la boucle sort *avant* la garde de rôle. `ProtectedRoute` teste
`requireGym && !gymId` **avant** `ALLOWED_ROLES` — le membre ne voit donc jamais l'écran
« Espace réservé aux gérants », il rebondit.

## Quel est le bon traitement d'un membre qui se connecte au dashboard ?

**Trois réponses, à trois endroits différents. Je ne les code pas — c'est un signalement.**

**① La boucle est un bug, pas une question de design — une ligne.**
Rafraîchir le profil **aussi** sur `already-has-gym`, avant d'afficher le lien. Le magasin
apprend `gym_id`, `/dashboard` ne rebondit plus, et l'utilisateur atteint l'écran qui lui
correspond (dashboard s'il est gérant, refus s'il est membre). **À corriger en premier :
c'est le seul cul-de-sac dont on ne sort pas.**

**② Un membre n'a rien à faire sur `/dashboard`, et `homePathForRole` le dit déjà à moitié.**
Aujourd'hui `homePathForRole('member')` rend `/dashboard` — donc **toute** connexion d'un
membre atterrit sur un écran qui le refuse. La fonction connaît déjà le rôle : elle peut
rendre une destination qui lui parle. C'est le même geste que pour le super-admin (lot 1).

**③ L'écran de refus doit donner une sortie, et le dépôt sait déjà laquelle.**
`restricted` n'offre aujourd'hui qu'un bouton **« Se déconnecter »** — un cul-de-sac poli.
Or `ResetPassword.tsx` a résolu **exactement ce problème** en GYM-173/303 : un membre qui
atterrit sur une page du dashboard s'y voit proposer **l'app**, avec la précaution qui va
avec —

> *« Envoyer un membre de Studio Kama sur la fiche App Store de Dopamine, c'est l'envoyer
> télécharger une app où il n'a pas de compte. »*

Le bon traitement est donc : **« Cet espace est celui des gérants — votre salle vit dans
l'application »**, avec le lien de l'app **de sa salle** (le slug est connu : le membre est
rattaché), et le neutre Viniz en repli. Pas un cadenas, une redirection utile.

⚠️ **Et ne pas confondre les deux populations.** Un membre est *légitimement* refusé : ③
améliore un refus, il ne l'ouvre pas. Un gérant en cours d'inscription, lui, n'est pas refusé
— il est **inachevé**, et c'est ① qui le débloque.

📋 **Chiffre utile pour arbitrer** : **110 comptes `role = 'member'` rattachés** en
production. Chacun qui tenterait le dashboard tombe aujourd'hui sur le cul-de-sac ③ ; seuls
ceux qui remplissent les trois conditions ci-dessus tombent dans la boucle ①.
