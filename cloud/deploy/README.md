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
says otherwise. Signing in from Kingu (Settings → Artifacts or Share Skills
→ Connect) opens `https://kingu.anthovai.com/v1/desktop/auth/authorize` in
the browser: sign in, or create an account if the email is allowed by
`KINGU_API_ALLOWED_EMAILS`. Installing from a share link needs no account.

## Granting plans

There is no payment provider yet: plans (`free`, `arkai_pro`, defined in
`apps/api/src/plans.ts`) are granted by hand. Everyone without an active grant
is on `free`. The person must have signed up from Kingu first.

- From the server: `docker compose -f deploy/compose.prod.yaml --env-file
  deploy/.env exec api node apps/api/dist/admin/grant.js --email
  someone@example.com --plan arkai_pro --days 30 --note "beta"` (omit
  `--days` for no end). `--list --email <email>` shows grants;
  `--revoke <entitlementId>` ends one.
- Over HTTP, with a token from `KINGU_API_ADMIN_TOKENS` (`token=name` pairs;
  unset turns these off): `POST /v1/admin/entitlements {email, planId, days?,
  note?}`, `DELETE /v1/admin/entitlements/<id>`, and `POST
  /v1/admin/grant-codes {planId, days, maxUses}`, which returns a
  `KINGU-XXXX-...` code once. People redeem it with `POST /v1/account/redeem
  {code}`; `GET /v1/account` shows their plan.
