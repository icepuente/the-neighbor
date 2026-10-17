# Plan: The Neighbor on Firebase

Status: draft, 2026-10-12. Nothing in this plan has been built or paid for yet. A clickable mock of
the result lives in [`mock/`](../mock/) (see [The mock site](#the-mock-site)).

## 1. What the documents ask for

Three documents were provided:

| Document | What it is |
|---|---|
| `The_Neighbor_–_Bicycle_maintenance_for_businesses_and_private_customers.html` | The new public landing page, including a booking flow and a business consultation form |
| `The Neighbor – My account (preview).html` | A customer account area with sample data, for private and business customers |
| `Your first chat with Claude - Claude.pdf` | A print of an earlier version of the same landing page; no extra content |

Together they describe a new brand, **The Neighbor**, a one-person mobile bicycle mechanic based at
Rørsangervej 45, København, with two kinds of customer.

**Business customers** (hotels, hostels, rentals, offices, property managers, tourism companies,
municipalities) buy a per-bike monthly plan:

| Plan | Price | Includes |
|---|---|---|
| Basic | 250 DKK / bike / month | Initial checklist and fleet report (once, at contract start), preventive maintenance, basic safety inspection |
| Standard | 300 DKK / bike / month | Initial checklist and report, **monthly check-up and monthly service report**, preventive maintenance |
| Premium | 350 DKK / bike / month | Monthly check-up and report, priority service and reporting, discounted inner-tube repairs. **Max 35 bikes** |

Parts and repairs outside the plan are always extra, and the customer is told the price before any
extra work. Businesses start with a **consultation request** (name, company, email, phone, company
type, number of bikes, preferred date and time, message).

**Private customers** book a visit online:

| Service | Price |
|---|---|
| One-Time Bike Service | 199 DKK |
| Monthly Bike Check-Up | 79 DKK / month |
| Premium Monthly Check-Up | 99 DKK / month (adds priority booking) |
| Bike check-up | 269 DKK |
| Change tube | 149 DKK |
| Special repair | price by agreement; a problem description is required |

The one-off services above are replaced by the owner's own list (section 8, decision 11).

Pricing rules in the booking flow:

- Booking **two or more one-off services** together gives a **10% combo discount** on those services
  (changed by decision 13 in section 8).
- Monthly services are shown as a separate monthly amount.
- **Travel** costs **2.5 DKK per km** from the base, up to **18 km one way**, and is confirmed with the
  customer before the visit.
- Arrival times are **10:00–15:30 in 30-minute steps**, from today onward (replaced by decisions 3
  and 9 in section 8).
- A **consent popup** must be accepted first: data processing for the booking, and the company terms.

**The account area** shows:

- *Private customer:* overview (bikes, services this year, total spent), service **history** (work
  done, parts used, mechanic's notes, photos, itemised cost including travel), **my bikes** (frame,
  gears, brakes, tyres, usage, last service) and **recommendations** ("do soon" / "plan ahead", with
  a reason and a due date).
- *Business customer:* plan summary and next visit, a **monthly fleet report** (each bike *Ready*,
  *Attention* or *Repair needed*, with an action and the mechanic's note, selectable by month) and a
  **fleet list** grouped by location.

### The gap

Both HTML documents end with **"Send by email"**: the booking and the consultation are turned into a
`mailto:` link, so nothing is stored, nothing is validated server-side, and the account area runs on
hard-coded sample data. The backend has to supply:

1. Storing bookings and consultation requests, with confirmation emails. The booking form needs an
   **email field** for this; the document's form only asks for name, phone and address.
2. Customer accounts (sign-up, log-in, password reset) with two roles, plus an owner/admin role.
3. Per-customer records: bikes, service history with photos, recommendations.
4. Business companies, their fleets and monthly reports.
5. Tools for the owner to enter all of the above from a phone, on site.
6. Server-side price calculation (combo discount, travel by distance).
7. Consent records and GDPR basics (data in the EU, export and deletion).
8. Later: recurring billing for the monthly plans.

## 2. What exists today, and what carries over

The repo is the **Spoke & Go** booking site: one Express process with SQLite, an admin page, email
via SMTP, and a Cloudflare Tunnel to a Proxmox container. Relevant pieces:

| Today | Carries over? |
|---|---|
| `bookings`, `messages`, `closed_dates` tables (`src/db.js`) | The shape carries over to Firestore collections (see section 4) |
| Slot and capacity rules (`src/schedule.js`, `checkSlot`) | Logic ports into the booking Cloud Function |
| Email templates (`src/emails.js`) and notification rules (`src/notify.js`) | Port almost as-is into Functions |
| Calendar invites (`src/ics.js`) | Ports as-is |
| Private booking page `/b/<token>`, cancel and message | Becomes part of the account area; token links stay for guests |
| Admin page: status changes, reschedule, notes, templates, closed days, CSV | Becomes the owner dashboard, extended with service records, recommendations and fleet reports |
| `config/site.json` | Becomes a `config/site` document plus a `services` collection, editable without a deploy |
| Express server, SQLite file, Docker, Cloudflare Tunnel, `deploy.sh` | **Retired** once Firebase is live |

## 3. Target architecture

```text
Browser (static HTML/CSS/JS, no build step, as today)
  │  Firebase JS SDK
  ├── Firebase Authentication ── email + password, email verification, password reset
  ├── Cloud Firestore ────────── customers read their own data, enforced by security rules
  ├── Cloud Storage ──────────── photos: service records (owner), saved bikes and bookings
  │                               (customer); see decision 15
  └── Cloud Functions ────────── anything that must be trusted:
        quoteBooking             full price incl. travel (Maps Routes API), shown before confirming
        createBooking            validate, re-price, check time blocks, write booking, send emails
        createConsultation       store the lead, email the owner
        cancelBooking, message   the existing guest-token actions
        setRole / inviteCompany  admin-only: roles and business invites (custom claims)
        onServiceRecordCreated   email "your bike is done" with the summary
        monthly report job       scheduled; opens next month's report for Standard/Premium fleets
Firebase Hosting ─────────────── serves the site on the .dk domain (DNS stays on Cloudflare)
```

**Why Functions for writes.** Prices, capacity and travel must not be trusted from the browser.
Customers only ever *read* through security rules; every customer-side write goes through a Function.
The owner's dashboard writes directly, guarded by an `admin` custom claim.

**One codebase, two environments.** The site reads its Firebase settings from a small config file,
so the same files run against the production project on Firebase, or against the Firebase emulators
on Alec's Proxmox home server (phase 7, decision 6). Nothing in the code may depend on
Firebase Hosting specifically: rewrites and headers live in `firebase.json`, and the home server's
nginx config mirrors them. The demo build also turns on a "demo" banner and sends no real email.

**Region.** Firestore, Functions and Storage all in one EU region, e.g. `europe-west1` (Belgium) or
`europe-north1` (Finland). Keeping customer data in the EU covers the GDPR basics and matches the
privacy text the site already has.

**Email.** Port `src/mailer.js` (Nodemailer) into Functions with the same SMTP setup. The alternative
is Firebase's *Trigger Email* extension, but porting keeps the existing templates and tests. Sending
from an address on the new .dk domain needs SPF and DKIM records on Cloudflare.

## 4. Data model (Firestore)

```text
config/site                 businessName, base address, kmRate 2.5 (one way), maxKm 18,
                            comboOff 0.10, open Mon–Sat, hours 08:30–15:30 step 30, minLeadDays
services/{id}               name { da, en }, price | null, monthly: bool, durationMin,
                            description { da, en }, active, sort
plans/{basic|standard|premium}
                            pricePerBike, includes[], maxBikes (premium: 35), monthlyReport: bool

users/{uid}                 role: private | business | admin, name, email, phone, address,
                            companyId?, consent { data, terms, version, at }, createdAt
users/{uid}/bikes/{bikeId}  name, type, year, size, frame, gears, brakes, tyres, colour, usage,
                            photos[{ id, path, thumbPath, w, h, uploadedAt }] (max 4, first = cover)

companies/{companyId}       name, type, plan, pricePerBike, contact, address, memberUids[],
                            nextVisit, status: lead | active | ended
companies/{id}/bikes/{bikeId}
                            number "#001", type, location, year, size, gears, brakes
companies/{id}/reports/{yyyy-mm}
                            month, visitDate, counts { ready, attention, repair },
                            entries { bikeId: { status, action, note } }

bookings/{id}               ref "TN-1042", status pending | confirmed | completed | cancelled,
                            customerUid?, guestToken, services[{ id, name, price, monthly }],
                            date, arrival "10:30", bikeType | bikeId, address, distanceKm,
                            pricing { oneOff, discount, discountReason, monthly, travel, total },
                            urgent: bool, note, photos[{ id, path, thumbPath, w, h, uploadedAt }]
                            (max 3), consent { data, terms, version, at }, createdAt
bookings/{id}/messages/{id} direction in | out, body, emailStatus, createdAt  (as today)

serviceRecords/{id}         ownerUid | companyId, bikeId, bookingId?, date, title,
                            work[], parts[{ name, price }], notes, photos[storage paths],
                            cost { service, parts, travel, total }
recommendations/{id}        ownerUid | companyId, bikeId, title, urgency soon | later,
                            reason, dueBy, status open | done
consultations/{id}          name, company, email, phone, companyType, bikes, preferredDate,
                            preferredTime, message, status new | contacted | won | lost
subscriptions/{id}          customerUid | companyId, planOrService, price, bikes?, status, startDate
closedDates/{yyyy-mm-dd}    reason
```

**Money** is stored as whole kroner (integers), with discounts rounded when they are calculated, so
stored totals never carry floating-point remainders.

**Security rules, in short.** A private customer reads `users/{uid}` and its subcollections, and
`bookings`, `serviceRecords` and `recommendations` where `ownerUid == uid`. A business member reads
its company and its subcollections when `companyId` matches the custom claim. `admin` reads and
writes everything. No client writes to `bookings`, `consultations` or prices. Photo files in Cloud
Storage have their own rules (decision 15).

## 5. Site structure

| Page | Who | Built from |
|---|---|---|
| `/` landing, booking, consultation | everyone | landing-page document; "Send by email" is replaced by a real submit |
| `/account` | signed-in customers | account-preview document, plus **upcoming bookings** |
| `/b/<token>` | guests with a booking link | today's booking page, restyled |
| `/admin` | owner | today's admin page, plus the new tools below |
| `/privacy`, `/terms` | everyone | the footer's legal links, which today go nowhere |

New owner tools: consultation leads, companies and plans, fleet bikes, **log a visit** (work, parts,
notes, photos, recommendations, in one phone-friendly form) and **monthly fleet reports** (one row
per bike, a status in one tap).

## 6. Phases

Each phase ends with something usable, so it can stop at any point.

1. **Foundations.** Firebase project in the chosen EU region; Blaze plan with a budget alert; Hosting
   on a Firebase subdomain; the new design and content; consent popup; `createBooking` and
   `createConsultation` Functions with emails; **booking photos** (decision 15), including guest
   uploads through anonymous sign-in. Also a small proof of concept for the phase 7 demo:
   the emulators behind nginx and the tunnel, reached over HTTPS. *Result: the public site works end
   to end and stores everything.*
2. **Owner dashboard on Firebase.** Port today's admin features (statuses, reschedule, notes,
   messages, closed days, CSV) and add consultation leads.
3. **Private accounts.** Sign-up and log-in, linking past guest bookings by verified email; history,
   bikes (with **bike photos**, added and edited, decision 15) and recommendations; the owner's "log
   a visit" form with photo upload.
4. **Business accounts.** Invite-only company accounts, fleets, monthly reports, the scheduled report
   job, and a printable or PDF report.
5. **Go live on the .dk domain.** The Neighbor is hosted separately from the current server, on its
   own .dk domain: Cloudflare DNS with a TXT ownership record and an A record to the host (Firebase
   Hosting, per decision 6). book.icepuente.com gets no redirect. Then retire the Express app and
   SQLite. The home server's Cloudflare Tunnel stays, for the demo in phase 7.
6. **Billing (later).** Recurring payment for monthly plans, via Stripe (Firebase extension) or
   MobilePay Recurring, or by manual invoice until volume justifies it.
7. **Demo copy on the home server.** An example of the finished site, for demonstration, at
   **book.icepuente.com** on Alec's home server, running on the **Firebase emulators** (decision
   10), through the existing Cloudflare Tunnel. Sample data (Anna Jensen, Hotel ABC and so on) is
   loaded with `--import` and restored by a scheduled restart; no real customer data, no real email.
   It goes live after Spoke & Go is switched off, since it takes over that hostname.

   **Deployed through Jarvis.** Alec's Proxmox server is managed by **Jarvis**, an agent reached
   as an MCP server: a session asks Jarvis to create or update the container, and Jarvis carries
   it out on Proxmox. Jarvis is not reachable from the Windows machine yet (no MCP server and no
   `jarvis` SSH host configured there, as of 2026-10-13), so connecting to it is a setup step
   before phase 7.

   **Prove it early.** The emulators speak plain HTTP, while book.icepuente.com is HTTPS through
   Cloudflare, and browsers block HTTPS pages from calling HTTP addresses. The likely setup is one
   nginx in front: it serves the site and forwards each emulator's paths (Auth, Firestore,
   Functions, Storage each use distinct URL paths) on the same HTTPS hostname, with the site's
   Firebase settings pointed at that hostname over HTTPS instead of the emulator defaults. Each SDK's
   support for that (Storage especially) must be confirmed with a small proof of concept during
   phase 1, not discovered at the end.

## 7. Costs and accounts

- **Blaze plan required.** Cloud Functions and (since 3 February 2026) Cloud Storage only work on the
  pay-as-you-go Blaze plan, which needs a payment card. Blaze keeps the no-cost quotas (for example
  50,000 Firestore reads and 20,000 writes per day), so at this scale the bill should be close to zero.
  Set a budget alert on day one.
- **Google Maps** (decision 2): Routes API "Compute Routes Essentials" and Places Autocomplete each
  include **10,000 free requests a month**, then about $5 and $2.83 per 1,000 (Google's price list,
  updated 2026-10-08). At a one-person business's booking volume that is expected to be free. Using
  Maps APIs in the project switches it to Blaze automatically, which Functions need anyway.
- **Domain:** a .dk name from a Danish registrar (Cloudflare Registrar does not sell .dk), with DNS on
  Cloudflare.
- **Photos** (decision 15): about 300 KB per photo after shrinking, plus a small thumbnail, so 1,000
  photos take roughly 0.3 GB. Check that against Cloud Storage's no-cost quota when the project is
  created in phase 1. Anonymous sign-in for guests is part of the free Authentication options.

## 8. Decisions

Decided 2026-10-13 unless marked otherwise. Open items are at the end.

1. **Booking without an account: yes.** Guests can book, but must always give name, phone, email
   and address. The booking form has two options: **Remember me** (saves the contact details in
   this browser for next time) and **Create an account** (adds a password and creates the account
   with the booking). Earlier guest bookings join an account created later with the same email.
2. **Travel fee: exact driving distance.** 2.5 DKK per km, **one way**, from the base to the
   customer's address, using the Google Maps Routes API, with address autocomplete so the address
   is exact. The distance is calculated in a Cloud Function, so the Maps key stays private and the
   price cannot be altered in the browser. The customer sees the **full order total, travel
   included, before confirming** the booking. Addresses beyond 18 km are refused.
3. **Capacity: each job blocks its own length.** A booking blocks its service duration plus travel,
   so a long job cannot overlap the next booking (one mechanic). **A booking takes at most 45
   minutes of work, and travel comes on top** (decided 2026-10-13), however many services are
   chosen. Work time is the sum of the chosen services' times (decision 11), using the top of each
   range. If that sum is over 45 minutes the booking is refused, and the customer is asked to drop
   a service or book two visits. **15 minutes of travel** are left between jobs.
4. **Business accounts: invite-only at launch.** The owner creates the company account after the
   consultation and the contact gets an invite email. Self-service sign-up for businesses comes
   later.
5. **Payments: manual invoice at launch.** Online payment (Stripe, MobilePay or similar) is added
   later; the booking data keeps a payment status so that fits in without changes.
6. **Hosting: Firebase Hosting**, kept compatible with the Proxmox home server that Jarvis manages:
   the same site files must also run there behind nginx, against the emulators (see "One codebase"
   in section 3, and phase 7).
7. **Language: Danish and English, Danish by default.** All site text lives in one translation file
   per language, with a DA/EN switch in the header that remembers the visitor's choice. The Danish
   text should be proofread by a native speaker before launch. The owner's dashboard stays English
   for now.
8. **The live Spoke & Go site.** *Decided 2026-10-12:* The Neighbor replaces it in this repo, and is
   hosted elsewhere on its own .dk domain. There is **no redirect** from book.icepuente.com. Still
   open: when the old site is switched off, and whether any existing Spoke & Go bookings need to be
   carried over or simply finished on the old site. *Decided 2026-10-13:* existing Spoke & Go
   bookings finish on the old site; it is switched off when the demo is ready to take over
   book.icepuente.com.
9. **Opening days: Monday to Saturday, 08:30–15:30.** Closed on Sundays. The owner can still block
   single days. **15:30 is when all work must be finished**, so the last start time depends on the
   job: 14:30 for a 45-minute job (with 30-minute start steps).
10. **Demo on the home server (phase 7).** *Decided 2026-10-12:* the **Firebase emulators** on the
    home server (Java 11+, Node and the Firebase CLI, run in Docker alongside cloudflared), at
    **book.icepuente.com** once Spoke & Go is switched off. No cloud project or billing for the demo.
    Considered and not chosen: a separate demo Firebase project, and a browser-only demo like the
    mock. Open risk: the HTTPS proof of concept described in phase 7.
11. **Private services (owner's list, 2026-10-13).** Spare parts are not included.

    | Service | Price | Time | Includes |
    |---|---|---|---|
    | The Neighbor Bike Check | 199 DKK | ~20–25 min | Brake, gear, tyre, tyre pressure and chain checks; chain lubrication; main bolts; handlebar and saddle; quick safety check; recommendations for further repairs |
    | Puncture Fix | 199 DKK | ~15–20 min | The tube is included at no extra charge |
    | Brake Adjustment | 129 DKK | ~15 min | Brake adjustment, performance check, test. Parts sold separately |
    | Gear Adjustment | 129 DKK | ~15 min | Shifting adjustment, cable adjustment, test |
    | Chain Service | 149 DKK | ~15 min | Inspection, lubrication, basic adjustment |
    | Diagnostics | 299 DKK | ~15–20 min | Parts are charged separately |

    The calendar uses the top of each range (25, 20, 15, 15, 15, 20). Diagnostics needs a problem
    description, like the old special repair.
12. **Subscriptions (owner's terms, 2026-10-13).** They replace the documents' monthly check-ups.
    - **The Neighbor Care, 79 DKK / month:** one bike check-up a month (brake and gear inspection,
      tyre and pressure check, chain inspection and lubrication, basic adjustments, general safety
      check), at a time the customer chooses. Spare parts and major repairs are charged separately.
    - **Neighbor Care Plus, 99 DKK / month:** everything in Care, plus priority scheduling, one
      urgent appointment a month (for example a flat tyre: the owner aims to come the next day,
      subject to availability), and 5% off standard paid services.
    - **Minimum 3 months,** after which the customer can cancel at any time. The monthly check-up
      does **not roll over** if unused.
    - The idea: Care keeps a bike in good condition through regular maintenance; Care Plus adds
      priority and quick help when something urgent happens.

    Data: a subscription records its plan, start date and `commitmentEnds` (start + 3 months).
    Booking the monthly visit when the customer already has that subscription does not start a
    second one.
13. **Discounts (2026-10-13).** **Combo discount: 5%** of the whole order, but only when **The
    Neighbor Bike Check** is booked together with at least one other service; repairs booked
    without the Bike Check get no combo discount. **Care Plus: 5%** off one-off services, from the
    booking that starts the subscription onward. An order gets at most **one 5%**; the two do not
    stack. A repair added to the monthly Care check-up is **not** a combo: only the Bike Check
    triggers it.
14. **Lead time and the Care Plus urgent visit (2026-10-13).** Everyone books **at least 2 days
    ahead**. A signed-in **Care Plus** member may also book **tomorrow**, once per calendar month;
    that booking is marked urgent, and the owner's notification email and dashboard show it as
    urgent. A second urgent booking in the same month is refused; cancelling the urgent booking
    frees it again. Same-day bookings are not possible for anyone. Considered and not chosen:
    calendar times held back for Care Plus members, and arranging urgent visits only by phone. If
    tomorrow is closed (a Sunday or a blocked day), no urgent visit is offered for it.
15. **Bike photos (2026-10-17).** Customers can attach **up to 3 photos when booking** (optional:
    the bike, or the problem), and keep **up to 4 photos on each saved bike**, added when the bike
    is created or later by editing it; the first is the cover photo. The owner sees a booking's
    photos on the booking, and a bike's photos in "Log a visit" to recognise it on site. Backend
    design, to build in phase 1 (booking photos) and phase 3 (bike photos):
    - **Shrunk in the browser before upload.** The page redraws each photo on a canvas at most
      1600 px on its long side (the mock uses 800 px, because it keeps photos in the browser) and
      saves it as JPEG at about 80% quality, roughly 300 KB, plus a 320 px thumbnail for lists.
      Uploads stay fast on a phone, and redrawing **removes EXIF data, including GPS location**: a
      photo of a bike taken at home would otherwise carry the home's coordinates.
    - **Where files live (Cloud Storage):** `users/{uid}/bikes/{bikeId}/{photoId}.jpg` and
      `bookings/{bookingId}/{photoId}.jpg`, each with a `{photoId}_thumb.jpg`. Firestore keeps only
      the list `photos[{ id, path, thumbPath, w, h, uploadedAt }]` on the bike or booking.
    - **Guests.** Storage needs a signed-in user to accept an upload, and guests can book without an
      account. The booking page therefore signs a guest in with Firebase **Anonymous
      Authentication** (invisible to them) and uploads to `uploads/{uid}/{photoId}.jpg`.
      `createBooking` checks the files belong to the caller, moves them into the booking's folder
      and records them. If the guest then creates an account, the anonymous user is linked to it,
      so nothing is lost. Signed-in customers use the same route.
    - **Rules.** Customers may write only to their own `uploads/{uid}/` and
      `users/{uid}/bikes/...`, JPEG only, at most 2 MB per file. Photos can be read by the customer
      they belong to and by the owner (`admin`). Firestore rules cap a bike at 4 photos, and
      `createBooking` refuses more than 3.
    - **Clean-up.** A scheduled Function deletes uploads not attached to a booking within 24 hours.
      Removing a photo, deleting a bike or deleting an account deletes the files too (GDPR).
    - **Demo.** The Storage emulator covers this on the home server; it is the part already
      flagged as least certain in the phase 1 proof of concept.

### Still open

- **A. Booking photos and saved bikes.** When a signed-in customer books with one of their saved
  bikes, should the booking photos also be added to that bike? The mock keeps them on the booking
  only.
- **B. How long to keep booking photos** after the visit: for example 12 months, or as long as the
  booking is kept.
- **C. Business fleets.** Photos for fleet bikes too (added by the owner during fleet checks), or
  private customers only for now?
- *Done 2026-10-13:* the travel gap (15 minutes), the Diagnostics time and tube, the monthly plans,
  the combo discount, Care Plus scheduling (decision 14), a repair added to the Care check-up (no
  combo), and connecting the Windows PC to Jarvis.

## The mock site

[`mock/`](../mock/) is a static, clickable version of the finished site. It has no Firebase and no
server: a small fake backend (`mock/js/mock-backend.js`) stores data in the browser's `localStorage`
using the collections in section 4, so a booking made on the landing page shows up in the account
area and the owner dashboard. Open `mock/index.html` directly in a browser. Sample data comes from
the account-preview document (Anna Jensen and Hotel ABC). A "Reset demo data" link restores it.

The mock follows the 2026-10-13 decisions: Danish by default with a DA/EN switch, open Monday to
Saturday with work finished by 15:30, bookings of at most 45 minutes that block their time plus a
travel gap, "Remember me" and "Create an account" on the booking form, and the full price with
travel shown before confirming. It also has the owner's six services with their prices and times,
the two Care subscriptions with their terms, the 5% combo and Care Plus discounts, the 2-day lead
time with Care Plus's next-day urgent visit (the demo customer Anna has Care Plus), bike photos on
bookings and saved bikes (decision 15; photos are kept in the browser, so its storage can fill up
after many photos, and "Reset demo data" clears it), and refuses a
booking whose services add up to more than 45 minutes. One stand-in remains: travel is estimated
from the postcode instead of Google Maps (the price page says so). The owner dashboard is English
only.
