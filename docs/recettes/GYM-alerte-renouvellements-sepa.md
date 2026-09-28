# Surveillance des renouvellements SEPA — les premiers prélèvements sont le 30/09

**Branche** `gym-alerte-renouvellements` · **base** `develop` · aucun déploiement, **aucun
build Expo**. Serveur uniquement : une migration, une Edge Function.

> Le 30/09, trois prélèvements automatiques partent : Robin Hendrix (120 €), Sarah Caughey
> (110 €), Faustin Canei (120 €). Puis deux le 01/10, un le 04/10.

---

## Ce qui n'a jamais tourné — et ce qui a déjà tourné

⚠️ **La prémisse du lot demande une nuance, et elle change où il faut regarder.** Vérifié sur
la base le 28/09 :

- **SIX renouvellements ont DÉJÀ été encaissés** — lignes `payments` « Renouvellement — … »,
  du 30/08 au 08/09. La branche `recurring` du webhook a donc bien tourné.
- **MAIS** l'avancement de `next_payment_at` et la remise à NULL de `prenotification_sent_at`
  sont le fait de **GYM-334, déployé le 09/09** — soit *après* les six. Leur `updated_at` le
  confirme : la dernière écriture sur ces lignes est celle de la pré-notification (07:35),
  jamais celle d'un renouvellement.

🔴 **Le maillon qui enchaîne une échéance sur la suivante n'a donc jamais été exécuté une
seule fois.** Le 30/09 est sa première. Et le chemin d'échec — `active → past_due → suspended`
— n'a lui non plus jamais servi : **zéro** échec bancaire dans toute l'histoire de la base
(`payment_failed_count = 0` sur les 9 abonnements).

---

## 1. Les seuils, et pourquoi 120 heures

🔴 **Un prélèvement SEPA n'est pas instantané, et c'est toute la difficulté du point 1.**
Mollie crée le paiement à l'échéance, mais il ne passe `paid` que plusieurs jours plus tard.
Alerter trop tôt, c'est alerter sur chaque échéance normale.

**Mesuré — pas supposé — en interrogeant l'API Mollie sur les six renouvellements réels**
(`createdAt` → `paidAt`, lecture seule ; le jeton n'a jamais quitté la base) :

| méthode | création → payé |
|---|---|
| creditcard | **0,0 h** (2 secondes) |
| directdebit | 32,7 h |
| directdebit | 32,8 h |
| directdebit | 35,6 h |
| directdebit | 36,6 h |
| directdebit | **77,4 h** ← créé un vendredi 19:30, payé le mardi 00:55 |

🔴 **Le cas à 77 heures est le cas NORMAL d'un week-end** : SEPA ne compense pas le samedi.
C'est lui qui commande le seuil, pas la moyenne.

Et il faut y ajouter le **délai de création** : `next_payment_at` est une date à 00:00 UTC,
Mollie crée le prélèvement dans la journée (heures observées : 09:30, 10:30, 13:30, 19:30).
**Pire cas normal depuis l'échéance : 96,9 h.**

### La simulation du seuil, sur ces six renouvellements

| seuil | fausses alertes / 6 |
|---|---|
| 24 h | **5** |
| 48 h | 1 |
| 72 h | 1 |
| 96 h | 1 |
| **120 h** | **0** |

→ **X = 120 heures (5 jours)** : 23 h de marge sur le pire cas mesuré, et encore **25 jours
d'avance** sur l'échéance suivante. On ne l'apprend pas « au prélèvement suivant », qui était
le risque de l'autre côté.

⚠️ **Ce seuil est trop large pour une carte** (0,0 h mesuré) : un renouvellement par carte
silencieux sera connu 5 jours plus tard au lieu d'un. Assumé — 7 des 8 mandats sont des
domiciliations. À revoir le jour où la carte devient courante, la mesure en main.

---

## 2. Les quatre motifs

| motif | ce qu'il attrape |
|---|---|
| 🔴 `no_debit` | Échéance dépassée de **> 120 h**, statut toujours `active`, rien ne l'a avancée. **Le pire des cas : personne ne s'en plaint.** Le membre garde son accès et n'est pas débité. |
| `past_due` | Un refus de banque : le webhook d'échec est passé. |
| `suspended` | La grâce de 3 jours s'est écoulée sans régularisation. |
| 🔴 `chain_stalled` | L'argent est rentré, mais `next_payment_at` est figé **ou** `prenotification_sent_at` n'est pas reparti de zéro. **La prochaine échéance partirait sans avis SEPA** — défaut de conformité, strictement invisible autrement. |

**`status = 'active'` est le discriminant du motif 1** : un refus aurait posé `past_due`.
Actif *et* en retard = ni succès, ni échec connu. C'est un **silence de Mollie**.

**Le motif 4 vérifie deux invariants** que le webhook écrit dans une seule mise à jour :
(a) l'échéance a avancé — `next_payment_at > dernier renouvellement encaissé` ; (b) l'avis est
reparti de zéro — `prenotification_sent_at` NULL ou postérieur. Une heure de grâce, parce que
les deux écritures se suivent à quelques millisecondes dans le même webhook.

### ⚠️ Ce qu'on n'alerte PAS, et il faut le dire aussi fort

Un abonnement qui **arrive à son terme et s'arrête n'est pas un incident** : `ends_at` atteint
→ `expired` (par `expire_subscriptions`) ou `completed`, et aucun de ces statuts n'entre ici.
Idem pour une ligne sans échéance à venir (`next_payment_at IS NULL` — Mollie a fini de
prélever), pour un abonnement dont le compteur est épuisé, et pour `auto_renew = false`.
C'est le cas de l'abonnement à paiement unique de la base : il ne déclenche rien.

---

## 3. La mécanique — reprise de GYM-359, pas réinventée

| | |
|---|---|
| Détection | `renewal_incident_state` / `renewal_alerts_pending` / `renewal_alert_mark` |
| Envoi | `send-renewal-alerts`, Edge Function appelée par cron |
| **Cron proposé** | **`send-renewal-alerts`, `20 * * * *`** |

**Pourquoi `:20`.** Relevé des jobs de production le 28/09 : `:00` cleanup-oauth-states,
`:05` expire-subscriptions, `:10` send-payment-alerts, `:25` send-subscription-reminders,
`:35` send-sepa-prenotifications, `:40` close-expired-trials, `:50` member-gyms-drift,
`:55` send-trial-reminders, plus `*/15` (:15 :30 :45) et `*/30`. **`:20` est la seule minute
de l'heure qui ne soit prise par aucun job nommé.**

⚠️ **Et sa place est bonne, pas seulement libre** : dix minutes après `send-payment-alerts`
(les deux émetteurs Slack ne postent jamais dans la même minute), quinze minutes après
`expire-subscriptions` (un abonnement arrivé à terme est déjà `expired` quand on le lit, donc
jamais pris pour un incident), et quinze minutes **avant** `send-sepa-prenotifications` (on
observe l'état des avis avant qu'il ne bouge, pas pendant).

🔴 **La trace est écrite APRÈS l'envoi, jamais avant.** `renewal_alerts_pending` n'écrit rien :
si elle ouvrait la ligne en même temps qu'elle rend le message, un échec Slack laisserait une
ligne ouverte pour un message jamais parti — l'alerte perdue pour toujours. Le risque résiduel
est inversé : un doublon. **Un doublon se lit, un silence ne se lit pas.**

⚠️ **L'épisode est identifié par (abonnement, motif)**, et non par abonnement seul. Un
abonnement qui passe `past_due` puis `suspended` vit **deux faits distincts**, tous deux à
dire : un refus de banque, puis la coupure d'accès. Une clé par abonnement aurait tu le second.

⚠️ **Le nom du membre est dans le message, l'identifiant Mollie n'y est pas.** Sans le nom,
personne ne peut rappeler qui que ce soit ; l'identifiant d'abonnement sert de clé d'épisode
**en base** et n'aide personne dans un canal d'équipe. Aucun email.

---

## La simulation sur septembre

**Zéro alerte** — et c'est la bonne réponse, parce que rien n'a déraillé :

| motif | septembre |
|---|---|
| `no_debit` (seuil 120 h) | **0** (à 24 h : 5 fausses alertes) |
| `past_due` | **0** — aucun échec bancaire dans toute l'histoire de la base |
| `suspended` | **0** |
| `chain_stalled` | **0** — les six renouvellements précèdent GYM-334, et leurs invariants tiennent |

⚠️ **Une vraie rediffusion heure par heure est IMPOSSIBLE ici, et je ne fais pas semblant** :
`member_subscriptions` n'a pas d'historique — pas de table d'audit, pas de trace des valeurs
passées de `next_payment_at`. Ce qui est simulé l'est sur ce qui *est* daté : les six
renouvellements réels et leurs délais mesurés chez Mollie. **La première épreuve réelle est le
30/09.**

---

## Ce que ce mécanisme ne détecte PAS

1. 🔴 **Une pré-notification qui n'est jamais PARTIE.** On détecte que l'avis n'a pas été
   *réinitialisé* (motif 4b), pas qu'il n'a pas été *envoyé* : si le cron
   `send-sepa-prenotifications` tombe en panne, `prenotification_sent_at` reste NULL et **rien
   ne le signale**. C'est le miroir exact du motif 4, et le même défaut de conformité. Le
   prédicat tiendrait en une ligne — `next_payment_at < now() + 14 j AND
   prenotification_sent_at IS NULL` — mais c'est un cinquième motif, et le lot en demandait
   quatre. **À poser au prochain passage.**
2. 🔴 **La différence entre « Mollie n'a pas prélevé » et « Mollie a prélevé mais nous n'avons
   rien reçu ».** Les deux produisent exactement le même état en base. L'alerte dira
   « prélèvement jamais arrivé » dans les deux cas. L'action requise diffère : dans le second,
   l'argent est encaissé et c'est le webhook qu'il faut rejouer.
3. **Un montant erroné.** On ne compare pas `amount` : un prélèvement du bon nombre mais du
   mauvais montant passe pour normal.
4. **Un rejet ou un remboursement APRÈS coup.** Une domiciliation SEPA est contestable
   jusqu'à huit semaines ; un `chargeback` tardif n'est pas surveillé ici.
5. **Un abonnement sans identifiant Mollie** — il sert de clé d'épisode. Ces lignes ne sont
   pas renouvelées automatiquement (le paiement unique de la base est dans ce cas).
6. ⚠️ **Le rapprochement paiement ↔ abonnement est FRAGILE, et c'est dit dans le code** : il
   n'existe aucune clé étrangère entre `payments` et `member_subscriptions`. Il se fait sur
   (membre, salle) et sur le préfixe de libellé « Renouvellement — » posé par le webhook. **Un
   membre ayant DEUX abonnements dans la même salle verrait ses renouvellements confondus** —
   aucun n'est dans ce cas (vérifié le 28/09). Une colonne `subscription_id` sur `payments`
   réglerait ça pour de bon, mais pas dans un lot d'alerte à deux jours de la première
   échéance.
7. **Une résiliation** (`cancelled` / `canceling`) : c'est une décision, pas un incident.

---

## Les preuves

**Banc transactionnel sur la PRODUCTION** (`BEGIN … ROLLBACK`, DDL comprise) — les trois
fonctions créées, trois pannes injectées sur de vrais abonnements, puis tout remis :

| étape | attendu | mesuré |
|---|---|---|
| 1. tout va bien | silence | **0 alerte** |
| 2. trois pannes injectées | 3 ouvertures, bons motifs | **`no_debit`/robin hendrix · `past_due`/Sarah Caughey · `chain_stalled`/Catherine Argento** |
| 3. envoi réussi → marquage | 3 lignes ouvertes | **3** |
| 4. passage suivant du cron | **pas de répétition** | **0 — silence** |
| 5. tout rentre dans l'ordre | 3 résolutions | **3 `resolved`** |

✅ **Étanchéité vérifiée APRÈS coup** : les trois fonctions absentes de la production, l'index
absent, zéro ligne `renewal-alerts` dans `webhook_failures`, et les 9 abonnements tous revenus
à `active`.

✅ **`deno check` — 38 / 38** fonctions (37 + la nouvelle), pas seulement la nouvelle.

✅ **Falsification** : le même `deno check` sur du code volontairement faux → **2 erreurs**
(`Property 'motifQuiNExistePas' does not exist on type 'Alerte'`). Le contrôle sait dire non.

✅ **Mesure Mollie** : six lectures réelles de l'API sur nos propres paiements, jeton lu dans
le coffre et jamais sorti de la base.

### Ce que je n'ai pas

⚠️ **Aucun message n'a été envoyé dans Slack** : `SLACK_WEBHOOK_URL` n'est pas posé et ce lot
ne déploie rien. Le rendu se lit au diff ; la détection, elle, est éprouvée sur les données
réelles.

⚠️ **Aucun vrai refus de banque n'a été observé** — il n'en existe aucun dans la base. Le
motif `past_due` est éprouvé sur un statut injecté, pas sur un webhook Mollie réel.

⚠️ **Rien n'est appliqué.** Ordre : la migration, puis la fonction Edge, puis le cron —
**avant le 30/09**.
