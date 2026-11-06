# Operations: theneighbor.dk

The site is static, with one small backend: nginx on Alec's home server serves `web/` and passes
`POST /api/request` to the booking API (`api/`, a Node container), which emails each request through
Resend. A Cloudflare Tunnel makes it public at **theneighbor.dk** (www redirects to it). There is no
database, and nothing to back up on the server but the Resend key in `secrets/` (the repo is the
source of truth for everything else). nginx also answers `GET /api/address` for the address
suggestions (below), passing the typed text on to the Danish address register. Moving the static site to Cloudflare Pages is a few steps,
below (the API would not move with it).

| What | Where |
|---|---|
| Domain | `theneighbor.dk`, owned by the business; registrar Domænehajen, registry Punktum dk |
| DNS | Cloudflare, Alec's account (the account that holds the tunnel) |
| Server | Proxmox LXC 114 (`192.168.0.223`), managed through Jarvis; SSH as `deploy` |
| Folder | `/opt/the-neighbor-demo` (the name is from the demo days; owned by `deploy`) |
| Containers | Docker compose project `the-neighbor-demo`: `nginx` (port 8088 on localhost only), `api` (no port; nginx reaches it as `api:8080`) and `cloudflared` |
| API | [`api/`](../api/): Node 22 (`node:22.23.4-alpine3.24`), no npm packages, read-only container, non-root; code and `web/js` mounted read-only |
| Email | [Resend](https://resend.com), from `booking@theneighbor.dk`, domain region Ireland (`eu-west-1`); see [Booking emails](#booking-emails-resend) |
| Secret | `/opt/the-neighbor-demo/secrets/resend.env` (`RESEND_API_KEY=...`), mode 600, owned by `deploy`; never in git, never touched by the deploy |
| Tunnel | the existing tunnel `bike-booking` (id `7535fdd6-…`); config in [`deploy/cloudflared-config.yml`](../deploy/cloudflared-config.yml), credentials in `cloudflared/` on the server only |
| nginx | [`deploy/nginx/default.conf`](../deploy/nginx/default.conf) (GET only except `POST /api/request`; `GET /api/address` for the address suggestions; no access log, www redirect) and [`headers.inc`](../deploy/nginx/headers.inc) (the security headers, shared with the local server and the Pages build) |
| Address token | `/opt/the-neighbor-demo/secrets/nginx/address-token.inc`, the only file nginx sees from `secrets/` (not in git, not touched by a deploy) |

## Deploy

```bash
npm run deploy        # scripts/deploy.sh: sends web/, deploy/ and api/, restarts what changed,
                      # recreates the api container, checks the page and the API through nginx
npm run test:live     # the booking in headless Chrome against https://theneighbor.dk/ (sends nothing)
```

The deploy refuses to run while `CONFIG.contact.email` is an `example.com` placeholder.

Each deploy serves scripts, styles and fonts from a new path, `/r/<commit>/...` (the deploy rewrites
the pages' links and nginx maps the path back), because Cloudflare keeps JS and CSS in browsers for
4 hours. Pages themselves are never cached.

**Never delete or recreate `web/`, `web/js/`, `deploy/nginx/` or `api/` on the server**: nginx and
the api container have them mounted, and a recreated folder leaves the container attached to the
deleted one (no site, no config, or no code). The deploy empties them in place.

The deploy ends with `api: email configured`, or `api: no RESEND_API_KEY ...` while there is no key
(the site then works as before: every request uses the visitor's mail program).

**The tunnel config** is not copied by the deploy (the server's `cloudflared/config.yml` lives
next to its credentials). After changing `deploy/cloudflared-config.yml`, copy it over and restart:

```bash
scp deploy/cloudflared-config.yml deploy@192.168.0.223:/opt/the-neighbor-demo/cloudflared/config.yml
ssh deploy@192.168.0.223 'cd /opt/the-neighbor-demo && docker compose --profile public restart cloudflared'
```

## Booking emails (Resend)

The API sends two plain-text emails per request: to the owner (`CONFIG.contact.email`), Reply-To
the customer, and a copy to the customer, Reply-To the owner. Both come from
`The Neighbor <booking@theneighbor.dk>`. That address receives nothing (the domain has no inbound
mail); replies go to the Reply-To address.

**One-time setup** (done 2026-11-06):

1. **Account.** Create a Resend account for the business (the owner's address, with Alec as a team
   member, is easiest to hand over later). Accept the DPA: Resend's DPA is pre-signed and applies to
   every account; download the signed copy from Settings → Documents and keep it with the business
   papers (docs/legal-checklist.md, section 4). Check the free plan's current limits (it was 3,000
   emails a month, 100 a day): the API's cap of 40 requests a day is up to 80 emails.
2. **Domain.** Domains → Add domain: `theneighbor.dk`, region **Ireland (eu-west-1)**. Leave open and
   click tracking **off** (the privacy policy says nothing about tracking; the emails are plain
   text anyway).
3. **DNS** in Cloudflare: add exactly the records Resend shows for the domain, all **DNS only**
   (grey cloud), then press Verify in Resend. Resend's values change over time, so copy them from
   its dashboard rather than from here. As set up on 2026-11-06:

   | Type | Name | Content (from Resend) | Note |
   |---|---|---|---|
   | CNAME | `send` | `send.forge.rmta.net` | gives the sending subdomain its MX (bounces) and SPF TXT |
   | TXT | `resend._domainkey` | `p=MIGfMA0...` (a DKIM public key) | DKIM for `theneighbor.dk` |
   | TXT | `_dmarc` | `v=DMARC1; p=none;` | optional, recommended (start with `p=none`); not added yet |

   None of them touch the root domain's records or the two tunnel CNAMEs above.
4. **API key.** API Keys → Create: permission **Sending access**, domain `theneighbor.dk` only.
5. **Put the key on the server** (as `deploy`, or as root through `pct exec 114` and then
   `chown -R deploy:deploy secrets`), without it ending up in a shell history:

   ```bash
   cd /opt/the-neighbor-demo
   install -d -m 700 secrets
   read -rs KEY && (umask 077; printf 'RESEND_API_KEY=%s\n' "$KEY" > secrets/resend.env); unset KEY
   chmod 600 secrets/resend.env
   docker compose --profile public up -d --no-deps --force-recreate --wait api
   docker compose logs --tail 5 api     # "api: listening on 8080; email configured"
   ```

   docker compose reads the file itself (it is not mounted into the container). A plain
   `docker compose restart api` does **not** reread it: recreate the container, as above (every
   deploy does).
6. **Check:** book a real request on the site with your own address: both emails arrive (check
   the spam folder), From is `booking@theneighbor.dk`, Reply-To is right in each, æ/ø/å look
   right, and the copy has both ticked statements. In Resend, the email shows as delivered.

**Settings** (optional lines in `secrets/resend.env`; recreate the container after a change):
`DAILY_CAP` (requests a day for the whole site, default 40), `IP_LIMIT_PER_HOUR` (per visitor,
default 5), `MAIL_FROM` (default `The Neighbor <booking@theneighbor.dk>`). The limits are kept in
memory and start again when the container restarts. nginx also limits `POST /api/request` to 10 a
minute per visitor.

**To stop sending** (a leaked key, a problem with Resend): delete `secrets/resend.env` and recreate
the container. The API then answers 503 and the page uses the visitor's mail program. Revoke a
leaked key in Resend as well.

**What the API answers**, and what the page does: 200 sent (the "request sent" page); 400 with
`errors` (the server's own checks failed: the page shows them on the form); anything else (400
`bad`/`rejected`, 413, 429 busy, 502 Resend failed, 503 no key, no answer) → the mail fallback.

## Address suggestions

While `CONFIG.addressSuggest` is on (`web/js/booking-rules.js`), the street field suggests Danish
addresses as the visitor types. The page asks `/api/address?q=...` on this site; nginx passes only
the typed text on to Klimadatastyrelsen's **Adressevælger** (`adressevaelger.dk/husnumre/soeg`, which
replaced DAWA on 2026-10-01), with the token added on the server, and returns its JSON. No visitor
headers (IP, cookies) go with it, and the register's own headers are not passed back. Nothing is
logged: this route's error log is set to `crit`, because rate-limit and upstream-error lines would
quote the typed address. Each visitor is limited to about 5 lookups a second (then 429). If the register is down,
the field simply shows no suggestions. `npm run serve` has the same route (`scripts/serve.js`, token from `ADDRESS_TOKEN`).

**The token.** Without one, nginx uses the public sample token from Adressevælger's documentation
(`adressevaelger123`). The business should have its own (free, from a Dataforsyningen account). Put
it on the server in `secrets/nginx/` (the only part of `secrets/` nginx can see; the Resend key
stays out of its container), outside `deploy/` so deploys leave it alone, then reload nginx:

```bash
ssh deploy@192.168.0.223 'cd /opt/the-neighbor-demo && mkdir -p secrets/nginx &&
  printf "set \$address_token \"%s\";\n" "THE-TOKEN" > secrets/nginx/address-token.inc && chmod 600 secrets/nginx/address-token.inc &&
  docker compose exec -T nginx nginx -t -q && docker compose exec -T nginx nginx -s reload'
```

(nginx reads the file as root, so `600` owned by `deploy` is enough.) To check:
`curl -s 'https://theneighbor.dk/api/address?q=Jagtvej+10'` should answer `"status":"ok"`.

**Turning it off:** set `CONFIG.addressSuggest` to `false` and deploy. The form then works as plain
fields, the privacy policy's sentences about Adressevælger disappear by themselves (`js/privacy.js`),
and `/api/address` can stay in nginx unused.

## DNS (Cloudflare)

| Type | Name | Target | Proxy |
|---|---|---|---|
| CNAME | `theneighbor.dk` (`@`) | `7535fdd6-afd8-4e55-9048-0ffd003888e7.cfargotunnel.com` | proxied |
| CNAME | `www` | `7535fdd6-afd8-4e55-9048-0ffd003888e7.cfargotunnel.com` | proxied |

The domain's nameservers (set at Punktum dk or through Domænehajen) are the two Cloudflare gave
when the zone was added. HTTPS comes from Cloudflare's certificate for the zone; the tunnel carries
the traffic to nginx, so no certificate is needed on the server. Resend's records (above) are for
sending only, on the `send` subdomain and `resend._domainkey`. Receiving email at the domain, if
the business wants `@theneighbor.dk` addresses later, needs MX records on the root too.

## Check and logs

```bash
ssh deploy@192.168.0.223 'cd /opt/the-neighbor-demo && docker compose --profile public ps'
ssh deploy@192.168.0.223 'cd /opt/the-neighbor-demo && docker compose logs --tail 50 nginx api cloudflared'
ssh deploy@192.168.0.223 'cd /opt/the-neighbor-demo && docker compose exec -T nginx wget -qO- http://api:8080/api/health'
```

nginx keeps no access log (the privacy policy says the server keeps no log of visitors); its error
log has only real errors (refused requests show the cloudflared container's address, never a
visitor's). The API logs one line per request with the status and outcome only, e.g.
`api 200 sent`, `api 429 ip-limit`, `api 502 owner-failed resend=0:network`: never a name,
address, email, IP or request id. `/api/health` (inside the compose network only; nginx does not
pass it on) gives the same counters since the container started. **Keep it that way**: the privacy
policy promises it.

## Moving to Cloudflare Pages

The static site does not depend on the home server, but two routes do: on Pages,
`POST /api/request` gets 405, so every request falls back to the visitor's mail program (which
works, as before 2026-11-06), and there is no `/api/address` for the address suggestions.
Keeping server-side sending there means porting `api/` to a Pages Function (not done), and
updating the privacy policy. To move:

0. Set `CONFIG.addressSuggest` to `false` (see "Address suggestions"). `npm run build:pages`
   refuses to build until you do. (To keep the suggestions on Pages, the route would have to
   become a Pages Function; it does not exist yet.)
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
- **Prices and services:** `SERVICES` in the same file. Texts: `web/js/i18n.js` (also the emails'
  texts, the `mail.*` keys).

Then `npm test`, `npm run test:browser` and `npm run deploy`. The API uses the same files, so the
emails follow (the deploy restarts it).

## Earlier setups on this server

- Spoke & Go (Express and SQLite) ran here until 2026-10-17; a vzdump of CT 114 was taken before it
  was removed.
- The Firebase emulator demo ran here from 2026-10-17 to 2026-10-23, then a static demo at
  book.icepuente.com until the switch to theneighbor.dk.
