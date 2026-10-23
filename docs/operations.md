# Operations: book.icepuente.com

The site is static: nginx serves `web/`, and a Cloudflare Tunnel makes it public. There is no
database, no backend and nothing to back up on the server (the repo is the source of truth).

| What | Where |
|---|---|
| Server | Proxmox LXC 114 (`192.168.0.223`), managed through Jarvis; SSH as `deploy` |
| Folder | `/opt/the-neighbor-demo` (owned by `deploy`; root created it) |
| Containers | Docker compose project `the-neighbor-demo`: `nginx` (port 8088 on localhost only) and `cloudflared` |
| Files | `web/` (the site), `deploy/` (nginx config, compose file), `compose.yaml` (copied from `deploy/`) |
| Tunnel | the existing tunnel `bike-booking`; its config and credentials are in `cloudflared/` on the server only |
| nginx config | [`deploy/nginx/default.conf`](../deploy/nginx/default.conf): GET only, no access log, security headers, `noindex` |

## Deploy

```bash
npm run deploy        # scripts/deploy.sh: sends web/ and deploy/, restarts what changed, checks the page
npm run test:live     # the booking in headless Chrome against https://book.icepuente.com/
```

Each deploy serves scripts, styles and fonts from a new path, `/r/<commit>/...` (the deploy rewrites
the pages' links and nginx maps the path back), because Cloudflare keeps JS and CSS in browsers for
4 hours. Pages themselves are never cached.

**Never delete or recreate `web/` or `deploy/nginx/` on the server**: nginx has them mounted, and a
recreated folder leaves it attached to the deleted one (no site, or no config). The deploy empties
them in place.

## Check and logs

```bash
ssh deploy@192.168.0.223 'cd /opt/the-neighbor-demo && docker compose --profile public ps'
ssh deploy@192.168.0.223 'cd /opt/the-neighbor-demo && docker compose logs --tail 50 nginx cloudflared'
```

nginx keeps no access log (the privacy policy says the server keeps no log of visitors); its error
log has only real errors.

## Small changes without a developer

- **Booking address, phone, demo bar:** `CONFIG.contact` and `CONFIG.demo` in
  `web/js/booking-rules.js`.
- **Closed days** (holidays, sick days): `CONFIG.closedDates` in the same file, e.g.
  `['2026-12-24', '2026-12-31']`.
- **Prices and services:** `SERVICES` in the same file. Texts: `web/js/i18n.js`.

Then `npm test`, `npm run test:browser` and `npm run deploy`.

## Earlier setups on this server

- Spoke & Go (Express and SQLite) ran here until 2026-10-17; a vzdump of CT 114 was taken before it
  was removed.
- The Firebase emulator demo ran here from 2026-10-17 to 2026-10-23 (an `emulators` container next
  to nginx). It was removed with the switch to the static site.
