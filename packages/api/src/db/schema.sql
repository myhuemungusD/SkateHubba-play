-- SkateHubba Postgres Schema
-- Mirrors the Firestore data model with relational integrity
-- Phase 1: standalone — no Firestore dependency

BEGIN;

-- ---------------------------------------------------------------------------
-- EXTENSIONS
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";     -- case-insensitive usernames

-- ---------------------------------------------------------------------------
-- TYPES
-- ---------------------------------------------------------------------------
CREATE TYPE game_status AS ENUM ('active', 'complete', 'forfeit');
CREATE TYPE game_phase  AS ENUM ('setting', 'matching');
CREATE TYPE notification_type AS ENUM ('your_turn', 'new_challenge', 'game_won', 'game_lost');

-- ---------------------------------------------------------------------------
-- USERS
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  uid            TEXT PRIMARY KEY,                        -- Firebase Auth UID (kept for migration path)
  username       CITEXT NOT NULL UNIQUE
                   CHECK (length(username) BETWEEN 3 AND 20)
                   CHECK (username ~ '^[a-z0-9_]+$'),
  stance         TEXT NOT NULL,
  email_verified BOOLEAN NOT NULL DEFAULT false,
  dob            DATE,                                   -- COPPA/CCPA
  parental_consent BOOLEAN,
  wins           INTEGER NOT NULL DEFAULT 0 CHECK (wins >= 0),
  losses         INTEGER NOT NULL DEFAULT 0 CHECK (losses >= 0),
  last_stats_game_id TEXT,                               -- idempotency key for stats updates
  last_game_created_at TIMESTAMPTZ,                      -- rate limiting
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for leaderboard queries (wins DESC)
CREATE INDEX idx_users_wins ON users (wins DESC);

-- ---------------------------------------------------------------------------
-- FCM TOKENS  (1-to-many from users)
-- ---------------------------------------------------------------------------
CREATE TABLE fcm_tokens (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  uid        TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  token      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (uid, token)
);

-- ---------------------------------------------------------------------------
-- GAMES
-- ---------------------------------------------------------------------------
CREATE TABLE games (
  id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  player1_uid             TEXT NOT NULL REFERENCES users(uid),
  player2_uid             TEXT NOT NULL REFERENCES users(uid),
  player1_username        TEXT NOT NULL,                  -- denormalized snapshot
  player2_username        TEXT NOT NULL,                  -- denormalized snapshot
  p1_letters              INTEGER NOT NULL DEFAULT 0 CHECK (p1_letters BETWEEN 0 AND 5),
  p2_letters              INTEGER NOT NULL DEFAULT 0 CHECK (p2_letters BETWEEN 0 AND 5),
  status                  game_status NOT NULL DEFAULT 'active',
  current_turn            TEXT NOT NULL,                  -- uid of player whose turn it is
  phase                   game_phase NOT NULL DEFAULT 'setting',
  current_setter          TEXT NOT NULL,                  -- uid of player setting the trick
  current_trick_name      TEXT,
  current_trick_video_url TEXT,
  match_video_url         TEXT,
  turn_deadline           TIMESTAMPTZ NOT NULL,
  turn_number             INTEGER NOT NULL DEFAULT 1 CHECK (turn_number >= 1),
  winner                  TEXT,                           -- uid or null
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Invariants
  CONSTRAINT no_self_challenge CHECK (player1_uid <> player2_uid),
  CONSTRAINT turn_is_player    CHECK (current_turn IN (player1_uid, player2_uid)),
  CONSTRAINT setter_is_player  CHECK (current_setter IN (player1_uid, player2_uid)),
  CONSTRAINT winner_is_player  CHECK (winner IS NULL OR winner IN (player1_uid, player2_uid))
);

-- Indexes for "my games" queries
CREATE INDEX idx_games_player1 ON games (player1_uid, status);
CREATE INDEX idx_games_player2 ON games (player2_uid, status);

-- ---------------------------------------------------------------------------
-- TURN HISTORY  (1-to-many from games — replaces Firestore arrayUnion)
-- ---------------------------------------------------------------------------
CREATE TABLE turn_history (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  game_id          TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  turn_number      INTEGER NOT NULL CHECK (turn_number >= 1),
  trick_name       TEXT NOT NULL,
  setter_uid       TEXT NOT NULL,
  setter_username  TEXT NOT NULL,
  matcher_uid      TEXT NOT NULL,
  matcher_username TEXT NOT NULL,
  set_video_url    TEXT,
  match_video_url  TEXT,
  landed           BOOLEAN NOT NULL,
  letter_to        TEXT,                                 -- uid who got the letter, or null
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (game_id, turn_number)
);

-- ---------------------------------------------------------------------------
-- NOTIFICATIONS
-- ---------------------------------------------------------------------------
CREATE TABLE notifications (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  recipient_uid  TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  type           notification_type NOT NULL,
  title          TEXT NOT NULL,
  body           TEXT NOT NULL,
  game_id        TEXT REFERENCES games(id) ON DELETE SET NULL,
  read           BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_recipient ON notifications (recipient_uid, read, created_at DESC);

-- ---------------------------------------------------------------------------
-- NUDGES
-- ---------------------------------------------------------------------------
CREATE TABLE nudges (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  sender_uid       TEXT NOT NULL REFERENCES users(uid),
  sender_username  TEXT NOT NULL,
  recipient_uid    TEXT NOT NULL REFERENCES users(uid),
  game_id          TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  delivered        BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- NUDGE RATE LIMITS  (replaces nudge_limits collection)
-- ---------------------------------------------------------------------------
CREATE TABLE nudge_limits (
  sender_uid    TEXT NOT NULL REFERENCES users(uid),
  game_id       TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  last_nudged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (sender_uid, game_id)
);

-- ---------------------------------------------------------------------------
-- updated_at trigger helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_games_updated_at
  BEFORE UPDATE ON games
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
