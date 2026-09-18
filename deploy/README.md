# Deploying Darkpools

Darkpools runs on the existing KCAL host next to the other two applications, in the same
shape they use: a Node service under systemd, behind the host's nginx, with PostgreSQL
installed from Ubuntu's package. Docker is not used on the host (1 GB of RAM, small disk).

Flow:

1. A push to the deployment branch runs the **Release image** workflow, which builds the
   application in GitHub Actions and publishes the public image
   `ghcr.io/dhulfiqar8409/darkpools:latest`. The image is only a transport: nothing is
   built on the server.
2. On the server, `darkpools-update` runs every five minutes from a systemd timer. When the
   image digest changes it exports the image with `crane`, keeps only `/app` (the Next.js
   standalone server plus the Prisma CLI), applies migrations, switches the
   `/var/www/darkpools/current` symlink, restarts the service and checks health, rolling
   back on failure. No SSH key or repository secret is involved.
3. nginx routes `darkpools.deeapps.net` to `127.0.0.1:3300` using the existing wildcard
   certificate.

Files in `server/`:

- `setup.sh`: one-time, idempotent host setup (swap, PostgreSQL, crane, layout, units, vhost).
- `darkpools-update`: the updater installed at `/usr/local/bin/darkpools-update`.
- `darkpools.service`, `darkpools-update.service`, `darkpools-update.timer`: systemd units.
- `nginx-darkpools.conf`: the server block installed as `/etc/nginx/sites-available/darkpools`.

Layout on the host:

```
/var/www/darkpools/
  current -> releases/<digest>   # the running build
  releases/<digest>/             # extracted builds (two are kept)
  shared/.env                    # DATABASE_URL, SESSION_SECRET, UPLOAD_DIR (root:www-data, 640)
  shared/uploads/                # screenshots
```

Useful commands on the host: `systemctl status darkpools`, `journalctl -u darkpools -f`,
`darkpools-update --retry`, `systemctl list-timers darkpools-update.timer`.
