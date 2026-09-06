# GYM-282 — `send-notification` : audit des appelants

> **🔴 ARRÊT APRÈS AUDIT, comme le ticket le prévoit.** Un appelant **CLIENT** existe. La
> garde `X-Internal-Secret` telle que décrite **casserait une fonctionnalité du dashboard**,
> et aucune variante de ce motif ne peut la sauver : un navigateur ne peut pas détenir un
> secret partagé. Le design change, l'arbitrage revient au cockpit.

---

## 1. Le fait, confirmé

`send-notification` n'a **aucune garde d'autorisation**. `verify_jwt = true`
(`supabase/config.toml:191`) vérifie qu'un JWT *existe*, pas que son porteur a le droit.

Le corps accepte `tokens` — **des jetons Expo fournis par l'appelant** — et les pousse tels
quels. La seule garde présente (GYM-246) porte sur le **plan** de la salle et n'est active
que si `gym_id` est fourni, ce qui est **optionnel** :

```ts
// Fourni ⇒ la garde s'applique ; absent ⇒ on laisse passer, la décision appartient à
// l'appelant qui, lui, connaît la salle.
```

Autrement dit : **omettre `gym_id` désactive la seule vérification existante.** Tout porteur
d'un JWT valide — n'importe quel membre connecté de n'importe quelle salle — peut faire
partir une notification vers n'importe quel jeton Expo qu'il connaît, avec le titre et le
corps de son choix.

---

## 2. Les appelants — **10**, pas 9

### Serveur-à-serveur — 9, tous en `SERVICE_ROLE`

| # | fonction | comment elle appelle | authentification |
|---|---|---|---|
| 1 | `send-reminders` | `fetch` `/functions/v1/send-notification` | `Bearer ${serviceKey}` |
| 2 | `notify-waitlist` | `fetch` | `Bearer ${serviceKey}` |
| 3 | `slot-series-op` | `fetch` | `Bearer ${serviceKey}` |
| 4 | `mark-attendance` | `fetch` | `Bearer ${serviceKey}` |
| 5 | `cancel-slot` | `fetch` | `Bearer ${serviceKey}` |
| 6 | `admin-book-member` | `fetch` | `Bearer ${serviceKey}` |
| 7 | `send-communication` | `fetch` | `Bearer ${serviceKey}` |
| 8 | `mollie-webhook` | `supabase.functions.invoke` | client `SERVICE_ROLE` |
| 9 | `mollie-subscription-webhook` | `supabase.functions.invoke` | client `SERVICE_ROLE` |
| 10 | `admin-lift-suspension` | `admin.functions.invoke` | client `SERVICE_ROLE` |

*(10 lignes : le ticket en annonçait 9 — l'écart vient d'`admin-lift-suspension`, qui appelle
via un client `admin` et non par `fetch`, donc invisible à un grep sur l'URL.)*

### 🔴 Client — 1

| appelant | fichier | authentification |
|---|---|---|
| **Dashboard gérant**, « envoyer un push à un membre » | `apps/dashboard/src/hooks/useGymAdminActions.ts:116` | `invokeEdge` → **clé anon + JWT de session du gérant** |

```ts
const { error } = await invokeEdge('send-notification', {
  body: { tokens: [profile.push_token], title, body, data: { type: 'admin_message' } },
})
```

⚠️ Cet appel **n'envoie pas `gym_id`** : il contourne donc aussi la garde de plan de GYM-246.

### Ailleurs — aucun

- `apps/mobile` : **aucun** appel.
- `supabase/migrations` : **aucun** appel (ni trigger, ni `pg_net`).
- `pg_cron` : les jobs existants n'appellent pas cette fonction.

---

## 3. Pourquoi la garde prévue ne peut pas être posée telle quelle

`X-Internal-Secret` (variable `INTERNAL_FUNCTIONS_SECRET`, déjà employée par huit fonctions)
suppose que **l'appelant est un serveur**. Le dashboard est du **JavaScript livré au
navigateur** : y placer le secret revient à le publier — n'importe quel gérant, et n'importe
qui ouvrant les outils de développement, le lirait dans le bundle.

Poser la garde sans traiter cet appelant **casserait l'envoi de push depuis le dashboard**,
en production, sans repli.

---

## 4. Les trois issues possibles — avec recommandation

### 🟢 Option 1 — **RECOMMANDÉE** : une fonction dédiée pour le geste gérant

Le dashboard cesse d'appeler `send-notification` et appelle une fonction **`admin-send-push`**
qui, elle, garde `verify_jwt = true` **et** vérifie l'autorisation :

- le porteur du JWT est-il `gym_admin` ?
- le membre visé appartient-il à **sa** salle ?
- elle résout le `push_token` **côté serveur** (le dashboard n'a plus à le lire ni à le
  transmettre) et appelle `send-notification` en `SERVICE_ROLE` + `X-Internal-Secret`.

`send-notification` devient alors **purement serveur-à-serveur** et reçoit la garde du ticket,
sans exception.

> **Pourquoi c'est le bon découpage** : `send-notification` est un *tuyau*, son commentaire
> le dit déjà (« cette fonction est un tuyau appelé par d'autres »). Un tuyau ne devrait
> jamais être exposé au public ; l'autorisation appartient à la fonction *métier* qui sait ce
> qu'elle envoie et à qui. Bénéfice de bord : le dashboard n'a plus besoin de lire
> `profiles.push_token`, une donnée qu'il n'a aucune raison de manipuler.

### 🟡 Option 2 — garder l'appel client, ajouter l'autorisation dans `send-notification`

`send-notification` accepte deux régimes : `X-Internal-Secret` (serveur) **ou** un JWT dont
elle vérifie le rôle et la salle. Moins de code à écrire, mais la fonction cumule tuyau et
contrôle d'accès, et **reste publiquement joignable** — la surface d'attaque ne disparaît pas,
elle se déplace derrière une vérification supplémentaire qu'il faudra maintenir.

### 🔴 Option 3 — poser la garde et accepter la casse

Non recommandée : l'envoi de push du dashboard tombe en production, sans repli.

---

## 5. Ce que ce lot ne fait PAS

Aucune garde n'est posée, aucun appelant modifié, aucun secret introduit. Le ticket demande
l'arrêt après audit dans ce cas précis, et l'arrêt est respecté.

**Une fois l'option tranchée**, la checklist de déploiement sera livrée avec
l'implémentation : l'ordre y est déterminant — les appelants portant le secret doivent être
déployés **avant** que la garde ne s'active, sans quoi les notifications tombent entre les
deux déploiements.
