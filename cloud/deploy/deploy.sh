#!/usr/bin/env bash
# Deploys Kingu cloud to a server that already runs Caddy (as a system
# service). Run from anywhere; it ships this cloud/ directory over SSH.
#
#   cloud/deploy/deploy.sh root@152.42.177.130 'you@example.com,@anthovai.com'
#
# First run: creates /opt/kingu-cloud/deploy/.env with fresh secrets and the
# allowed sign-up emails; later runs keep it. Adds the kingu.anthovai.com site
# to /etc/caddy/Caddyfile only if it is not there yet (backing the file up
# first), validates it, and reloads Caddy. Other sites are left alone.
set -euo pipefail

target="${1:?usage: deploy.sh user@host allowed-emails}"
allowed="${2:-}"
here="$(cd "$(dirname "$0")/.." && pwd)"
remote=/opt/kingu-cloud

echo "==> Shipping $here to $target:$remote"
tar -C "$here" --exclude=node_modules --exclude=dist --exclude=deploy/.env -czf - . \
  | ssh "$target" "mkdir -p $remote && tar -xzf - -C $remote"

echo "==> Starting the API and Postgres"
ssh "$target" ALLOWED="$allowed" REMOTE="$remote" 'bash -s' <<'REMOTE_SCRIPT'
set -euo pipefail
cd "$REMOTE"
if [ ! -f deploy/.env ]; then
  if [ -z "$ALLOWED" ]; then
    echo "First deploy: pass the allowed sign-up emails as the second argument." >&2
    exit 1
  fi
  umask 077
  cat > deploy/.env <<ENV
KINGU_POSTGRES_PASSWORD=$(openssl rand -hex 24)
KINGU_API_GRANT_SECRET=$(openssl rand -hex 32)
KINGU_API_PUBLIC_URL=https://kingu.anthovai.com
KINGU_API_ALLOWED_EMAILS=$ALLOWED
KINGU_API_STATIC_TOKENS=
ENV
  echo "Created deploy/.env"
fi
docker compose -f deploy/compose.prod.yaml --env-file deploy/.env up -d --build
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8787/healthz >/dev/null 2>&1; then echo "API is up"; break; fi
  sleep 2
done

caddyfile=/etc/caddy/Caddyfile
if [ -f "$caddyfile" ] && ! grep -q '^kingu\.anthovai\.com' "$caddyfile"; then
  cp "$caddyfile" "$caddyfile.bak.$(date +%Y%m%d%H%M%S)"
  printf '\n' >> "$caddyfile"
  cat deploy/Caddyfile.kingu >> "$caddyfile"
  if caddy validate --config "$caddyfile" --adapter caddyfile >/dev/null 2>&1; then
    systemctl reload caddy && echo "Caddy reloaded with kingu.anthovai.com"
  else
    echo "The new Caddyfile does not validate; restoring the backup." >&2
    cp "$(ls -t "$caddyfile".bak.* | head -1)" "$caddyfile"
    exit 1
  fi
elif [ ! -f "$caddyfile" ]; then
  echo "No $caddyfile here (Caddy may run in Docker): add deploy/Caddyfile.kingu to its config by hand."
fi
REMOTE_SCRIPT

echo "==> Checking https://kingu.anthovai.com/healthz"
sleep 5
curl -fsS https://kingu.anthovai.com/healthz && echo
