# Operations: book.icepuente.com

Booking website for a mobile bike service. Customers pick a service, a day and a two-hour slot, and enter their details. They get an email straight away. You manage bookings and email customers from `/admin`.

**Live:** https://book.icepuente.com · **Admin:** https://book.icepuente.com/admin

## How it works

- **Customers** book on `/`. Each booking gets a private page (`/b/<token>`, linked in every email) where they can see its status, message you, or cancel.
- **You** get an email for every new booking, customer message and cancellation. Reply to a notification email to answer the customer directly from Gmail.
- **Admin** (`/admin`): confirm, complete or cancel bookings, move them to a new time, keep private notes, block days off, export CSV, and email the customer using quick templates. Status changes can send the customer an email automatically, and confirmations include a calendar invite (.ics).
- Bookings start as **pending** until you confirm them. Set `"autoConfirm": true` in `config/site.json` to confirm them automatically.
- A slot holds `slotCapacity` active bookings (default 1). Customers can't double-book a slot.

## Customising

Everything business-specific is in [`config/site.json`](config/site.json): name, service area, services and prices, slots, opening days, booking window, FAQ, and admin message templates. On the server the file is mounted read-only into the container, so after editing it just restart:

```bash
ssh deploy@192.168.0.223 'cd /opt/bike-booking && docker compose restart app'
```

(Or edit it locally and run `./deploy.sh`.)

## Running locally

```bash
npm install
npm run dev
```

Without `SMTP_HOST`, emails are printed to the console. The admin password defaults to `admin` in development (see `.env.example`).

## Deployment

| | |
|---|---|
| Host | Proxmox LXC 114 `bike-booking`, `192.168.0.223` (Debian 13, Docker) |
| App dir | `/opt/bike-booking` (user `deploy`) |
| Containers | `app` (Node 22, port 3000 on localhost only) and `cloudflared` (tunnel) |
| Public access | Cloudflare Tunnel `bike-booking` → `book.icepuente.com`. No router ports opened. |
| Data | SQLite at `/opt/bike-booking/data/bookings.db` |
| Backups | Nightly at 03:15 to `/opt/bike-booking/backups` (30 days), plus the weekly Proxmox vzdump of CT 114 |
| Email | Gmail SMTP (`/opt/bike-booking/.env.smtp`) |
| Secrets | `/opt/bike-booking/.env` (`ADMIN_PASSWORD`, `SESSION_SECRET`), mode 600 |

Deploy changes:

```bash
./deploy.sh
```

Show the admin password:

```bash
ssh deploy@192.168.0.223 'grep ADMIN_PASSWORD /opt/bike-booking/.env'
```

Logs:

```bash
ssh deploy@192.168.0.223 'cd /opt/bike-booking && docker compose logs -f --tail 100'
```

To change the admin password, edit `ADMIN_PASSWORD` in `.env` and run `docker compose up -d app`. Changing `SESSION_SECRET` signs out every admin session.
