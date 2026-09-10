#!/usr/bin/env bash
# Cardbox deploy script -- run this on the EC2 host from the cardbox repo root
# (also what CI runs over SSH after a successful image build+push).
# Mirrors trivo-lean/scripts/deploy.sh: this project owns exactly one Caddy
# site file, resolves it, drops it into ../edge/sites/, and reloads Caddy.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EDGE_DIR="${EDGE_DIR:-$APP_DIR/../edge}"
SITE_NAME="cardbox"

cd "$APP_DIR"

if [ ! -f .env ]; then
  echo "Missing .env -- copy .env.example to .env and fill in real values first." >&2
  exit 1
fi

# Load .env into this shell so GHCR_IMAGE/GHCR_USERNAME/GHCR_PAT etc. are
# available below. `docker compose` itself also auto-loads .env separately
# for the ${GHCR_IMAGE} substitution in docker-compose.yml.
set -a
source .env
set +a

echo "==> Logging in to GHCR..."
echo "$GHCR_PAT" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin

echo "==> Pulling ${GHCR_IMAGE} and starting the app + db..."
docker compose pull
docker compose up -d

echo "==> Waiting for the app to become healthy..."
for i in $(seq 1 20); do
  if docker exec cardbox-app node -e "process.exit(0)" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo "==> Publishing the Caddy site file..."
if [ ! -d "$EDGE_DIR" ]; then
  echo "Could not find the edge project at $EDGE_DIR -- set EDGE_DIR to override." >&2
  exit 1
fi
# No app-specific variables to substitute right now (the domain is fixed),
# but this is where envsubst would run if that ever changes.
cp "$APP_DIR/deploy/caddy-site.conf" "$EDGE_DIR/sites/$SITE_NAME.conf"

echo "==> Reloading Caddy..."
"$EDGE_DIR/scripts/reload.sh"

echo "==> Done. https://cards.utils.trivoailabs.com should be live."
