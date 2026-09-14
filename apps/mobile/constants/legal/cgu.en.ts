// Terms & Conditions — v1 PUBLISHABLE.
// Source of truth: docs/legal/cgv-v1.md (publishable body ONLY; the source's internal
// appendices are NEVER reproduced here).
// 🔴 GYM-293b — the Club identity is a placeholder, no longer an interpolation: see the
// French template for the full reasoning. `${CLUB_IDENTITY.name}` was evaluated at import
// time, sealing Dopamine's name into the string before any gym was known.
// Faithful translation of the frozen FR text — same article structure. Each "N.x"
// sub-clause is blank-line separated (the MarkdownText renderer merges contiguous lines).
//
// 🔴 GYM-333b (§ 2 of the audit) — TWO CONTRACTS, AND THE DOCUMENT NOW SAYS SO.
// This text has always covered two contracts — app use (member ↔ Publisher) and the
// purchase of services (member ↔ Club) — and said so nowhere. Prefixed numbering (A/B/C)
// is the heart of the fix: "art. B4" names its own contract in the citation itself, which
// a continuous 1..N numbering would have lost at the first cross-reference. The third
// block is deliberate: force majeure, complaints, severability, governing law and disputes
// bind BOTH contracts, and duplicating them across A and B would inevitably drift.
//
// ⚠️ APPENDIX, NOT A LINK. MarkdownText supports no links and no tables, so the statutory
// withdrawal form (Annex 2 to Book VI CEL) is REPRODUCED at the end of the document — the
// only shape that makes it genuinely reachable from the terms inside the app.
//
// ⚠️ The early-performance checkbox does NOT exist yet (its own ticket: it needs a
// migration to timestamp the proof). Art. B4 therefore does NOT presume it — that was the
// defect. It rests on the VI.53, 12° exclusion, which requires no declaration from the
// member, and states plainly that absent an express request the refund is IN FULL.
//
// 🔴 C1.4 is an OBLIGATION OF RESULT, not the description of a mechanism — same lesson as
// point 3. A first draft announced subscriptions "suspended, no instalment collected". That
// mechanism DOES NOT EXIST: `paused` is merely a value allowed by the member_subscriptions
// CHECK, nothing ever writes it (the freeze is GYM-190, never shipped), and no code path
// halts SEPA debits. The article therefore states the RESULT owed to the member — they do
// not pay for a period in which they cannot attend — and leaves the Club the choice of
// means. Implementation may be manual. Exit threshold: 30 consecutive days, not two months.
import { LEGAL_VERSION, LEGAL_UPDATED_AT } from './meta'

export const cguEn = `# Terms & Conditions

**Last updated: ${LEGAL_UPDATED_AT}** · Version ${LEGAL_VERSION}

## Preamble — two contracts, one document

This document brings together **two distinct contracts**, and it matters which one applies.

**Part A** governs your use of the {{app_name}} application, published by **Nexxia** — Antoine Monie, a Belgian sole trader, BCE BE 1024.997.119, Rue Grande Bruyère 6 B1, 4840 Welkenraedt ("the Publisher"). That contract binds you to the Publisher.

**Part B** governs your purchases of services from **{{club_name}}**{{club_commune}} ("the Club"), the seller of the services. That contract binds you to the Club. The Publisher is not a party to it: it acts as technical provider and processor for the Club. Payments are processed by **Mollie B.V.** on behalf of the Club.

The **Common provisions** apply to both contracts. The **Appendix** reproduces the withdrawal form.

Where a clause of Part A conflicts with a clause of Part B, the one governing the contract at issue prevails.

## Part A — Your use of the application

### A1. Purpose and identification of the Publisher

A1.1. Part A governs the provision of the {{app_name}} application and its use by the member. Access to the application is not charged to the member.

A1.2. Publisher: **Nexxia** — Antoine Monie, a Belgian sole trader, BCE BE 1024.997.119, Rue Grande Bruyère 6 B1, 4840 Welkenraedt. Contact: support@viniz.app.

### A2. Member account

A2.1. An account is required to book. The member warrants the accuracy of their information and the confidentiality of their credentials.

A2.2. Account deletion is available at any time in the application (Profile): personal data is anonymised, transactional data is retained in accordance with accounting obligations (see the Privacy Policy). Deletion is possible at the end of any ongoing subscription (art. B9).

### A3. Minors

A3.1. Registration is open to persons **aged 16 and over**. This threshold is the Publisher's own choice and **not a legal requirement**: in Belgium, the age at which a minor may consent alone to the processing of their data in the context of information society services is 13.

A3.2. A minor under 16 may only be registered with the consent of their legal representative and the agreement of the Club, subject to the Club's own conditions.

A3.3. In that case, **the legal representative is the party to the contract**, in Part A as in Part B. They accept these terms, they hold the resulting rights and obligations, and they are **solely liable for the sums due** in respect of purchases made from the account. The minor is the user of the service; they are not the purchaser.

### A4. Service availability and the Publisher's liability

A4.1. The Publisher uses reasonable means to ensure the availability, continuity and security of the application. In this respect it is bound by a **best-efforts obligation**.

A4.2. The application may be temporarily unavailable for maintenance or updates, or as a result of a third party on which the Publisher depends (hosting, payment provider, notification service, app store, the device's network). Where an interruption is scheduled and of significant duration, the Publisher informs members.

A4.3. **The Publisher is not a party to the contract of sale.** It provides no sporting services, sets neither prices, nor schedules, nor class capacity, nor the internal rules, and answers neither for their performance nor for safety on the Club's premises. Those obligations rest exclusively with the Club (Part B).

A4.4. The Publisher's liability towards the member is limited to **direct damage** resulting from its own fault. This limitation does **not** apply in any case of fraud, gross negligence, harm to life or physical integrity, or in any case where the law prohibits it.

A4.5. No clause of this Part reduces the rights the consumer member holds under mandatory provisions, in particular Book VI of the Code of Economic Law.

### A5. Personal data

The processing of data is described in the Privacy Policy, accessible in the application (Profile → Privacy) and at viniz.app/legal/privacy. Data controller: the Club. Main processor: Nexxia (Viniz platform); other processors: Supabase, Mollie, Resend, Vercel, PostHog, Sentry, Expo/Apple.

## Part B — Your purchases from the Club

### B1. Purpose and identification of the Club

B1.1. Part B governs the purchase of services from the Club and their performance. It binds the member to the Club, **the seller of the services**.

B1.2. Seller: **{{club_name}}**{{club_commune}}, whose full identity (legal name, company number, registered office) and contact details are displayed in the application, on the Club information screen.

B1.3. Payments are processed by **Mollie B.V.** on behalf of the Club. The Publisher does not collect the price of the services.

### B2. Plans and prices

B2.1. Two types of plans, at the prices in euros incl. VAT shown in the application: **per-session** (Drop-in, passes — credit sessions) and **subscriptions** (unlimited access for the chosen duration, monthly instalments by SEPA direct debit).

B2.2. **Purchased sessions have no expiry date.** Any future change to this rule will never apply to sessions already purchased.

B2.3. Credits and passes are freely cumulative. Only one active subscription at a time. During an active subscription, per-session purchase is unavailable (access is already unlimited); credits held are kept and become usable again when the subscription ends.

B2.4. The applicable prices are those displayed at the time of purchase. The terms of an ongoing subscription are never modified.

### B3. Payment

B3.1. Payments are processed via Mollie. Per-session purchases: immediate payment by the means offered on the payment screen (notably Bancontact and card). Subscriptions: the first payment establishes a SEPA direct debit mandate, subsequent instalments are collected automatically.

B3.2. In the event of a failed monthly direct debit not regularised after the member has been informed, the Club may suspend access to bookings until regularisation, without prejudice to the amounts due.

### B4. Right of withdrawal

B4.1. A consumer member purchasing at a distance is in principle entitled to a **14-day** period in which to withdraw without giving a reason, in accordance with Articles VI.47 et seq. of the Code of Economic Law. The period runs from the conclusion of the contract.

B4.2. **Sessions booked for a specific date: no right of withdrawal.** Article **VI.53, 12° of the Code of Economic Law** excludes from the right of withdrawal contracts for services related to leisure activities where the contract provides for a specific date or period of performance. Booking a class on a given date and time falls within that exclusion. It remains cancellable under Article B7, which is more favourable to the member.

B4.3. **Unused credits and subscriptions: the right applies.** The purchase of credits not yet allocated to a class, and the taking out of a subscription, remain subject to withdrawal during the 14-day period.

B4.4. **Effect of withdrawal.** For credits, the refund covers **unused credits**; a credit allocated to a class booked for a specific date falls within the exclusion in Article B4.2. For a subscription, the refund is **in full**, unless the member expressly requested that access begin before the end of the withdrawal period: in that case alone, the value of the elapsed period is deducted pro rata to the total duration (art. VI.51 CEL). The right of withdrawal is lost through full performance of the service only where that performance took place with the member's prior express consent and their acknowledgement that the right would be lost (art. VI.53, 1° CEL).

B4.5. **Exercising the right.** The member informs the Club of their decision by an unambiguous statement, by email to the Club's contact address shown in the application, or via support@viniz.app which will forward it to the Club. They may use the form reproduced in the **appendix** to this document; its use is not mandatory.

B4.6. **Refund deadline.** The Club refunds the sums due **no later than 14 days** after being informed of the withdrawal decision, using the same means of payment as that used for the purchase, at no cost to the member (art. VI.50 CEL).

### B5. Bookings

B5.1. Booking — including joining a waitlist — requires an active subscription or at least one available session.

B5.2. {{booking_limit_clause}}

B5.3. A session is only debited upon **confirmation** of the spot (never on a waitlist; never under a subscription).

B5.4. Each class has a maximum capacity; class full → waitlist registration possible.

### B6. Waitlist

B6.1. The order of the list is the order of registration.

B6.2. When a spot frees up, the first person on the list is notified (notification and email) and has a **{{waitlist_confirmation_minutes}} window** — shown in the application — to confirm their spot (the session is debited on confirmation, except under a subscription).

B6.3. Failing confirmation within the window, the waitlist registration expires and the spot is offered to the next person. The member may re-register on the waitlist.

### B7. Cancellation by the member

B7.1. **Free up to 2 hours before** the start of the class: the session is immediately re-credited (nothing to re-credit under a subscription).

B7.2. **Less than 2 hours before**: the cancellation is treated as an unexcused absence (art. B8) — no re-credit, scale B8.2 applies.

B7.3. Withdrawing from a waitlist is free and without consequence.

### B8. Unexcused absences ("no-show")

B8.1. An unexcused absence is a confirmed member who does not attend without having cancelled.

B8.2. {{noshow_scale_clause}}

B8.3. The session is not re-credited. {{counter_reset_clause}}

### B9. Subscriptions — duration, term, termination

B9.1. The subscription is concluded for the chosen duration, paid by SEPA monthly instalments. It ends automatically at its term, **with no tacit renewal**: no debit occurs beyond the term.

B9.2. The subscription constitutes a **firm commitment for the chosen duration**: it cannot be terminated early and the instalments remain due until the term, without prejudice to the right of withdrawal (art. B4) and to the early-exit cases in Article B9.3. The application displays the commitment end date.

B9.3. **Early-exit cases.** By way of exception to Article B9.2, the subscription ends before its term, with no indemnity, in the following cases:

- **death of the member**;
- **lasting medical incapacity** making practice impossible, established by a medical certificate sent directly to the Club, outside the application;
- **relocation** making access to the Club's premises manifestly impracticable, on supporting evidence;
- **permanent closure of the Club** or lasting cessation of its activity (art. C1);
- **refusal of a change** to these terms (art. C2);
- any other **legitimate ground** recognised by law or accepted by the Club.

B9.4. The request is addressed to the Club together with its supporting evidence; the Club responds under the conditions of Article C3. Instalments falling due before the end of the subscription remain payable; sums paid in advance for the subsequent period are refunded pro rata within **14 days**.

B9.5. During the subscription, per-session credits held are kept but unused (art. B2.3).

### B10. Refunds

B10.1. The re-crediting of sessions operates under Articles B6 and B7.

B10.2. If a class is cancelled by the Club, the debited session is automatically re-credited. Any other monetary refund, outside the right of withdrawal, is at the Club's discretion, without prejudice to the consumer's legal rights.

### B11. Conduct, safety and health

B11.1. The member complies with the Club's internal rules, displayed on its premises and/or in the application.

B11.2. The practice of intensive physical activities requires suitable physical condition: the member declares having no known medical contraindication. If the Club requires a medical certificate for certain activities, it must be provided before participation. Information relating to the Club's insurance is available on request from the Club.

## Common provisions

### C1. Force majeure

C1.1. Neither party answers for the non-performance of its obligations where that non-performance results from an event of force majeure — unforeseeable, insurmountable and beyond its control: notably administrative closure, epidemic, damage affecting the premises, natural disaster, or a lasting failure of an indispensable third-party network or service.

C1.2. The party prevented informs the other as soon as possible and does what is reasonably within its power to limit the effects.

C1.3. **Purchased sessions.** If classes cannot be held for this reason, debited sessions are **re-credited**.

C1.4. **Subscriptions.** The member **does not bear the cost of a period during which the impediment deprives them of access**. The Club accounts for this, at its choice, either by **extending the subscription at no extra charge** for an equivalent duration or by **refunding** the corresponding portion, and informs the member of the option chosen. If the impediment lasts more than **30 consecutive days**, either party may bring the subscription to an end; sums paid in advance for the subsequent period are then refunded within **14 days**.

C1.5. Force majeure does not excuse payment of any sum already due before it arose, without prejudice to Article C1.4.

### C2. Changes to these terms

C2.1. Any change is brought to the members' attention via the application at least **30 days** before it takes effect. Changes to Part A are made by the Publisher; changes to Part B are made by the Club.

C2.2. A change **never applies retroactively** to purchases already made: the terms of an ongoing subscription or of credits held remain those in force at the time of purchase.

C2.3. **The member may refuse the change.** Refusal is expressed by any means to its author, before the date it takes effect. As of that date, it entails:

- for Part A, the closure of the account;
- for Part B, the end of the ongoing subscription with no indemnity (art. B9.3), sums paid in advance for the subsequent period being refunded pro rata within **14 days**.

C2.4. Silence maintained until the date the change takes effect, or use of the service after that date, constitutes acceptance of the change.

### C3. Complaints

C3.1. **Who to contact.** A complaint concerning a service, a price, a payment, a booking or the running of a class is addressed to the **Club**, at the contact address shown in the application. A complaint concerning the operation of the application is addressed to the **Publisher**, at support@viniz.app. Where the addressee is unclear, the member may write to support@viniz.app, which forwards to the Club where appropriate.

C3.2. **Form.** The complaint is made in writing and states the account concerned, the date and subject of the facts, and the member's request.

C3.3. **Time limits.** The addressee acknowledges receipt within **7 days** and provides a reasoned response within **30 days** of receipt. If the examination requires longer, the member is informed before that period expires, with an indication of the additional time needed.

C3.4. **Recourse.** The absence of a response within those time limits, or an unsatisfactory response, opens the avenues of recourse in Article C5. This Article is **not a mandatory precondition**: it deprives the member of no direct remedy.

### C4. Severability and no waiver

C4.1. **Severability.** If a clause of these terms is held void, of no effect or unenforceable — in particular because it would be unfair within the meaning of Book VI of the Code of Economic Law — it is deemed unwritten and **the other clauses remain in force**. It is replaced, so far as possible, by a valid clause pursuing the same purpose; failing that, the applicable statutory rule applies instead.

C4.2. **No waiver.** The failure of the Publisher or of the Club to rely on a clause, or its tolerance of a breach, does not amount to a waiver of the right to rely on it later. A waiver is enforceable only if written and express, and applies only to the case concerned.

C4.3. No stipulation of these terms deprives the consumer member of the rights they hold under mandatory provisions.

### C5. Governing law and disputes

These terms are governed by Belgian law. After following, should they wish, the complaints procedure in Article C3, the member may use the Consumer Mediation Service (mediationconsommateur.be). Failing an amicable resolution, jurisdiction is determined by the applicable statutory rules, including the consumer-protection rules which allow the member to bring proceedings before the court of their own domicile.

## Appendix — Withdrawal form

_To be completed and returned only if you wish to withdraw from the contract. Its use is not mandatory: any unambiguous statement suffices (art. B4.5)._

To **{{club_name}}**{{club_commune}}, whose postal address and email address are shown in the application, on the Club information screen:

I hereby give notice of my withdrawal from the contract for the supply of the service below.

- Service ordered:
- Ordered on:
- Name of the consumer:
- Address of the consumer:
- Date:
- Signature of the consumer (only if this form is notified on paper):
`
