# Deploying Kingu cloud

Production runs on one server (DigitalOcean, `kingu.anthovai.com` → its IP)
that already has Caddy. The API and Postgres run in Docker; Caddy terminates
HTTPS and proxies to `127.0.0.1:8787`.

1. Copy this `cloud/` directory to the server (for example with `rsync -a
   --exclude node_modules cloud/ server:/opt/kingu-cloud/`).
2. On the server: `cp deploy/.env.example deploy/.env` and fill in the
   secrets (`openssl rand -base64 32`).
3. From `/opt/kingu-cloud`: `docker compose -f deploy/compose.prod.yaml
   --env-file deploy/.env up -d --build`.
4. Add `Caddyfile.kingu` to the server's Caddyfile and reload Caddy.
5. Check: `curl https://kingu.anthovai.com/healthz` → `{"ok":true}`.

Updating: copy the new `cloud/` over and run step 3 again. Data lives in the
`postgres-data` volume; back it up with `docker compose ... exec postgres
pg_dump -U kingu kingu > backup.sql`.

Desktop builds use `https://kingu.anthovai.com` unless `KINGU_CLOUD_URL`
says otherwise. Installing from a share link needs no account; publishing
needs desktop sign-in, which the API does not have yet.
