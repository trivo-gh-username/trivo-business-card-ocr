# Cardbox v2

Self-hosted visiting-card scanner: login + RBAC, one shared card database
(no more Google Sheets), digital cards, and admin-configurable Gemini
settings. Runs on your own EC2 host behind the shared `edge` Caddy stack.

## Architecture

- **App** (Node/Express) -- serves the PWA, the REST API, calls Gemini to
  read cards (with a native-Tesseract fallback), stores card photos on a
  Docker volume.
- **Postgres** -- the single source of truth: users, cards (soft-delete),
  comments, settings (Gemini key/model, encrypted), audit log. Stays on
  an internal-only Docker network -- never reachable from `edge` or the
  internet.
- **Caddy** (`edge` project, already on your host) -- TLS + reverse proxy
  for `cards.utils.trivoailabs.com`, same pattern as every other app on
  this host.

## First-time setup on the EC2 host

```bash
# next to your existing edge/ and trivo-lean/ directories
git clone <this repo> cardbox
cd cardbox
cp .env.example .env
# edit .env: GHCR_IMAGE/GHCR_USERNAME/GHCR_PAT (see the CI/CD section below),
# POSTGRES_PASSWORD, SESSION_SECRET, SECRETS_MASTER_KEY (use
# `openssl rand -hex 32` for each), and SEED_ADMIN_EMAIL/PASSWORD for your
# first login.
./scripts/deploy.sh
```

Since `deploy.sh` pulls a prebuilt image rather than building on the host,
there needs to already be one in GHCR the first time you run it -- push
this repo to GitHub first (or run the "Build and push Docker image"
workflow manually from the Actions tab) so an image exists, *then* run
`deploy.sh` on the host.

`scripts/deploy.sh` logs into GHCR, pulls the image, starts the app +
Postgres, waits for the app to come up, copies `deploy/caddy-site.conf`
into `../edge/sites/cardbox.conf`, and reloads Caddy. Set
`EDGE_DIR=/path/to/edge` first if your `edge` checkout isn't a sibling
directory.

Log in at `https://cards.utils.trivoailabs.com` with the `SEED_ADMIN_*`
credentials from `.env`, then go to **Admin** and:
1. Paste a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey).
2. Pick a model from the dropdown -- it's fetched live from Google, so it's
   never out of date.
3. Add your teammates as users (editor/viewer/admin).

The seed admin credentials only matter on the very first startup (when
the `users` table is empty) -- change that password or remove
`SEED_ADMIN_*` from `.env` afterwards if you like.

## Continuous deployment (GitHub Actions)

Two chained workflows:

1. **`.github/workflows/docker-build-push.yml`** -- on every push to `main`,
   builds the image from this repo's `Dockerfile` and pushes it to GHCR,
   tagged `latest` and with the short commit SHA.
2. **`.github/workflows/deploy.yml`** -- triggers automatically once that
   build succeeds (`workflow_run`), SSHes into the EC2 host, `git pull`s,
   and runs `scripts/deploy.sh`, which logs into GHCR (using the
   credentials in `.env`), pulls the new image, and restarts the stack
   with `docker compose up -d` -- no build happens on the EC2 box itself.

Repo secrets needed (Settings → Secrets and variables → Actions):

- `EC2_HOST` -- the host's public IP or DNS name
- `EC2_USER` -- the SSH user (e.g. `ubuntu`)
- `EC2_SSH_KEY` -- the private key (PEM contents) for that user
- `CARDBOX_APP_DIR` -- absolute path to this repo on the host, e.g. `/home/ubuntu/cardbox`

`docker-build-push.yml` needs no extra secrets -- it authenticates to GHCR
with the automatic `GITHUB_TOKEN`.

On the host itself, `.env` needs:

- `GHCR_IMAGE` -- e.g. `ghcr.io/<owner>/<repo>:latest`, matching what the
  build workflow pushes (`IMAGE_NAME` there is `github.repository`, i.e.
  `<owner>/<repo>`)
- `GHCR_USERNAME` / `GHCR_PAT` -- so `docker pull` can authenticate. GHCR
  images are private by default even in a public repo, so this is needed
  either way. Create a classic PAT with only the `read:packages` scope for
  this -- don't reuse a broader token.

`docker-compose.yml`'s `app` service is `image: ${GHCR_IMAGE}` --
`docker compose` reads `.env` in this directory automatically for that
substitution, no extra flag needed.

To trigger a deploy manually without pushing code, run either workflow
from the Actions tab with "Run workflow" (both have `workflow_dispatch`).

## How OCR works now

1. **Gemini** (primary) -- the compressed image(s) go straight to
   whichever model is configured in Admin.
2. **Tesseract** (fallback, automatic) -- if Gemini fails, times out, or
   no key is configured, the server runs the native `tesseract` binary
   (built with the higher-accuracy "best" trained data, not the default
   "fast" data) and a regex/heuristic parser extracts fields from the raw
   text. This always works even with zero Gemini quota/config, just less
   accurately on cluttered cards.

Either way, the person scanning always gets an editable review form
before anything is saved -- the reader only has to get close, not perfect.

## Duplicate detection

On save, the server checks the new card's phone numbers and emails
against every existing (non-deleted) card. A match shows a banner with
"View existing" / "Save anyway" rather than silently creating a
duplicate or silently blocking the save.

## Digital cards

Every card gets a **Download vCard** button (works immediately, no
setup). Any editor/admin can also flip **Make digital card public** on a
card's detail sheet, which generates a public link at
`/c/<random-slug>` -- a clean read-only page with a save-to-contacts
button and a QR code, servable to the actual contact. Public pages only
ever expose the one card they're linked to, and only while sharing is
switched on for it.

## Roles

- **admin** -- everything, plus user management and the Gemini settings.
- **editor** -- scan, edit, comment, delete (soft), restore, export.
- **viewer** -- browse, search, comment-read, export. No edit/delete.

## Backups

Postgres and the images volume are now the *only* copy of this data (no
incidental Google Sheets backup anymore). Set up something like:

```bash
docker exec cardbox-db pg_dump -U cardbox cardbox | gzip > backup-$(date +%F).sql.gz
```

on a nightly cron, shipped off-host (S3, another machine, etc.), and
periodically snapshot or rsync the `images` volume too.

## Local development

You'll need a local Postgres (or run just the `db` service via
`docker compose up db`) and a `.env` with `DATABASE_URL` pointed at it.
Then:

```bash
npm install
npm run migrate   # applies schema.sql, seeds the first admin
npm start
```

The app expects `IMAGES_DIR` to be writable; it defaults to `/data/images`
which you'll want to override locally (e.g. `./data/images`).
