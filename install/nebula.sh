#!/bin/bash
# Nebula — carousel installer for Jellyfin and Emby. One command on any system:
#
#   curl -fsSL https://raw.githubusercontent.com/agdick/NebEnglish/main/install/nebula.sh | bash
#
# Finds every Jellyfin and Emby on the machine by itself:
#   · in Docker (Unraid, Docker, Compose, Portainer, Synology, Docker inside an LXC…): creates a tiny
#     "nebula" container that adds the carousel and re-adds it after every update and reboot.
#   · installed directly (Proxmox LXC, Debian, Ubuntu…): adds it and sets up a task every 10 min.
#
# Remove it:  curl -fsSL https://raw.githubusercontent.com/agdick/NebEnglish/main/install/nebula.sh | bash -s -- --uninstall
# Optional:   JELLYFIN_API_KEY=… / EMBY_API_KEY=…  before "bash" so it also applies the theme by itself.
set -u
REPO="https://raw.githubusercontent.com/agdick/NebEnglish/main"
INYECTOR="${NEBULA_INYECTOR:-$REPO/install/inject-docker.sh}"
MODO="${1:-}"

if [ "$(id -u)" != 0 ]; then
  echo "Administrator rights are required. Paste it again with \"sudo\" before \"bash\":"
  echo "  curl -fsSL $REPO/install/nebula.sh | sudo bash"
  exit 1
fi
command -v curl >/dev/null || { echo "\"curl\" is missing. Install it (e.g. apt install curl) and try again."; exit 1; }

echo "✨ Nebula — looking for Jellyfin and Emby…"
HAY_DOCKER=0; command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 && HAY_DOCKER=1
EN_DOCKER=""
if [ "$HAY_DOCKER" = 1 ]; then
  for c in $(docker ps --format '{{.Names}}'); do
    case "$c" in nebula|nebula-emby) continue ;; esac
    docker exec "$c" sh -c 'for d in /jellyfin/jellyfin-web /usr/share/jellyfin/web /usr/lib/jellyfin/bin/jellyfin-web /app/emby/system/dashboard-ui /app/emby/dashboard-ui /opt/emby-server/system/dashboard-ui /system/dashboard-ui; do [ -f "$d/index.html" ] && exit 0; done; exit 1' >/dev/null 2>&1 \
      && EN_DOCKER="$EN_DOCKER $c"
  done
fi

# ---------- uninstall ----------
if [ "$MODO" = "--uninstall" ]; then
  [ "$HAY_DOCKER" = 1 ] && docker rm -f nebula nebula-emby >/dev/null 2>&1 && echo "  ✓ \"nebula\" container removed"
  rm -f /etc/cron.d/nebula /usr/local/bin/nebula-inject
  curl -fsSL "$INYECTOR" | bash -s -- auto --uninstall
  exit 0
fi

# ---------- Docker: watcher container ----------
if [ -n "$EN_DOCKER" ]; then
  echo "  Found in Docker:$EN_DOCKER"
  docker rm -f nebula nebula-emby >/dev/null 2>&1          # previous version, if any
  docker run -d --name nebula --restart unless-stopped \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -e JELLYFIN_API_KEY="${JELLYFIN_API_KEY:-}" -e EMBY_API_KEY="${EMBY_API_KEY:-}" -e NEBULA_OPTIONS="${NEBULA_OPTIONS:-}" \
    docker:cli sh -c "apk add -q --no-cache bash curl && curl -fsSL $INYECTOR | bash -s -- auto --watch" >/dev/null \
    || { echo "  ✗ Could not create the \"nebula\" container"; exit 1; }
  echo "  ✓ \"nebula\" container created (it handles everything, including after updates and reboots)"
  # first pass right now, without waiting for the container to start
  curl -fsSL "$INYECTOR" | bash -s -- auto | sed 's/^/  /'
fi

# ---------- direct install on the system ----------
NATIVO=0
for d in /usr/share/jellyfin/web /usr/lib/jellyfin/bin/jellyfin-web /opt/emby-server/system/dashboard-ui /usr/lib/emby-server/system/dashboard-ui /var/lib/emby/dashboard-ui; do
  [ -f "$d/index.html" ] && NATIVO=1
done
if [ "$NATIVO" = 1 ]; then
  echo "  Found installed on the system"
  curl -fsSL "$INYECTOR" -o /usr/local/bin/nebula-inject && chmod +x /usr/local/bin/nebula-inject
  /usr/local/bin/nebula-inject host | sed 's/^/  /'
  {
    echo "# Nebula: re-adds the carousel after Jellyfin/Emby updates"
    [ -n "${JELLYFIN_API_KEY:-}" ] && echo "JELLYFIN_API_KEY=$JELLYFIN_API_KEY"
    [ -n "${EMBY_API_KEY:-}" ] && echo "EMBY_API_KEY=$EMBY_API_KEY"
    [ -n "${NEBULA_OPTIONS:-}" ] && echo "NEBULA_OPTIONS=$NEBULA_OPTIONS"
    echo "*/10 * * * * root /usr/local/bin/nebula-inject host >/dev/null 2>&1"
  } > /etc/cron.d/nebula
  chmod 644 /etc/cron.d/nebula
  echo "  ✓ It will be re-applied automatically every 10 minutes"
fi

if [ -z "$EN_DOCKER" ] && [ "$NATIVO" = 0 ]; then
  echo
  echo "No Jellyfin or Emby found on this machine."
  echo "  · Proxmox: paste it INSIDE the LXC container or VM where Jellyfin/Emby runs"
  echo "    (in the LXC: the \"Console\" button), not on the Proxmox host itself."
  echo "  · Docker: check that the Jellyfin/Emby container is running."
  exit 1
fi

echo
echo "🎉 Done! Open Jellyfin/Emby and reload with Ctrl+F5 to see the carousel."
echo "   Don't have the theme yet? See \"Installing the theme\" at https://github.com/agdick/NebEnglish"
