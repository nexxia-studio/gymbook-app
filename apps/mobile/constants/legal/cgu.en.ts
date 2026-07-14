// Terms & Conditions of Sale — v1 PUBLISHABLE.
// Source of truth: docs/legal/cgv-v1.md (publishable body ONLY; the source's internal
// appendices are NEVER reproduced here).
// The Club identity (art. 1) is interpolated from CLUB_IDENTITY, never hardcoded.
// Faithful translation of the frozen FR text — same article structure. Each "N.x"
// sub-clause is blank-line separated (the MarkdownText renderer merges contiguous lines).
import { LEGAL_VERSION, LEGAL_UPDATED_AT } from './meta'
import { CLUB_IDENTITY } from '../club'

export const cguEn = `# Terms & Conditions

**Last updated: ${LEGAL_UPDATED_AT}** · Version ${LEGAL_VERSION}

### 1. Identification and purpose

These terms govern the use of the Dopamine application and the purchase of services from **${CLUB_IDENTITY.name}**, ${CLUB_IDENTITY.commune} ("the Club"), the seller of the services, whose full identity (legal name, company number, registered office) is displayed in the application, on the Club information screen. The application is published by **Nexxia** — Antoine Monie, a Belgian sole trader, BCE BE 1024.997.119, Rue Grande Bruyère 6 B1, 4840 Welkenraedt ("the Publisher"), technical provider and processor for the Club. Payments are processed by **Mollie B.V.** on behalf of the Club.

### 2. Member account

2.1. An account is required to book. The member warrants the accuracy of their information and the confidentiality of their credentials.

2.2. Registration is open to persons **aged 16 and over**. Minors under 16 may only register with the consent of their legal representative and the agreement of the Club, subject to the Club's own conditions.

2.3. Account deletion is available at any time in the application (Profile): personal data is anonymised, transactional data is retained in accordance with accounting obligations (see the Privacy Policy). Deletion is possible at the end of any ongoing subscription (art. 10).

### 3. Plans and prices

3.1. Two types of plans, at the prices in euros incl. VAT shown in the application: **per-session** (Drop-in, passes — credit sessions) and **subscriptions** (unlimited access for the chosen duration, monthly instalments by SEPA direct debit).

3.2. **Purchased sessions have no expiry date.** Any future change to this rule will never apply to sessions already purchased.

3.3. Credits and passes are freely cumulative. Only one active subscription at a time. During an active subscription, per-session purchase is unavailable (access is already unlimited); credits held are kept and become usable again when the subscription ends.

3.4. The applicable prices are those displayed at the time of purchase. The terms of an ongoing subscription are never modified.

### 4. Payment

4.1. Payments are processed via Mollie. Per-session purchases: immediate payment by the means offered on the payment screen (notably Bancontact and card). Subscriptions: the first payment establishes a SEPA direct debit mandate, subsequent instalments are collected automatically.

4.2. In the event of a failed monthly direct debit not regularised after the member has been informed, the Club may suspend access to bookings until regularisation, without prejudice to the amounts due.

### 5. Right of withdrawal

5.1. In accordance with Articles VI.47 et seq. of the Code of Economic Law, the consumer member has a period of **14 days** from the distance purchase to withdraw without giving a reason.

5.2. By purchasing, the member expressly requests that the service begin before the expiry of this period. In the event of withdrawal within the period: sessions already used are deducted pro rata from the price paid; for a subscription already started, the refund is reduced by the value of the elapsed period. The right of withdrawal is lost if the service has been fully performed before the end of the period (art. VI.53, 1° CEL).

5.3. The right is exercised by email to the Club's contact address shown in the application, or via support@viniz.app which will forward it to the Club, where applicable using the legal withdrawal form.

### 6. Bookings

6.1. Booking — including joining a waitlist — requires an active subscription or at least one available session.

6.2. Maximum **2 confirmed upcoming bookings** at a time.

6.3. A session is only debited upon **confirmation** of the spot (never on a waitlist; never under a subscription).

6.4. Each class has a maximum capacity; class full → waitlist registration possible.

### 7. Waitlist

7.1. The order of the list is the order of registration.

7.2. When a spot frees up, the first person on the list is notified (notification and email) and has a **30-minute window** — shown in the application — to confirm their spot (the session is debited on confirmation, except under a subscription).

7.3. Failing confirmation within the window, the waitlist registration expires and the spot is offered to the next person. The member may re-register on the waitlist.

### 8. Cancellation by the member

8.1. **Free up to 2 hours before** the start of the class: the session is immediately re-credited (nothing to re-credit under a subscription).

8.2. **Less than 2 hours before**: the cancellation is treated as an unexcused absence (art. 9) — no re-credit, scale 9.2 applies.

8.3. Withdrawing from a waitlist is free and without consequence.

### 9. Unexcused absences ("no-show")

9.1. An unexcused absence is a confirmed member who does not attend without having cancelled.

9.2. Automatic cumulative scale: **1st absence** = warning · **2nd** = booking suspension for **48 hours** · **3rd and beyond** = suspension for **2 weeks**.

9.3. The session is not re-credited. The absence counter is cumulative; the Club may reset it at its discretion.

### 10. Subscriptions — duration, term, termination

10.1. The subscription is concluded for the chosen duration, paid by SEPA monthly instalments. It ends automatically at its term, **with no tacit renewal**: no debit occurs beyond the term.

10.2. The subscription constitutes a **firm commitment for the chosen duration**: it cannot be terminated early and the instalments remain due until the term, without prejudice to the right of withdrawal (art. 5) and the legitimate-grounds cases provided by law. The application displays the commitment end date.

10.3. During the subscription, per-session credits held are kept but unused (art. 3.3).

### 11. Refunds

11.1. The re-crediting of sessions operates under Articles 7 and 8.

11.2. If a class is cancelled by the Club, the debited session is automatically re-credited. Any other monetary refund, outside the right of withdrawal, is at the Club's discretion, without prejudice to the consumer's legal rights.

### 12. Conduct, safety and health

12.1. The member complies with the Club's internal rules, displayed on its premises and/or in the application.

12.2. The practice of intensive physical activities requires suitable physical condition: the member declares having no known medical contraindication. If the Club requires a medical certificate for certain activities, it must be provided before participation. Information relating to the Club's insurance is available on request from the Club.

### 13. Personal data

The processing of data is described in the Privacy Policy, accessible in the application (Profile → Privacy) and at viniz.app/legal/privacy. Data controller: the Club. Main processor: Nexxia (Viniz platform); other processors: Supabase, Mollie, Resend, Expo/Apple.

### 14. Changes

Any change to these terms is brought to the members' attention via the application at least **30 days** before it takes effect. It never applies retroactively to purchases already made.

### 15. Governing law and disputes

These terms are governed by Belgian law. In the event of a dispute, the member may use the Consumer Mediation Service (mediationconsommateur.be) or the European online dispute resolution platform (ec.europa.eu/odr). Failing an amicable resolution, the courts of the district of **Liège** have jurisdiction, without prejudice to the mandatory rules of jurisdiction.
`
