# Operations: theneighbor.dk

The site is static: nginx on Alec's home server serves `web/`, and a Cloudflare Tunnel makes it
public at **theneighbor.dk** (www redirects to it). There is no database, no backend and nothing to
back up on the server (the repo is the source of truth). Moving it to Cloudflare Pages is a few
steps, below.

| What | Where |
|---|---|
| Domain | `theneighbor.dk`, owned by the business; registrar Domænehajen, registry Punktum dk |
| DNS | Cloudflare, Alec's account (the account that holds the tunnel) |
| Server | Proxmox LXC 114 (`192.168.0.223`), managed through Jarvis; SSH as `deploy` |
| Folder | `/opt/the-neighbor-demo` (the name is from the demo days; owned by `deploy`) |
| Containers | Docker compose project `the-neighbor-demo`: `nginx` (port 8088 on localhost only) and `cloudflared` |
| Tunnel | the existing tunnel `bike-booking` (id `7535fdd6-…`); config in [`deploy/cloudflared-config.yml`](../deploy/cloudflared-config.yml), credentials in `cloudflared/` on the server only |
| nginx | [`deploy/nginx/default.conf`](../deploy/nginx/default.conf) (GET only, no access log, www redirect) and [`headers.inc`](../deploy/nginx/headers.inc) (the security headers, shared with the local server and the Pages build) |

## Deploy

```bash
npm run deploy        # scripts/deploy.sh: sends web/ and deploy/, restarts what changed, checks the page
npm run test:live     # the booking in headless Chrome against https://theneighbor.dk/
```

The deploy refuses to run while `CONFIG.contact.email` is an `example.com` placeholder.

Each deploy serves scripts, styles and fonts from a new path, `/r/<commit>/...` (the deploy rewrites
the pages' links and nginx maps the path back), because Cloudflare keeps JS and CSS in browsers for
4 hours. Pages themselves are never cached.

**Never delete or recreate `web/` or `deploy/nginx/` on the server**: nginx has them mounted, and a
recreated folder leaves it attached to the deleted one (no site, or no config). The deploy empties
them in place.

**The tunnel config** is not copied by the deploy (the server's `cloudflared/config.yml` lives
next to its credentials). After changing `deploy/cloudflared-config.yml`, copy it over and restart:

```bash
scp deploy/cloudflared-config.yml deploy@192.168.0.223:/opt/the-neighbor-demo/cloudflared/config.yml
ssh deploy@192.168.0.223 'cd /opt/the-neighbor-demo && docker compose --profile public restart cloudflared'
```

## DNS (Cloudflare)

| Type | Name | Target | Proxy |
|---|---|---|---|
| CNAME | `theneighbor.dk` (`@`) | `7535fdd6-afd8-4e55-9048-0ffd003888e7.cfargotunnel.com` | proxied |
| CNAME | `www` | `7535fdd6-afd8-4e55-9048-0ffd003888e7.cfargotunnel.com` | proxied |

The domain's nameservers (set at Punktum dk or through Domænehajen) are the two Cloudflare gave
when the zone was added. HTTPS comes from Cloudflare's certificate for the zone; the tunnel carries
the traffic to nginx, so no certificate is needed on the server. Email for the domain, if the business wants `@theneighbor.dk` addresses later, needs MX
records here too.

## Check and logs

```bash
ssh deploy@192.168.0.223 'cd /opt/the-neighbor-demo && docker compose --profile public ps'
ssh deploy@192.168.0.223 'cd /opt/the-neighbor-demo && docker compose logs --tail 50 nginx cloudflared'
```

nginx keeps no access log (the privacy policy says the server keeps no log of visitors); its error
log has only real errors.

## Moving to Cloudflare Pages

Nothing in the site depends on the home server. To move:

1. `npm run build:pages` makes `dist/`: `web/` with the fonts, plus `_headers` (from
   `deploy/nginx/headers.inc`) and `_redirects` (the old account/admin pages).
2. Create a Pages project (direct upload) and upload it: `npx wrangler pages deploy dist
   --project-name the-neighbor`, or drag `dist/` into the dashboard.
3. In the Pages project, add the custom domains `theneighbor.dk` and `www.theneighbor.dk`. Cloudflare
   replaces the two tunnel CNAMEs with its own records (if it asks, delete the old ones first).
4. Add a Redirect Rule: `www.theneighbor.dk/*` → `https://theneighbor.dk/${1}`, 301.
5. Run `SITE=https://theneighbor.dk/ npm run test:live`, then remove the two hostnames from the
   tunnel config (or stop the containers).

The privacy policy still holds on Pages (Cloudflare delivers the site; no visitor log is kept by
us). Pages keeps no access log for you, but check Cloudflare's analytics settings and keep Web
Analytics off, or the policy must mention it.

## Small changes without a developer

- **Booking address, phone:** `CONFIG.contact` in `web/js/booking-rules.js`.
- **Closed days** (holidays, sick days): `CONFIG.closedDates` in the same file, e.g.
  `['2026-12-24', '2026-12-31']`.
- **Prices and services:** `SERVICES` in the same file. Texts: `web/js/i18n.js`.

Then `npm test`, `npm run test:browser` and `npm run deploy`.

## Earlier setups on this server

- Spoke & Go (Express and SQLite) ran here until 2026-10-17; a vzdump of CT 114 was taken before it
  was removed.
- The Firebase emulator demo ran here from 2026-10-17 to 2026-10-23, then a static demo at
  book.icepuente.com until the switch to theneighbor.dk.
