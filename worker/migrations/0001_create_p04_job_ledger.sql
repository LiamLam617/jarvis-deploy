CREATE TABLE IF NOT EXISTS jarvis_jobs (
  interaction_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  correlation_id TEXT NOT NULL UNIQUE,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  command TEXT NOT NULL CHECK (command IN ('jarvis', 'capture')),
  session_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  received_at_ms INTEGER NOT NULL,
  reply_expires_at_ms INTEGER NOT NULL,
  reply_token_ciphertext TEXT,
  reply_token_nonce TEXT,
  dispatch_state TEXT NOT NULL CHECK (dispatch_state IN (
    'DISPATCH_PENDING', 'ENQUEUEING', 'QUEUED', 'DISPATCHED', 'RUNNING',
    'SUCCEEDED', 'FAILED', 'EXPIRED', 'NEEDS_RECONCILIATION'
  )),
  reply_state TEXT NOT NULL CHECK (reply_state IN (
    'PENDING', 'DEFERRED', 'DELIVERED', 'DELIVERY_FAILED', 'EXPIRED'
  )),
  enqueue_lease_until_ms INTEGER,
  claim_run_id TEXT,
  claim_lease_until_ms INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  modal_call_id TEXT,
  result_content TEXT,
  last_error_code TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jarvis_jobs_session_recent
  ON jarvis_jobs (guild_id, channel_id, user_id, received_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_jarvis_jobs_recovery
  ON jarvis_jobs (dispatch_state, enqueue_lease_until_ms, received_at_ms);

CREATE INDEX IF NOT EXISTS idx_jarvis_jobs_expiry
  ON jarvis_jobs (reply_state, reply_expires_at_ms);
