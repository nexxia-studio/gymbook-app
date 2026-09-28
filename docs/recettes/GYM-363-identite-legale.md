# GYM-363 — l'assistant demande enfin l'identité légale

**Branche** `gym-363-identite-legale` · **base** `develop` · aucun déploiement, **aucun build
Expo**. Dashboard — plus une migration de bornes, expliquée au § 2.

> Mesuré en production le 28/09 : **The Pulse Box** et **Iner Studio**, les deux seules
> salles créées en libre-service, ont les six champs légaux vides.
> `gym_legal_identity_complete` rend `false` pour les deux : elles ne peuvent pas encaisser,
> et leurs gérants l'ignorent. Dopamine et Pace passent parce que leurs champs ont été
> remplis **à la main**.

---

## 1. Ce qu'on réutilise — l'onglet existant, lu avant de coder

**En deux lignes, comme demandé :**

> `Paramètres → Salle → Infos légales et facturation` (`LegalBillingCard`) écrit **quinze
> colonnes** de `nexxia_gyms` via le hook `useGymLegal`, en cinq blocs : identité
> (enseigne, raison sociale, forme juridique, n° de TVA), siège social, établissement,
> contact (email, téléphone) et régime TVA. Sa seule validation est **le taux de TVA**
> (nombre fini, 0 ≤ taux ≤ 30 — resserré en GYM-308 parce que « 60 » pour « 6,0 » passait) ;
> le **numéro de TVA n'a aucun format imposé**, ni côté écran ni en base.
>
> `vat_exempt` est une case à cocher : cochée, le taux reste **visible mais désactivé** (on
> ne cache pas au gérant ce qui repartira s'il décoche) et un champ **mention de franchise**
> apparaît. À l'enregistrement, `vatExempt` force `vat_rate = 0` et ne garde la mention que
> si la case est cochée ; tout champ texte vide devient `NULL` (une chaîne vide n'a rien à
> faire sur une facture), et un `UPDATE` bloqué par RLS est détecté par `.select()` — il ne
> lève pas d'erreur, il porte sur zéro ligne.

**Ce que l'étape réutilise, donc :** `useGymLegal` (écriture, normalisation, détection RLS),
les clés i18n `settings.legal.*` (mêmes libellés), et la règle serveur. Elle n'apporte que
les champs et le cadre.

### 🔴 Et en lisant les deux côtés, j'ai trouvé une divergence qui existait déjà

| | champs exigés |
|---|---|
| `lib/gymLegalIdentity.ts` (front) | **6** : legal_name, vat_number, legal_address, legal_postal_code, legal_city, email |
| `gym_legal_identity_missing` (SQL, **celle qui décide**) | **7** : les six, **plus `vat_exempt_mention` quand `vat_exempt` est vrai** |

> « Seule règle conditionnelle : la franchise dispense de facturer la TVA, pas de
> l'expliquer. » — commentaire de la fonction SQL

**Conséquence concrète** : une salle en franchise de TVA sans mention lit dans Réglages que
tout est en ordre pendant que le serveur la déclare incomplète et lui refuse l'encaissement.
Le commentaire de `MollieConnectCard` affirmait même que les deux listes étaient « celle-là
même » — c'était vrai à l'écriture, ça ne l'est plus.

**Mesuré au banc** (Dopamine passée en franchise sans mention, puis annulé) :
`serveur : vat_exempt_mention · front (6 champs) : (rien)`.

⚠️ **Aucune salle n'est aujourd'hui en franchise** (vérifié en production) : le défaut est
réel et n'a pas encore été rencontré. **Ce lot le supprime** — l'assistant, le bandeau de
Réglages et la carte Mollie lisent désormais tous les trois la fonction SQL, via un hook
unique `useLegalIdentityStatus`.

---

## 2. L'étape, et pourquoi une migration dans un lot « dashboard »

**Étape 7, à la fin du parcours.** *Justification en une ligne :* toute autre position
renumérote les étapes déjà enregistrées des salles en cours, et c'est précisément l'étape
qui doit se tenir entre le gérant et le bouton « Terminer ».

🔴 **Le nombre d'étapes est borné à SIX en TROIS endroits**, et `lib/onboarding.ts` le dit
déjà noir sur blanc : *« Trois endroits doivent rester d'accord — la colonne (CHECK), le RPC
`set_gym_onboarding_progress` (bornes 1..6) et cette constante. »*

Ajouter la septième côté écran **sans** toucher aux deux autres produirait le pire des
résultats : le RPC lève `22003`, `saveOnboardingProgress` rend `'failed'`… **et la
progression locale avance quand même**. Le gérant croirait avoir terminé son installation
pendant que la base dirait le contraire. La migration ne fait que **déplacer une borne** :
aucune colonne ajoutée, aucune donnée touchée, aucune règle métier créée.

### Ce que l'étape fait, et ce qu'elle ne fait pas

- **Elle affiche la règle, elle ne la redéfinit pas** : `gym_legal_identity_missing` dit ce
  qui manque, l'étape le montre. Un septième champ ajouté au serveur apparaîtrait ici sans
  qu'on touche une ligne — y compris la mention de franchise, qui s'affiche déjà quand la
  case est cochée.
- **Elle se franchit parce que la chose existe**, jamais parce qu'on a cliqué : après
  enregistrement on **redemande au serveur** et c'est sa réponse qui termine l'assistant.
  Même discipline que les étapes 2 à 6.
- **Elle est sur place**, comme l'étape 1 : renvoyer vers Réglages pour six champs coûterait
  un aller, un retour et l'occasion d'abandonner — et c'est déjà le défaut qu'on corrige,
  puisque l'onglet existe et que personne n'y va.

---

## 3. Dire pourquoi, avant de refuser

Pas « champs obligatoires ». L'étape s'ouvre sur :

> **Ces informations apparaissent sur les factures de tes membres**
> Chaque paiement génère une facture au nom de ta structure : sans ces informations, elle
> serait incomplète et **tu ne peux pas encaisser**. Elles ne sont jamais montrées aux
> autres salles.

Et elle se referme sur : *« Tu pourras les modifier quand tu veux dans Réglages → Salle →
Infos légales et facturation »* — pour que la saisie ne ressemble pas à une porte à sens
unique.

### 🔴 La seule étape non passable du wizard, et c'est assumé

Le principe fondateur de l'assistant est que **chaque étape est passable** — « un onboarding
qui retient son utilisateur en otage est un onboarding qu'on referme et qu'on ne rouvre
jamais ». Cette étape fait exception, parce que la passer ne remet rien à plus tard : elle
**livre une salle qui se croit prête et dont toutes les ventes seront refusées**.

⚠️ **« Plus tard » reste**, lui. Le gérant peut fermer l'assistant et revenir ; ce qu'il ne
peut pas faire, c'est le **terminer**. La nuance est tout l'arbitrage : on ne prend personne
en otage, on refuse seulement de déclarer terminé ce qui ne l'est pas.

---

## 4. Les salles déjà installées — proposé, non codé

⚠️ **La prémisse demande une correction, et elle change la réponse.** Mesuré le 28/09 :

| salle | étape | terminé ? | identité légale |
|---|---|---|---|
| **The Pulse Box** | 6 | ✅ **oui** | ❌ incomplète |
| **Iner Studio** | 1 | ❌ **non** | ❌ incomplète |

**Une seule des deux a terminé l'assistant.** Pour **Iner Studio, il n'y a rien à faire** :
son assistant est encore ouvert, la détection le posera sur l'étape 7, et il ne pourra pas
terminer sans remplir. **Seule The Pulse Box** est hors d'atteinte : `isOpen` exige
`completed === false`, donc son assistant ne se rouvrira jamais.

**Trois façons de la ramener, par coût croissant :**

1. ✅ **Recommandé — rouvrir l'assistant à l'étape 7 quand la salle est terminée MAIS
   incomplète.** ~5 lignes dans `useOnboarding.load()`, aucune migration, et surtout ça
   couvre les cas futurs : une salle installée avant ce lot, ou dont l'identité légale serait
   vidée plus tard. Le seul motif de réouverture est celui-là, et aucune autre étape ne
   ressuscite.
2. **Un bandeau sur le dashboard** plutôt que l'assistant, sur le motif d'`OnboardingReturnBanner`.
   Moins intrusif — et plus facile à ignorer, ce qui est exactement ce qui s'est produit
   pendant une semaine.
3. **Une bascule en base par le cockpit** : `onboarding_completed = false, onboarding_step = 7`
   là où `gym_legal_identity_complete` est faux. Un coup, zéro code — mais ne règle que les
   lignes d'aujourd'hui.

🔴 **Et un piège à nommer avant de choisir la (3) :** elle ne suffirait pas. `useOnboarding`
donne la priorité à la progression **locale** quand elle est en avance, et
`readLocalProgress` du navigateur du gérant porte `completed: true`. Rebasculer la ligne en
base laisserait donc l'assistant fermé **dans son navigateur**. La (1) n'a pas ce défaut :
elle décide sur ce que le serveur sait de l'identité légale, pas sur la progression.

---

## Les preuves

**`tsc --build --force`** (jamais `--noEmit`, GYM-350) — **0 erreur**, sur les **trois
projets référencés** : `tsconfig.app.json` **167 fichiers**, `tsconfig.node.json` 1,
`tsconfig.tests.json` 5.

✅ **Falsification** — le même `tsc --build --force` sur du code volontairement faux :
**2 erreurs**, dont `Property 'champsQuiNExistentPas' does not exist on type
'LegalIdentityStatus'` et le refus de `'gym_legal_identity_missing_inexistante'`. Ce second
message prouve au passage que **le nom du RPC est typé** : la fonction figure bien dans les
types générés depuis le schéma réel.

**Banc transactionnel sur la PRODUCTION** (`BEGIN … ROLLBACK`, DDL comprise) :

| étape | attendu | mesuré |
|---|---|---|
| 1. la colonne accepte 7 | oui | **OK** |
| 2. le RPC accepte 7 | oui | **OK** |
| 3. le RPC **refuse 8** | la borne a bougé, pas disparu | **refusé, comme attendu** |
| 4. étape 7 par salle | 2 franchies, 2 ouvertes | Dopamine ✅ · Pace ✅ · **Pulse Box ❌** · **Iner ❌** (six champs nommés) |
| 5. franchise sans mention | le serveur exige la mention | **serveur : `vat_exempt_mention` · front : (rien)** |

✅ **Étanchéité vérifiée APRÈS coup** : `CHECK` revenu à `<= 6`, RPC revenu à `p_step > 6`,
zéro salle en franchise, étape maximale 6, et les deux salles incomplètes inchangées.

✅ **Parité i18n fr/en** : **1417 clés chacune**, aucun écart dans les deux sens.

### Le parcours d'un gérant neuf, de bout en bout

1. Écran de bienvenue → étape 1 (marque) → 2 activité → 3 coach → 4 créneau → 5 absences →
   6 membre — **inchangées**.
2. **Étape 7** : le bloc « ces informations apparaissent sur les factures de tes membres », la
   liste de ce qui manque telle que le serveur la rend, les six champs (plus la mention si la
   salle est en franchise), un bouton **Enregistrer et terminer**. Pas de « Passer ».
3. Enregistrement → on **redemande au serveur** → s'il ne manque plus rien, l'écran de
   félicitations. Sinon : « C'est enregistré, mais il manque encore quelque chose », et
   l'étape reste ouverte.

### Ce que voit un gérant dont la salle est incomplète

- **Assistant encore ouvert** (Iner Studio) : il tombe sur l'étape 7 et ne peut pas terminer.
- **Assistant déjà terminé** (The Pulse Box) : **rien ne change avec ce lot** — et c'est
  précisément l'objet du § 4. Il garde le bandeau ambre de Réglages → Infos légales (qui
  liste maintenant les champs *du serveur*) et l'avertissement de la carte Mollie.

### Ce que je n'ai pas

⚠️ **Rien n'a été ouvert dans un navigateur.** `tsc` prouve que le code tient, pas que
l'étape s'affiche : le parcours ci-dessus est lu dans le code, pas rejoué à l'écran.

⚠️ **Le cockpit n'a pas été touché**, comme demandé : il lit `gym_legal_identity_complete`,
qui n'est pas modifiée. Ce lot fait l'inverse d'un divergence — il ramène deux écrans du
dashboard **vers** la fonction dont le cockpit dépend déjà.

⚠️ **Rien n'est appliqué.** Ordre : la migration (bornes), puis le dashboard. Dans l'autre
sens, un gérant atteignant l'étape 7 verrait son enregistrement refusé par le RPC.
