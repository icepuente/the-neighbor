# the-neighbor

A small, self-hosted booking site for a mobile bike repair service. Customers pick a service, a day and a two-hour slot, then enter their bike and address details. You manage everything from a password-protected admin page, and both sides get email at each step.

It's one Node process with a SQLite file. There's no frontend build step, no external database and no third-party booking service. All business details (name, prices, opening hours, FAQ) live in one JSON file.

Running at **[book.icepuente.com](https://book.icepuente.com)** as "Spoke & Go".

## Features

### For customers

- Book a service, date and time slot. The calendar only shows open days and free slots.
- Get a confirmation email straight away, with a link to a private booking page (`/b/<token>`).
- From that page, check the booking's status, message the mechanic, or cancel.

### For the owner (`/admin`)

- See every booking, filter and search them, and confirm, complete, cancel or reschedule it.
- Keep private notes on a booking.
- Email a customer from the dashboard using reusable templates ("On my way", "Running late", …).
- Block off whole days (holidays, sick days).
- Export bookings as CSV.
- Get an email for every new booking, customer message and cancellation. Replying to the email reaches the customer directly.
- Confirmation emails include a calendar invite (`.ics`).

### Under the hood

- Bookings start as `pending` until confirmed, or set `autoConfirm` to skip that step.
- Slot capacity is enforced, so a slot can't be double-booked.
- Booking, messaging and login endpoints are rate-limited. Responses have security headers via Helmet, and the admin session cookie is signed.
- Booking pages and the admin page are marked `noindex` and excluded in `robots.txt`.

## Stack

- Node.js 20+ (22 in Docker), Express 5
- SQLite via `better-sqlite3` (WAL mode)
- Nodemailer for SMTP
- Plain HTML, CSS and JavaScript in `public/`, no bundler
- Docker Compose, plus an optional Cloudflare Tunnel for public access

## Quick start

```bash
npm install
npm run dev:express
```

(`npm run dev` now starts The Neighbor on the Firebase emulators; see `docs/firebase-plan.md`.)

Open http://localhost:3000 for the site and http://localhost:3000/admin for the dashboard. The admin password is `admin` in development.

If `SMTP_HOST` isn't set, emails are printed to the console instead of being sent, so you can test the whole flow without a mail server. Data is stored in `data/bookings.db`, which is created automatically.

## Configuration

### Business settings: `config/site.json`

Everything specific to the business is in [`config/site.json`](config/site.json):

| Key | What it controls |
|---|---|
| `businessName`, `tagline`, `description`, `serviceArea` | Text shown on the site and in emails |
| `contactEmail`, `contactPhone` | Public contact details (the email falls back to `OWNER_EMAIL`) |
| `refPrefix` | Prefix for booking references, e.g. `SG-…` |
| `timezone`, `locale`, `currency`, `currencyLocale` | Date, time and price formatting |
| `services` | Services offered: `id`, `name`, `price`, `duration`, `description` |
| `slots`, `openDays`, `slotCapacity` | Time slots, open weekdays (0 = Sunday) and bookings allowed per slot |
| `minLeadDays`, `bookingWindowDays` | How soon, and how far ahead, customers can book |
| `autoConfirm` | Skip the `pending` state |
| `postcodePattern`, `postcodeHint` | Postcode validation (a regex) and the hint shown with it |
| `highlights`, `bikeTypes`, `faq` | Content shown on the landing page and booking form |
| `messageTemplates` | Admin email templates. Supports `{firstName}`, `{date}`, `{time}`, `{ref}`, `{price}` and `{service}` |

Set `SITE_CONFIG=/path/to/site.json` to load the file from somewhere else.

### Environment variables

Copy [`.env.example`](.env.example) to `.env`:

| Variable | Required in production | Notes |
|---|---|---|
| `PUBLIC_URL` | yes* | Base URL used in email links. With `https://`, cookies are marked secure and HSTS is turned on |
| `ADMIN_PASSWORD` | **yes** | Admin login, e.g. from `openssl rand -base64 18` |
| `SESSION_SECRET` | **yes** | Signs the admin session cookie, e.g. from `openssl rand -hex 32`. Changing it signs every admin out |
| `OWNER_EMAIL` | recommended | Where notifications are sent, and the Reply-To address on customer emails |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | for email | Any SMTP provider. Gmail works with an app password |
| `MAIL_FROM_ADDRESS` | no | Sender address. Defaults to `SMTP_USER` |
| `PORT` | no | Defaults to `3000` |
| `DATA_DIR` | no | Where `bookings.db` is stored. Defaults to `./data` |

\* Defaults to `http://localhost:PORT`, which won't work in emails sent from a real deployment.

When `NODE_ENV=production`, the server won't start if `ADMIN_PASSWORD` or `SESSION_SECRET` is missing.

## Deployment

The included `docker-compose.yml` runs two containers:

- **`app`**: the Node server, listening on `127.0.0.1:3000` only. `./data` holds the database, and `./config` is mounted read-only, so editing `site.json` only needs `docker compose restart app`.
- **`cloudflared`**: a Cloudflare Tunnel that makes the site public without opening any router ports.

```bash
cp .env.example .env              # then fill in the secrets
mkdir -p data cloudflared
# Create a tunnel with `cloudflared tunnel create <name>`, then put its
# credentials and a config.yml (see cloudflared.example.yml) in ./cloudflared
docker compose up -d --build
```

Not using Cloudflare? Remove the `cloudflared` service and put any reverse proxy (Caddy, nginx, Traefik) in front of port 3000. The app trusts `X-Forwarded-*` headers from loopback and private-network addresses.

Other tools included:

- [`deploy.sh`](deploy.sh) copies the project to a server with rsync and rebuilds it there: `./deploy.sh user@host`.
- [`scripts/backup.sh`](scripts/backup.sh) is a nightly SQLite backup for cron. It keeps 30 days of gzipped backups.
- `GET /healthz` is the health check used by Docker.

The production setup and runbook for book.icepuente.com are in [`docs/operations.md`](docs/operations.md).

## Project layout

```text
server.js            Express app: pages, static files, security headers
config/site.json     Business settings
src/
  config.js          Loads env vars and site.json
  db.js              SQLite schema and setup
  bookings.js        Creating, updating and querying bookings
  schedule.js        Availability: open days, slots, capacity, closed dates
  emails.js          Email templates
  mailer.js          SMTP transport (or console output in development)
  notify.js          Which emails go out on which events
  ics.js             Calendar invites
  http.js            Rate limiting and request helpers
  routes/public.js   /api: config, availability, bookings, messages, cancellation
  routes/admin.js    /api/admin: login, booking management, closed dates, CSV export
public/              Landing page, booking page, admin page, privacy page, JS, CSS
```

## API

Public endpoints:

| Method | Path | |
|---|---|---|
| `GET` | `/api/config` | Public site config |
| `GET` | `/api/availability` | Open dates and free slots |
| `POST` | `/api/bookings` | Create a booking (10 per hour per IP) |
| `GET` | `/api/bookings/:token` | View a booking |
| `POST` | `/api/bookings/:token/messages` | Message the owner |
| `POST` | `/api/bookings/:token/cancel` | Cancel |

Admin endpoints are under `/api/admin/*` and need a signed-in session. Login is limited to 10 attempts per 15 minutes.
