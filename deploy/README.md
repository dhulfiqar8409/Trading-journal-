# Deploying Darkpools

Darkpools runs on the existing KCAL host next to the other applications, behind the
reverse proxy that already serves them. Nothing is built on the server.

Flow:

1. A push to the deployment branch runs the **Release image** workflow, which builds the
   Docker image in GitHub Actions and pushes it to `ghcr.io/dhulfiqar8409/darkpools:latest`.
2. On the server, `/opt/darkpools/docker-compose.yml` is a copy of
   `deploy/docker-compose.prod.yml`. A systemd timer runs `docker compose pull` and
   `docker compose up -d` every few minutes, so a new image goes live shortly after the
   workflow finishes. No SSH key or repository secret is involved.
3. The proxy routes `darkpools.deeapps.net` to `127.0.0.1:3300`, the port compose publishes
   on localhost only.

Files in this directory:

- `docker-compose.prod.yml`: the compose file used on the server (image based, no build).
- Proxy and updater configuration are added once the host survey is done.
