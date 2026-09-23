# GYM-359 — Slack apprend qu'une salle n'encaisse plus

**Branche** `gym-alerte-ventes` · **base** `develop` · aucun déploiement, **aucun build Expo**.
Serveur uniquement : une migration, une Edge Function.

> Du 17 au 23/09, six membres de Dopamine ont tenté 19 achats. Tous ont échoué. **Un seul l'a
> signalé.** Antoine l'a découvert six jours plus tard, en lisant la base à la main.
>
> **Le cockpit permet de chercher. Il ne prévient pas.** C'est une différence de nature, pas
> de degré : un tableau de bord répond à qui l'ouvre, une alerte va chercher celui qui ne l'a
> pas ouvert.

---

## 1. Les seuils retenus, et leur simulation sur septembre

**Deux règles, fenêtre de 24 h, l'une suffit :**

| | Règle | Ce qu'elle attrape |
|---|---|---|
| **A** | un même **membre** : ≥ 2 échecs et **aucun succès** | un défaut qui ne frappe **qu'un chemin d'achat** |
| **B** | la **salle** : ≥ 3 échecs et **aucun succès** | la panne globale, même si chacun n'essaie qu'une fois |

⚠️ **Un `expired` isolé est normal**, et ce n'est pas une opinion : sur les 38 expirations de
septembre, Mollie a mis **16 à 60 minutes** (20 en moyenne) à expirer un paiement qu'un membre
avait ouvert puis abandonné. Le signal n'est donc pas l'échec — c'est la **répétition** doublée
de l'**absence de succès**.

### La simulation, heure par heure, comme le fera le cron

Rejouée sur les **90 paiements réels de septembre** (52 payés / 38 expirés) — **5 épisodes en
23 jours**, soit un tous les 4,6 jours :

| # | Période | Ce que c'était | Règle |
|---|---|---|---|
| ① | 03 → 05/09 | **Antoine Baczynski, 3 tentatives, jamais payé** (jusqu'à 120 €) ; Romu, 2 échecs puis paiement le lendemain | A |
| ② | 17 → 18/09 | 3 échecs, 0 succès | B |
| ③ | 19 → 20/09 | un membre, 2 échecs | A |
| ④ | 21 → 22/09 | les deux | A + B |
| ⑤ | 22 → 23/09 | **pic à 15 échecs, 4 membres bloqués** | A + B |

**Utiles : les cinq.** ② à ⑤ tombent dans la fenêtre d'incident. Et ① n'est **pas** un faux
positif — vérifié ligne à ligne : Antoine Baczynski a tenté 15 €, puis 120 €, puis 15 €, sans
jamais aboutir. Une vente perdue que personne n'a vue passer, c'est-à-dire exactement ce qu'on
cherche.

### Ce que les seuils écartent

⚠️ **Zéro alerte du 01 au 02/09, malgré CINQ échecs le 02.** Il y a eu huit paiements le même
jour. C'est précisément ce que « sans aucun succès » doit écarter — et c'est la mesure qui
valide le seuil, pas le raisonnement.

### Pourquoi la règle A est indispensable

**La règle B seule aurait donné 3 épisodes et manqué le 23/09 en entier** : la salle vendait
encore (une séance à 20 € passée à 6 h 54) pendant que neuf achats échouaient. C'est la mesure
qui a fait garder A, pas une préférence — et c'est exactement le défaut GYM-352, qui ne frappe
qu'un écran d'achat sur deux.

### Vérification en conditions réelles

Fonction appliquée **dans une transaction sur la production**, puis annulée. Ce qu'elle rend
**à l'instant** :

```
15 échecs · 2 succès · 4 membres bloqués · 585 € en jeu
règle A : true   règle B : false
Pierre Molmy 8 tentatives · Antoine Monie 3 · François Quoilin 2 · Emma uhoda 2
```

**L'alerte partirait maintenant, pour l'incident qui est encore en cours.**

⚠️ **Et le montant n'est pas la somme des tentatives.** Pierre a tenté **quatre fois** la même
formule à 90 € : additionner annoncerait 360 € là où la salle risque d'en perdre 90. On somme
donc, par membre, **une seule fois chaque formule distincte ratée**. Sur l'incident en cours :
**585 € au lieu de 1 555 €** — un chiffre sur lequel on peut décider.

---

## 2. Ce qui ne doit pas arriver

| | |
|---|---|
| **a. Pas de répétition** | Une ligne ouverte dans `webhook_failures` tant que l'épisode dure. Tant qu'elle est là, on ne redit rien. Motif **GYM-338**. |
| **b. Le retour à la normale se dit** | À la disparition de l'incident, la ligne se referme **et un message part** : durée de l'épisode, et le dernier paiement abouti (membre, montant, heure). |
| **c. Silence nominal** | Aucun message quand tout va bien. La fonction ne rend **aucune ligne**. |

🔴 **Sans (b), on ne saurait jamais si c'est réparé** — et la prochaine alerte se lirait comme
la continuation de la précédente. C'est la moitié qui manque à la plupart des systèmes
d'alerte, et celle qui fait qu'on finit par ne plus les lire.

⚠️ **La ligne vit dans `webhook_failures`**, comme le filet de GYM-345. Le nom est impropre et
c'est assumé : cette table **est** la boîte aux lettres morte que le cockpit relève déjà. En
créer une seconde éparpillerait la surveillance sur deux endroits, dont un que personne n'aurait
l'habitude de regarder.

---

## 3. Ce que le message contient

**De quoi agir sans ouvrir la base** : la salle · les membres concernés et **leur nombre de
tentatives** · les formules · le **montant en jeu** · la première et la dernière tentative ·
un **bouton vers la fiche salle du cockpit** (`/cockpit/:gymId`, route du lot 2).

Et il dit **quelle règle a parlé**, parce que ça oriente le regard :

- *« 4 membres qui échouent sans jamais aboutir — la salle encaisse encore par ailleurs
  (2 paiements) »* → un **chemin d'achat** est cassé ;
- *« 15 échecs et aucun paiement en 24 h »* → la **salle entière**.

⚠️ **Canal interne : les noms des membres sont là, et ils sont nécessaires** — sans eux,
personne ne peut rappeler qui que ce soit. **Aucun email, aucun identifiant Mollie** : ils
n'aident à rien ici et n'ont rien à faire dans un canal d'équipe.

---

## 4. La mécanique

| | |
|---|---|
| **Détection** | `payment_incident_state(gym)` et `payment_alerts_pending()` — SQL, `SECURITY DEFINER`, `service_role` |
| **Envoi** | `send-payment-alerts`, Edge Function appelée par cron |
| **Cron** | **`send-payment-alerts`, `10 * * * *`** — à poser par le cockpit, par clonage |

**Pourquoi `:10`** : les jobs de production occupent `:00`, `:05`, `:25`, `:35`, `:50`, la
grille des quarts (`*/15`) et les demies (`*/30`) ; GYM-250 ajoute `:40` et `:55`. `:10` est
libre à l'heure — il ne croise `process-failed-renewals` qu'une fois par jour, à 07:10, sur une
autre fonction et d'autres tables.

**Pourquoi toutes les heures et pas plus souvent** : un abandon met **15 à 60 minutes** à
devenir `expired`. Passer toutes les cinq minutes ne détecterait rien de plus tôt, et
multiplierait par douze les occasions de se tromper.

### 🔴 La trace est écrite APRÈS l'envoi, jamais avant

`payment_alerts_pending()` **n'écrit rien**. Si elle ouvrait la ligne en même temps qu'elle rend
le message, un échec Slack laisserait une ligne ouverte pour un message jamais parti :
**l'alerte serait perdue pour toujours** — le silence même que ce lot supprime.

Le risque résiduel est donc inversé : un message envoyé **deux fois** si le marquage échoue
derrière un envoi réussi. **Un doublon se lit, un silence ne se lit pas.**

---

## Ce qui se passe si Slack répond en erreur

| Cas | Comportement |
|---|---|
| **`SLACK_WEBHOOK_URL` absent** | La fonction **ne plante pas** : elle journalise, rend `{skipped: "no_webhook"}` et sort en 200. Rien n'est marqué. Une alerte muette ne doit pas casser le cron ni remplir les journaux — sinon on remplace un silence par du bruit. |
| **Slack répond 4xx/5xx** | **Rien n'est marqué** → le passage suivant du cron réessaiera, et l'alerte finira par partir. Une ligne de lettre morte est consignée. |
| **Réseau injoignable** | Idem : pas de marquage, lettre morte, réessai à l'heure suivante. |
| **Une salle en échec** | Les autres sont traitées quand même — la boucle `continue`, elle ne s'arrête pas. |

⚠️ **La lettre morte est rangée sous `function_name = 'payment-alerts-slack'`, pas
`'payment-alerts'`.** Ce n'est pas un détail : `payment_alerts_pending` cherche une ligne
ouverte `'payment-alerts'` pour savoir si un épisode est déjà signalé. Une panne Slack rangée
là serait prise pour un épisode en cours et **empêcherait la vraie alerte de partir** — le
silence, encore, par la porte de derrière.

---

## Ce qu'on ne détecte PAS

C'est la partie qu'il faut lire avant de se croire couvert.

1. 🔴 **Le membre qui renonce sans jamais lancer d'achat.** Aucune ligne `payments` n'existe :
   ce mécanisme est aveugle par construction. Un bouton « Acheter » qui ne répondrait pas, une
   liste de formules vide, un écran qui plante avant l'appel — rien de tout cela ne produira
   d'alerte. **C'est la plus grosse zone d'ombre, et elle est structurelle.**
2. **Le délai d'expiration.** Un abandon ne devient `expired` qu'au bout de **15 à 60 minutes**.
   L'alerte arrive donc au mieux ~20 minutes après le premier échec, ~1 h 20 après avec le cron.
3. **La salle qui ne vend rien parce que personne n'essaie.** Zéro tentative, zéro alerte — et
   c'est voulu : une salle sans achat n'est pas en panne, elle est calme. Le cockpit reste le
   bon outil pour ça (`derniere_activite`, PR #310).
4. **Un membre unique qui échoue une seule fois et abandonne.** Sous les deux seuils, et
   délibérément : c'est le cas nominal d'un client qui hésite. Descendre plus bas, c'est du
   bruit — et une alerte qu'on n'ouvre plus ne vaut rien.
5. **Les échecs hors `payments`** : un abonnement récurrent dont le prélèvement échoue passe par
   `process-failed-renewals` (GYM-252), pas ici.

---

## Les preuves

- **`deno check` — 37 / 37** (36 + `send-payment-alerts`), pas seulement la nouvelle
- **Simulation sur les données réelles de septembre** : 5 épisodes en 23 jours, aucun sur une
  journée où la salle vendait
- **Fonctions appliquées dans une transaction sur la production**, puis annulées : elles
  répondent, et rendent `open` pour Dopamine avec les 4 membres et les 585 €
- **Contrôle d'application** dans la migration : les trois fonctions existent **et répondent**
  sur une vraie salle — on ne se contente pas de vérifier qu'elles sont là

### Ce que je n'ai pas

⚠️ **Aucun message n'a été envoyé dans Slack** : `SLACK_WEBHOOK_URL` n'est pas posé, et ce lot
n'a pas le droit de déployer. Le rendu du message se lit au diff ; ce qui est vérifiable — la
détection, les seuils, le contenu du payload — l'est sur les données réelles.

⚠️ **Rien n'est appliqué.** Ordre : la migration, puis la fonction Edge, puis le secret, puis
le cron.
