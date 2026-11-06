# The site's response headers: the one list for every host.
# - nginx includes it (default.conf); the name ends in .inc, not .conf, so nginx does not load it
#   as a server of its own.
# - scripts/serve.js (local tests) and scripts/build-pages.js (Cloudflare Pages' _headers) read it,
#   so keep it to one `add_header Name "value" always;` per line.
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), interest-cohort=()" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" always;
# HTTPS only, for a year (browsers ignore it over plain HTTP; Cloudflare serves the site over HTTPS).
# No includeSubDomains: other subdomains of theneighbor.dk may not have HTTPS.
add_header Strict-Transport-Security "max-age=31536000" always;
