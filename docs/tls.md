# TLS and the proxy

Kanban Toolkit does not terminate TLS: it listens on a port, on loopback or your private network, and
a reverse proxy puts `https://` in front of it. Without one the session cookie is not secure and the
sign-in providers will not accept your redirect URI.

## What the proxy has to do

1. **Terminate TLS** for the instance's address, with a certificate valid for it.
2. **Forward to the process** — `127.0.0.1:8787` in the examples here.
3. **Pass the client's address** in `X-Forwarded-For`. The error endpoint hashes it (never stores it)
   and rate-limits by it; without the header, every request looks like the proxy's address.
4. **Upgrade the socket** at `/api/workspace/live` for the live channel. Without the upgrade the app
   still works: it polls the same feed.
5. **Set the response headers** a browser needs. On Cloudflare these come from `public/_headers`; on a
   Node deployment the proxy applies them.

## Caddy

Caddy gets a certificate and renews it without being asked.

```caddy
kanbantoolkit.example {
    encode zstd gzip

    # The app and the API.
    reverse_proxy 127.0.0.1:8787 {
        header_up X-Forwarded-For {remote_host}
        # The socket for the live channel.
        transport http {
            versions 1.1
        }
    }

    header {
        # The same policy public/_headers carries for the static host. If this origin also serves the
        # public site, scope the X-Robots-Tag line to /app (see below).
        Content-Security-Policy "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
        X-Robots-Tag "noindex"
        -Server
    }

}
```

Caddy passes `Upgrade` and `Connection` through by default, so the socket needs no extra directive. If
you put Kanban Toolkit behind another proxy in the same chain, keep HTTP/1.1 to this one.

## nginx

```nginx
server {
    listen 443 ssl http2;
    server_name kanbantoolkit.example;

    ssl_certificate     /etc/letsencrypt/live/kanbantoolkit.example/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/kanbantoolkit.example/privkey.pem;

    client_max_body_size 8m;   # a workspace import is a few megabytes at most

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;

        # The live channel: without these two lines the app polls instead.
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    add_header Content-Security-Policy "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
}
```

## The parts that bite

**`PUBLIC_URL` must be the https address.** It builds the redirect URI and tells the server the browser
is on https, which makes the session cookie `Secure`. Unset, the cookie is issued for whatever the
request's origin was — usually `http` behind a proxy.

**The callback address must match exactly.** Register `https://kanbantoolkit.example/api/auth/callback`
as written, with no trailing slash and no port; the provider compares it character for character.

**`noindex` is for the app, not the site.** `public/_headers` applies it only to `/app/*`, because the
project's site is meant to be indexed. The snippets above apply it to the whole origin, which is right
if you run only the app. Serving both from one origin, narrow it:

```caddy
@app path /app /app/*
header @app X-Robots-Tag "noindex"
```

**Compression is the proxy's job.** The build ships uncompressed files; `encode`/`gzip` in the proxy
keeps the first download small.

**The database file is not served.** It sits beside the process, not inside `dist/`. Nothing in the
static directory can reach it, and nothing should be added that would.

## Checking it

```bash
curl -sI https://kanbantoolkit.example/app | grep -iE 'content-security|nosniff'
curl -s  https://kanbantoolkit.example/api/health
# {"ok":true,"database":"ok"}
```

In a browser: sign in, then look at the session cookie. It should be `HttpOnly`, `SameSite=Lax`, and
`Secure`. A cookie without `Secure` on an https page means `PUBLIC_URL` is not set.

---

**Last verified:** 0.1.0, with Caddy 2.8 and nginx 1.26: the health check, a sign-in round trip, and
the live socket upgrading at `/api/workspace/live`.
