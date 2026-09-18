#!/usr/bin/env bash
# One-time host setup for Darkpools on the KCAL server. Idempotent; run as root.
#
# Adds, without touching the other applications or their nginx server blocks:
#   - light housekeeping (apt cache, journal size, disabled snap revisions) to free disk
#   - a 512 MB swap file (the host has 1 GB of RAM and no swap)
#   - PostgreSQL from Ubuntu's package, tuned small, with a darkpools role and database
#   - crane (extracts the published image without Docker)
#   - /var/www/darkpools layout, the systemd service, the updater and its timer
#   - the nginx server block for darkpools.deeapps.net, enabled after the first deployment
set -euo pipefail

RAW="${DARKPOOLS_RAW:-https://raw.githubusercontent.com/dhulfiqar8409/Trading-journal-/claude/trading-journal-aws-pnsmv4/deploy/server}"
BASE=/var/www/darkpools
log() { echo "[setup] $*"; }

log "1/7 housekeeping"
apt-get clean
rm -rf /var/lib/apt/lists/*
journalctl --vacuum-size=64M >/dev/null 2>&1 || true
snap list --all 2>/dev/null | awk '/disabled/{print $1, $3}' | while read -r name rev; do
  snap remove "$name" --revision="$rev" >/dev/null 2>&1 || true
done
snap set system refresh.retain=2 2>/dev/null || true

log "2/7 swap"
if [ -z "$(swapon --show --noheadings)" ]; then
  fallocate -l 512M /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
printf 'vm.swappiness = 10\n' > /etc/sysctl.d/90-darkpools-swap.conf
sysctl -q -p /etc/sysctl.d/90-darkpools-swap.conf

log "3/7 postgresql"
if ! command -v psql >/dev/null; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q postgresql >/dev/null
fi
PGVER="$(ls /etc/postgresql | sort -V | tail -1)"
PGCONF="/etc/postgresql/$PGVER/main/conf.d/darkpools.conf"
if [ ! -f "$PGCONF" ]; then
  cat > "$PGCONF" <<'PG'
# Darkpools: single-user workload on a 1 GB host.
shared_buffers = 32MB
effective_cache_size = 128MB
work_mem = 4MB
maintenance_work_mem = 32MB
max_connections = 20
PG
  systemctl restart postgresql
fi
systemctl enable --now postgresql >/dev/null 2>&1 || true

log "4/7 database role, database and environment file"
mkdir -p "$BASE/shared/uploads" "$BASE/releases"
if [ ! -f "$BASE/shared/.env" ]; then
  DBPASS="$(openssl rand -hex 24)"
  SESSION="$(openssl rand -base64 48 | tr -d '\n')"
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='darkpools'" | grep -q 1; then
    sudo -u postgres psql -q -c "CREATE ROLE darkpools LOGIN PASSWORD '$DBPASS'"
  else
    sudo -u postgres psql -q -c "ALTER ROLE darkpools WITH LOGIN PASSWORD '$DBPASS'"
  fi
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='darkpools'" | grep -q 1; then
    sudo -u postgres createdb -O darkpools darkpools
  fi
  umask 027
  cat > "$BASE/shared/.env" <<ENV
DATABASE_URL=postgresql://darkpools:${DBPASS}@127.0.0.1:5432/darkpools
SESSION_SECRET=${SESSION}
UPLOAD_DIR=${BASE}/shared/uploads
ENV
fi
# One-time setup token: the first-run page only creates the owner account when the link
# carries this token, so nobody else can claim the account before you do.
if ! grep -q '^SETUP_TOKEN=' "$BASE/shared/.env"; then
  echo "SETUP_TOKEN=$(openssl rand -hex 16)" >> "$BASE/shared/.env"
fi
# The app checks the Origin of state-changing requests against this value.
if ! grep -q '^APP_ORIGIN=' "$BASE/shared/.env"; then
  echo "APP_ORIGIN=https://darkpools.deeapps.net" >> "$BASE/shared/.env"
fi
chown root:www-data "$BASE/shared/.env"; chmod 640 "$BASE/shared/.env"
chown -R www-data:www-data "$BASE/shared/uploads"

log "5/7 crane"
if ! command -v crane >/dev/null; then
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/crane.tgz" https://github.com/google/go-containerregistry/releases/latest/download/go-containerregistry_Linux_x86_64.tar.gz
  curl -fsSL -o "$tmp/checksums.txt" https://github.com/google/go-containerregistry/releases/latest/download/checksums.txt
  expected="$(awk '/ go-containerregistry_Linux_x86_64.tar.gz$/{print $1}' "$tmp/checksums.txt")"
  actual="$(sha256sum "$tmp/crane.tgz" | awk '{print $1}')"
  [ -n "$expected" ] && [ "$expected" = "$actual" ] || { log "crane checksum mismatch"; exit 1; }
  tar -xzf "$tmp/crane.tgz" -C "$tmp" crane
  install -m 0755 "$tmp/crane" /usr/local/bin/crane
  rm -rf "$tmp"
fi
crane version

log "6/7 service, updater, timer, first deployment"
curl -fsSL "$RAW/darkpools-update" -o /usr/local/bin/darkpools-update
chmod 0755 /usr/local/bin/darkpools-update
for unit in darkpools.service darkpools-update.service darkpools-update.timer; do
  curl -fsSL "$RAW/$unit" -o "/etc/systemd/system/$unit"
done
systemctl daemon-reload
systemctl enable darkpools.service >/dev/null 2>&1
# Drop extracted builds other than the running one before deploying (disk is small).
if [ -L "$BASE/current" ]; then
  for dir in "$BASE"/releases/*/; do
    [ -d "$dir" ] || continue
    [ "$(readlink -f "$dir")" = "$(readlink -f "$BASE/current")" ] || rm -rf "$dir"
  done
fi
/usr/local/bin/darkpools-update --retry || true
systemctl enable --now darkpools-update.timer >/dev/null 2>&1

log "7/7 nginx server block for darkpools.deeapps.net"
curl -fsSL "$RAW/nginx-darkpools-http.conf" -o /etc/nginx/conf.d/darkpools.conf
curl -fsSL "$RAW/nginx-darkpools.conf" -o /etc/nginx/sites-available/darkpools
ln -sfn /etc/nginx/sites-available/darkpools /etc/nginx/sites-enabled/darkpools
nginx -t
systemctl reload nginx

log "done"
df -h / | tail -1
free -m | head -2
echo "darkpools.service: $(systemctl is-active darkpools)"
echo "timer: $(systemctl is-active darkpools-update.timer)"
echo "health (local): $(curl -fsS --max-time 5 http://127.0.0.1:3300/api/health || echo unhealthy)"
echo "health (via nginx): $(curl -fsS --max-time 5 --resolve darkpools.deeapps.net:443:127.0.0.1 https://darkpools.deeapps.net/api/health || echo unhealthy)"
echo
echo "Create the admin account with this link (keep it to yourself; it stops working once the account exists):"
echo "  https://darkpools.deeapps.net/setup?token=$(grep '^SETUP_TOKEN=' "$BASE/shared/.env" | cut -d= -f2)"
