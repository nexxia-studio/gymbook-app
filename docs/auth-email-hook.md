# GYM-262 — Send Email Hook : activation par environnement

> **Cette page décrit un geste de CONSOLE.** Le code est livré et déployable, mais
> l'activation du hook se fait à la main dans le dashboard Supabase, **environnement par
> environnement, staging d'abord**. Rien dans le dépôt ne l'active.

## 1. Ce que fait le hook

`supabase/functions/auth-email-hook` intercepte **tous** les emails envoyés par Supabase
Auth (GoTrue) et les recompose aux couleurs du bon tenant :

| Contexte du compte | Marque appliquée |
|---|---|
| Profil `gym_admin` / `super_admin`, ou `user_metadata.signup_intent = 'gym_owner'` | **Viniz** (violet `#4827B4`, fond `#17102E`, mot-marque lime) |
| Compte rattaché à une salle (`profiles.gym_id`, à défaut `user_metadata.gym_id`) | **La salle**, via `_shared/gym-branding.ts` (nom, logo, couleurs, pied de page — lus en base) |
| Aucun contexte exploitable | **Viniz neutre** |

Types couverts : `signup`, `recovery`, `magiclink`, `invite`, `email_change` (une ou deux
adresses selon *Secure Email Change*), plus `reauthentication` (code à saisir) et un
gabarit de repli honnête pour tout type ajouté par GoTrue plus tard.

**Non concerné :** `admin-create-member` (GYM-144) et `invite-team-member` (GYM-200)
utilisent `auth.admin.generateLink()`, qui **génère** un lien sans envoyer d'email — ces
deux parcours composent et envoient déjà le leur et ne passent pas par le hook. Aucun
doublon, rien à dé-brancher.

## 2. Prérequis avant activation

### 2.1 Déployer la fonction

```bash
supabase functions deploy auth-email-hook --project-ref <REF>
```

`verify_jwt = false` est déclaré dans `supabase/config.toml` : GoTrue n'envoie **aucun
JWT**, il signe le corps de la requête. Le déploiement respecte cette déclaration.

> ⚠️ L'authentification du point d'entrée est la **vérification de signature Standard
> Webhooks** faite dans `index.ts`, en tout premier, avant toute lecture de base. Sans le
> secret, la fonction refuse tout appel (`500 Hook mal configuré`).

### 2.2 Poser les secrets

| Secret | Rôle |
|---|---|
| `SEND_EMAIL_HOOK_SECRET` | Signature du hook, au format `v1,whsec_<base64>`. **Généré par le dashboard** (voir §3.1). |
| `RESEND_API_KEY` | Déjà en place — le hook utilise la même clé que les 13 autres emails. |

```bash
supabase secrets set SEND_EMAIL_HOOK_SECRET='v1,whsec_...' --project-ref <REF>
```

`SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` sont injectés d'office dans les Edge
Functions : rien à faire.

### 2.3 Laisser le fournisseur d'email ACTIVÉ

Dans *Authentication → Providers → Email*, l'envoi d'emails doit rester **activé**.

> « Email Provider **Enabled** + Auth Hook **Enabled** → Auth Hook handles email sending
> (SMTP not used) »
> « Email Provider **Disabled** + Auth Hook Enabled → **Email signups disabled** »
> — doc *Send Email Hook*, § Email sending behavior

Le désactiver en croyant « laisser la place au hook » **coupe les inscriptions**.

## 3. Activation (dashboard)

1. **Authentication → Hooks → Send Email hook → Enable**.
2. Type : **HTTPS**. URI :
   `https://<REF>.supabase.co/functions/v1/auth-email-hook`
3. **Generate secret** → copier la valeur `v1,whsec_...` et la poser comme secret de la
   fonction (§2.2). Les deux doivent être **identiques**, sinon chaque email part en
   `401 Signature du hook invalide` — et, le hook étant bloquant, **chaque inscription
   échoue**.
4. Sauvegarder.

### Ordre à respecter

Poser le secret **avant** d'activer le hook. Entre l'activation et la pose du secret,
toute inscription échoue.

### Désactivation d'urgence

*Authentication → Hooks → Send Email hook → Disable*. GoTrue reprend immédiatement ses
propres gabarits. C'est le seul bouton de retour arrière — il n'y a pas de repli
automatique (§5).

## 4. Recette staging (à faire avant prod)

| Parcours | Attendu |
|---|---|
| Inscription gérant (`/signup` dashboard) | Email **Viniz** « Bienvenue sur Viniz », bouton violet, lien → `/signup/confirmed` avec session |
| Inscription membre (app mobile) | Email **aux couleurs de la salle** (logo, lime, pied avec adresse), lien → app |
| Mot de passe oublié (dashboard) | Email Viniz, lien → `/reset-password` avec `type=recovery` dans le fragment |
| Mot de passe oublié (mobile) | Email salle, lien → écran de reset membre |
| Changement d'adresse | 1 ou 2 emails selon *Secure Email Change*, **chaque lien fonctionne** |

**Le test qui compte est le clic**, pas l'aperçu : un email correct avec un lien mort est
pire que l'ancien état. Les liens sont reconstruits à l'identique de ceux de GoTrue
(`/auth/v1/verify?token=…&type=…&redirect_to=…`) parce que ce sont eux — et eux seuls —
que `lib/signupLink.ts`, `lib/inviteLink.ts` et `ResetPassword.tsx` savent consommer via
le fragment d'URL.

### Point à vérifier explicitement en staging : le plafond d'envoi

La doc *Rate limits* indique pour les endpoints qui déclenchent un email :
« 2 emails per hour with the built-in email provider. You can only change this with a
custom SMTP setup. » Elle ne dit **pas** si le Send Email Hook lève ce plafond au même
titre qu'un SMTP personnalisé. Comme le funnel public en dépend directement, il faut le
constater sur staging (plus de 2 inscriptions dans l'heure) avant d'activer en production,
et basculer sur un SMTP personnalisé si le plafond tient.

## 5. ⚠️ Le hook est BLOQUANT — il n'y a pas de repli

C'est le point le plus important de cette page.

> « When an error is returned, the error is propagated from the hook to Supabase Auth and
> translated into an HTTP error which is returned to your application. »
> « Both HTTP Hooks and Postgres Hooks are run in a transaction […] HTTP Hooks should
> complete in **5 seconds**. »
> — doc *Auth Hooks*, § Error handling / § Timeouts

Quand le hook est activé, GoTrue lui délègue l'envoi et **ne revient jamais** à ses
gabarits par défaut. Une erreur ici ne dégrade pas l'email : elle fait **échouer
l'opération d'authentification elle-même** (l'inscription, le reset…).

Ce que la fonction en tire :

1. **Rien de décoratif ne peut faire échouer un email.** La lecture du profil et celle de
   la salle sont best-effort ; en cas d'échec, l'email part en gabarit **neutre**.
2. **Try/catch global** : toute sortie est un JSON `{"error":{"http_code":…,"message":…}}`
   avec `Content-Type: application/json` — exigé par GoTrue, y compris sur les erreurs.
3. **Seul un échec d'envoi remonte en erreur.** Rendre `200` sans avoir envoyé
   fabriquerait un compte que personne ne peut confirmer : un échec franc, que
   l'utilisateur peut retenter, vaut mieux qu'un trou noir silencieux.
4. **Ré-essais** : une panne passagère (Resend `429`/`5xx`, réseau) est renvoyée en `429`
   + en-tête `retry-after`, les deux conditions exigées pour que GoTrue retente (jusqu'à
   3 fois, dans la même enveloppe de 5 s). Un refus définitif (`RESEND_API_KEY` absent,
   adresse invalide) remonte en `500` sans ré-essai.
5. **Budget tenu** : au plus deux lectures Postgres et un appel Resend, ce dernier borné à
   3 s par un `AbortController` — un abandon tracé dans nos logs vaut mieux qu'un timeout
   décidé par GoTrue, qui n'en laisse aucune trace de notre côté.

## 6. Développement local (non commité — et pourquoi)

Pour tester le hook sur la stack locale, ajouter **temporairement** à `supabase/config.toml` :

```toml
[auth.hook.send_email]
enabled = true
uri = "http://host.docker.internal:54321/functions/v1/auth-email-hook"
secrets = "env(SEND_EMAIL_HOOK_SECRET)"
```

et dans `supabase/functions/.env` :

```ini
SEND_EMAIL_HOOK_SECRET='v1,whsec_<base64>'
```

puis `supabase functions serve auth-email-hook --no-verify-jwt`.

> 🔴 **Ce bloc n'est volontairement PAS commité.** `supabase config push` pousse
> `config.toml` vers le projet lié : un `[auth.hook.send_email] enabled = true` versionné
> activerait le hook **à distance**, sans passer par le dashboard et sans que le secret
> correspondant ait été posé — c'est-à-dire en coupant les inscriptions de
> l'environnement. L'activation reste un geste de console, assumé et réversible.

## 7. Journalisation

Tout passe par `console.log` / `console.error`, lisible dans *Edge Functions → Logs* :

```
[auth-email-hook] signup pour <user_id>
[auth-email-hook] marque retenue: viniz|gym|neutral (<nom>)
[auth-email-hook] type d'email non spécialisé: <type>     ← un type GoTrue non couvert
[auth-email-hook] signature invalide: …                   ← secret désaligné
[auth-email-hook] envoi échoué: … (retryable: true|false)
```

`marque retenue: neutral` sur un compte censé être rattaché à une salle signale une
lecture de profil en échec ou un `gym_id` absent — l'email est bien parti, mais sans la
marque attendue.

## 8. Références

- Send Email Hook — <https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook>
- Auth Hooks (erreurs, ré-essais, timeouts) — <https://supabase.com/docs/guides/auth/auth-hooks>
- Rate limits — <https://supabase.com/docs/guides/auth/rate-limits>

Documentation consultée le **24/08/2026** ; Supabase CLI **2.98.2** ; bibliothèque de
signature `standardwebhooks@1.0.0` (celle citée par la doc Supabase).
