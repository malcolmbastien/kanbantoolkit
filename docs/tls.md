# TLS and the proxy

Kanban Toolkit does not terminate TLS. It listens on a port, on the loopback or on your private network,
and a reverse proxy is what puts `https://` in front of it. That is the one thing every operator must
get right: without it the session cookie is not secure, and the sign-in providers will not accept
your redirect URI.

## What the proxy has to do

1. **Terminate TLS** for the instance's address, with a certificate that is valid for it.
2. **Forward to the process** — `127.0.0.1:8787` in the examples here.
3. **Pass the client's address** in `X-Forwarded-For`. The error endpoint hashes it (never stores it)
   and rate-limits by it; without the header, every request looks like the proxy's address.
4. **Upgrade the socket** at `/api/workspace/live` if you want the live channel. Without the upgrade
   the app still works: it polls the same feed.
5. **Set the response headers** a browser needs. On Cloudflare these come from `public/_headers`; on a
   Node deployment the proxy is what applies them, because a file next to the build is not something
   this process reads.

## Caddy

Caddy gets a certificate and renews it without being asked, which is why it is the shortest correct
configuration.

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
        # The same policy public/_headers carries for the static host.
        Content-Security-Policy "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
        X-Robots-Tag "noindex"
        -Server
    }

    # The app is private work, and the site is not: the header above belongs to /app alone when the
    # site is public. See the note below.
}
```

Caddy passes `Upgrade` and `Connection` through by default, so the socket works with no extra
directive. If you put Kanban Toolkit behind another proxy in the same chain, keep HTTP/1.1 to this one.

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

**`PUBLIC_URL` must be the https address.** It is what the redirect URI is built from and what tells
the server the browser is on https, which is what makes the session cookie `Secure`. If it is unset,
the cookie is issued for whatever the request's origin was — usually `http` behind a proxy, and then
it is not `Secure`.

**Do not put a second TLS hop in front of a provider callback.** `https://kanbantoolkit.example/api/auth/callback`
is the URI to register, exactly, with no trailing slash and no port.

**The `noindex` header belongs to the app, not to the site.** `public/_headers` scopes it to `/app/*`
and the site is meant to be indexed. The snippet above applies it everywhere because it is the app,
not the project's site, that a self-hoster runs: if you serve both from one origin, narrow it:

```caddy
@app path /app /app/*
header @app X-Robots-Tag "noindex"
```

**Compression is the proxy's job.** The build ships uncompressed files; `encode`/`gzip` in the proxy
is what keeps the first download small.

**The database file is not served.** It sits beside the process, not inside `dist/`. Nothing in the
static directory can reach it, and nothing should be added that would.

## Checking it

```bash
curl -sI https://kanbantoolkit.example/app | grep -iE 'strict-transport|content-security|nosniff'
curl -s  https://kanbantoolkit.example/api/health
# {"ok":true,"database":"ok"}
```

And in a browser: sign in, then look at the session cookie. It should be `HttpOnly`, `SameSite=Lax`,
and `Secure`. A cookie without `Secure` on an https page is the sign that `PUBLIC_URL` is not set.

---

**Last verified:** 0.1.0, with Caddy 2.8 and nginx 1.26: the health check, a sign-in round trip, and
the live socket upgrading at `/api/workspace/live`.
