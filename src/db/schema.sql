-- Cardbox schema. Applied once at startup by src/db/migrate.js (idempotent, uses IF NOT EXISTS).

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- fast fuzzy/ILIKE search on name/company

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL DEFAULT 'editor' CHECK (role IN ('admin', 'editor', 'viewer')),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- connect-pg-simple's session store expects this exact shape.
CREATE TABLE IF NOT EXISTS session (
  sid    varchar NOT NULL COLLATE "default" PRIMARY KEY,
  sess   json NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_expire ON session (expire);

CREATE TABLE IF NOT EXISTS cards (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,                    -- soft delete
  name           text NOT NULL DEFAULT '',
  designation    text NOT NULL DEFAULT '',
  company        text NOT NULL DEFAULT '',
  phones         text[] NOT NULL DEFAULT '{}',
  emails         text[] NOT NULL DEFAULT '{}',
  website        text NOT NULL DEFAULT '',
  address        text NOT NULL DEFAULT '',
  notes          text NOT NULL DEFAULT '',
  engine_used    text NOT NULL DEFAULT 'manual', -- gemini | tesseract | manual
  front_image    text,                            -- filename under the images volume
  back_image     text,
  share_slug     text UNIQUE,                     -- set when the digital card is made public
  share_enabled  boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_cards_not_deleted ON cards (created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cards_name_trgm ON cards USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_cards_company_trgm ON cards USING gin (company gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_cards_phones ON cards USING gin (phones);
CREATE INDEX IF NOT EXISTS idx_cards_emails ON cards USING gin (emails);

CREATE TABLE IF NOT EXISTS comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id    uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  author_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comments_card ON comments (card_id, created_at);

CREATE TABLE IF NOT EXISTS settings (
  key        text PRIMARY KEY,
  value      text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  action     text NOT NULL,
  target     text,
  meta       jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at DESC);
