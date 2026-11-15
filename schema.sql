-- MIFASA learning store (Cloudflare D1).  Create once:  wrangler d1 execute <DB_NAME> --file=schema.sql
CREATE TABLE IF NOT EXISTS learned (
  id           TEXT PRIMARY KEY,           -- same id the browser computes (hash of lang + normalised question)
  lang         TEXT NOT NULL,              -- language the user wrote in: rw | en
  q_raw        TEXT NOT NULL,              -- what the user typed (the browser never sends private questions)
  q_norm       TEXT NOT NULL,              -- normalised question
  q_en         TEXT DEFAULT '',            -- the question in English (pivot)
  key_en       TEXT DEFAULT '',            -- normalised English pivot, used to match across languages
  understood   TEXT DEFAULT '',            -- how the external AI understood the question
  intent       TEXT DEFAULT '',
  answer       TEXT NOT NULL,
  answer_lang  TEXT NOT NULL,              -- language of `answer`
  answer_other TEXT DEFAULT '',            -- owner-approved translation of the answer (other language), optional
  grounded     INTEGER DEFAULT 0,          -- 1 = the external AI had MIFASA/web sources
  sources      TEXT DEFAULT '[]',          -- JSON
  status       TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  seen         INTEGER DEFAULT 1,          -- how many times people submitted this question
  helpful      INTEGER DEFAULT 0,
  unhelpful    INTEGER DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  reviewed_at  TEXT
);
CREATE INDEX IF NOT EXISTS learned_status ON learned(status, seen DESC);
CREATE INDEX IF NOT EXISTS learned_qnorm  ON learned(q_norm);
CREATE INDEX IF NOT EXISTS learned_keyen  ON learned(key_en);
CREATE TABLE IF NOT EXISTS learn_rate (   -- tiny per-visitor daily limit (the visitor is stored only as a salted hash)
  who TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (who, day)
);
