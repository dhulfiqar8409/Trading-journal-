#!/usr/bin/env bash
# Darkpools server survey.
# Read-only: prints facts about this server so the deploy config can be
# written to fit what is already running here. Prints no secrets, so the
# output is safe to paste into the chat.

section() { printf '\n--- %s ---\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }
dk() { docker "$@" 2>/dev/null || sudo -n docker "$@" 2>/dev/null; }

echo "=== DARKPOOLS SERVER SURVEY ($(date -u +%Y-%m-%dT%H:%MZ)) ==="
echo "user=$(whoami) host=$(hostname) home=$HOME"
if sudo -n true 2>/dev/null; then echo "sudo: passwordless ok"; else echo "sudo: needs a password or unavailable"; fi

section "os"
grep -E '^(PRETTY_NAME|VERSION_ID)=' /etc/os-release 2>/dev/null
uname -mr

section "resources"
echo "cpus=$(nproc 2>/dev/null)"
free -h 2>/dev/null
df -h / 2>/dev/null
if [ -n "$(swapon --show --noheadings 2>/dev/null)" ]; then
  swapon --show 2>/dev/null
else
  echo "no swap configured"
fi

section "network"
echo "public ip seen from outside: $(curl -s --max-time 5 https://checkip.amazonaws.com 2>/dev/null || echo unknown)"
for h in darkpools.deeapps.net deeapps.net; do
  r=$(getent hosts "$h" 2>/dev/null | awk '{print $1}' | tr '\n' ' ')
  echo "dns $h -> ${r:-does not resolve}"
done

section "ssh host key (public; used to pin known_hosts in the deploy workflow)"
cat /etc/ssh/ssh_host_ed25519_key.pub 2>/dev/null || echo "ed25519 host key not readable"

section "docker"
if have docker; then
  docker --version 2>&1
  docker compose version 2>&1 || echo "docker compose plugin missing"
  if docker ps >/dev/null 2>&1; then
    echo "docker usable by $(whoami) without sudo"
  else
    echo "docker needs sudo for $(whoami)"
  fi
  echo
  echo "containers:"
  dk ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' || echo "cannot list containers"
  echo
  echo "networks: $(dk network ls --format '{{.Name}}' | tr '\n' ' ')"
  echo "compose projects:"
  dk compose ls -a || echo "none listed"
else
  echo "docker not installed"
fi

section "listening ports"
ports="$({ ss -tlnp 2>/dev/null || sudo -n ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null; } \
  | awk 'NR==1 || /LISTEN/' | sed -E 's/,fd=[0-9]+//g')"
if [ -n "$ports" ]; then echo "$ports"; else echo "could not list ports (ss/netstat unavailable)"; fi

section "web servers / reverse proxies"
found=0
for p in nginx caddy traefik apache2 httpd haproxy; do
  if have "$p"; then
    found=1
    echo "$p: installed on host, service $(systemctl is-active "$p" 2>/dev/null || echo unknown)"
  fi
done
proxies="$(dk ps --format '{{.Names}} ({{.Image}})' | grep -Ei 'nginx|caddy|traefik|proxy|haproxy' || true)"
if [ -n "$proxies" ]; then
  found=1
  echo "$proxies" | sed 's/^/container: /'
fi
[ "$found" = 1 ] || echo "none detected"

section "nginx vhosts"
if [ -d /etc/nginx ]; then
  for f in /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf; do
    [ -f "$f" ] || continue
    echo "[$f]"
    grep -E '^\s*(server_name|listen|proxy_pass|root)\s' "$f" 2>/dev/null | sed 's/^\s*/  /'
  done
else
  echo "no /etc/nginx on host"
fi

section "caddy"
if [ -f /etc/caddy/Caddyfile ]; then
  grep -vE '^\s*(#|$)' /etc/caddy/Caddyfile
else
  echo "no /etc/caddy/Caddyfile on host"
fi

section "tls certificates"
ls /etc/letsencrypt/live 2>/dev/null || echo "no certbot certificates on host"

section "app directories"
dirs="$(ls -d /opt/*/ /srv/*/ /var/www/*/ "$HOME"/*/ 2>/dev/null || true)"
if [ -n "$dirs" ]; then echo "$dirs"; else echo "none found in the usual places"; fi

section "running services (system units filtered out)"
systemctl list-units --type=service --state=running --no-pager --no-legend 2>/dev/null | awk '{print $1}' \
  | grep -vE '^(systemd-|dbus|cron|ssh|getty@|serial-getty|rsyslog|polkit|udisks|snapd|snap\.|acpid|chrony|amazon-ssm|cloud-|apparmor|unattended|multipathd|ModemManager|networkd|resolved|udev|user@|irqbalance|ec2|hibinit|lvm2|thermald|packagekit|accounts|fwupd|upower|rpcbind|atd|qemu|containerd|docker)' \
  || echo "none"
if have pm2; then echo "pm2:"; pm2 ls 2>/dev/null; fi

section "databases"
for s in postgres mysqld mariadbd redis-server mongod; do
  pgrep -x "$s" >/dev/null 2>&1 && echo "$s is running on the host"
done
dbs="$(dk ps --format '{{.Names}} ({{.Image}})' | grep -Ei 'postgres|mysql|maria|redis|mongo' || true)"
[ -n "$dbs" ] && echo "$dbs" | sed 's/^/container: /'
echo "(nothing listed above means no database detected)"

section "runtimes"
for t in node npm python3 git; do
  have "$t" && echo "$t $("$t" --version 2>&1 | head -1)"
done

echo
echo "=== END SURVEY: copy everything above and paste it to Claude ==="
