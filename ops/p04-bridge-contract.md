# P04 Bridge Contract

Status: Local contract, implementation, and tests are complete. P04 is blocked on explicit approval for remote resource writes, the remote D1 migration, Preview binding updates, and the production Worker deployment needed to activate the Queue consumer. No P04 remote change has been performed.

## Scope

P04 connects the existing Discord endpoint to the existing `jarvis-jobs` Queue, the existing empty `jarvis-control` D1 database, and a Modal receiver/runner that returns a fixed non-model result. Hermes, model calls, Wiki writes, Volume creation, Cron, and switching the Discord Endpoint away from the P03 Preview remain out of scope.

## Cloudflare Preview boundary

Cloudflare Worker Previews can publish to a Queue but cannot consume from one. Therefore the existing `p03` Preview will handle Discord ingress and publish to the existing Queue, while the production `jarvis-ingress` Worker deployment must register the single Queue consumer. Both environments bind the existing D1 and Queue IDs, so P04 test rows/messages are real shared-resource writes. Production uses `P04_QUEUE_ONLY=1` to keep its currently observed HTTP response (`Hello World!`) while only its Queue handler processes P04 messages. Discord's Interactions Endpoint remains on the existing Preview URL. Uploading and deploying the consumer version still changes the production Worker version at 100%, and is a separate P04 approval item; no such change has been made.

## Event and session keys

- `event_id` and idempotency key: Discord interaction ID, stored as a string.
- `correlation_id`: the same interaction ID for P04; no extra identifier is needed to correlate one interaction across D1, Queue, Modal, and the Discord callback.
- `session_key`: `guild_id:channel_id:user_id`, with every snowflake kept as a string. `#jarvis` and `#inbox` therefore remain separate sessions.
- Accepted commands: `/jarvis` with `prompt` and `/capture` with `url`. `/status` reads D1 and never calls Modal or a model; when it finds a recoverable outbox row, it may re-send the same `event_id` to Queue.
- Queue messages contain only `schema_version`, `kind`, and `event_id`; they never contain user text, URLs, Discord interaction tokens, or credentials.

## Reply credential and retention

- The Worker stores the interaction token in D1 only as AES-256-GCM ciphertext, using a random 96-bit nonce and authenticated additional data derived from the interaction, Guild, Channel, and User IDs.
- The 32-byte encryption key is a Cloudflare Worker secret. Only Worker code decrypts the token; the Queue and Modal never receive it. The Discord Bot Token is not used for interaction replies.
- The Worker stores the Discord expiry time (receipt time + 15 minutes). It clears ciphertext after a successful original-response edit and when an `expire` Queue message arrives after 900 seconds. `/status` and queue processing also opportunistically clear expired ciphertext. Expired tokens are never used for a Discord request.
- No token, ciphertext, key, prompt, URL, or full request body is written to logs. D1 stores only the command and its bounded option while the job is active; payload and result are cleared after delivery or expiry.

## State and failure handling

`dispatch_state`: `DISPATCH_PENDING -> ENQUEUEING -> QUEUED -> DISPATCHED -> RUNNING -> SUCCEEDED | FAILED | EXPIRED | NEEDS_RECONCILIATION`.

`reply_state`: `PENDING -> DEFERRED -> DELIVERED | DELIVERY_FAILED | EXPIRED`.

D1 insert and Queue send are separate operations. The D1 row is the outbox record. Queue sending uses a bounded lease; an uncertain send remains discoverable as `NEEDS_RECONCILIATION`. `/status` can re-send the stable `event_id` for a pending job. A repeated event or Queue message cannot create a second D1 row. Before producing any result, the Modal runner must claim the event in D1 through the authenticated Worker callback. A second `run_id` cannot claim a live lease; a Modal retry of the same call uses the same `run_id`. A crash after the side-effect boundary is marked `NEEDS_RECONCILIATION`; P04 itself has no external side effect beyond editing the same Discord response.

The signed interaction handler writes the D1 outbox row and returns its deferred ephemeral acknowledgement without waiting for Queue network I/O; it schedules enqueue work with the Worker `waitUntil` lifecycle hook. The initial run message has a two-second delay so the acknowledgement can reach Discord before Modal starts. If enqueue is uncertain, the stable outbox row remains visible to `/status` recovery. The Queue consumer acknowledges a run message only after the Modal receiver confirms the spawned function call and the call ID has been recorded, or after a terminal/duplicate state is confirmed. Network, 429, and server errors retry with finite limits and then route to the existing dead-letter Queue. A 401/403 is recorded as a dispatch failure and is not retried indefinitely.

## Internal request contract

- Modal receiver accepts only `POST /dispatch`; it validates a timestamped HMAC over the exact raw body and route, rejects timestamps outside a five-minute window, and calls `run_job.spawn(event_id, run_id)`. HMAC timestamps do not provide a nonce-based anti-replay guarantee; repeated dispatches can create redundant runner invocations, while the D1 claim lease prevents a competing run ID from acquiring an active job and P04 has no side effect beyond editing the same original Discord response.
- Modal runner calls authenticated Worker routes `/internal/claim`, `/internal/complete`, and `/internal/fail`. The Worker validates the same HMAC contract and the event/claim state before any update.
- The runner receives only event ID, command, run ID, and expiry metadata from the claim route; the prompt/URL remains in D1 and is not sent to Modal in P04. It returns only the P04 fixed result. It cannot read D1 directly, access Discord tokens, or write the Wiki.
- Worker edits the deferred ephemeral original response with Discord's interaction webhook and `allowed_mentions: {parse: []}`. The result is idempotent: a retry edits the same original response and never creates another public message.

## Limits to implement and verify

- Queue: one-message batches, one consumer at a time, 3 retries, 30-second retry delay, existing `jarvis-dead-letter` DLQ.
- Modal runner: minimum 0, maximum 1 container, 300-second function timeout, no GPU, and at most one active job. The HTTP receiver only accepts and spawns; it does not wait for the runner.
- Discord initial response: ephemeral deferred response; the request handler does not wait for Queue network I/O or the Modal result. `/status` reads D1; only when an outbox row needs recovery does it also re-send the stable event ID to Queue.
- All of these are local intended settings until remote P04 authorization, deployment, and readback.

## P04 fault matrix

| Failure | Expected handling | Evidence still required |
|---|---|---|
| Duplicate interaction ID | Return the existing acknowledgement/state; only one D1 row | Local and live duplicate test |
| D1 insert failure | Do not enqueue; return a safe ephemeral error | Local fault injection |
| Queue send fails before/after acceptance | Keep a recoverable outbox state; stable event ID and runner claim prevent duplicate execution | Local ambiguous-send test and controlled remote retry test |
| Modal returns 429/5xx or receiver is unreachable | Queue retry; after retry limit, message goes to DLQ | Local failure injection and remote readback |
| Modal accepted a spawn but HTTP response was lost | Queue may redeliver; a different `run_id` cannot take an active claim | Local duplicate-spawn test |
| Runner fails before completion | Authenticated fail callback; otherwise lease expiry becomes visible to `/status` and can be reconciled | Local failure injection and remote test |
| Discord edit fails or rate-limits | Preserve result and retry a bounded number of times; record `DELIVERY_FAILED` if exhausted; never rerun work | Local mocked Discord responses and remote controlled test |
| Interaction token expires | Clear ciphertext and mark reply `EXPIRED`; never call Discord with expired token | Local clock injection and delayed cleanup test |
| Internal request has bad or stale HMAC | Reject before D1 mutation or spawn; valid duplicate dispatches remain bounded by stable event ID and D1 claim state | Local forged/stale signature and competing-claim tests; no nonce-based anti-replay claim |

P04 cannot be marked passed from local tests alone. The guide also requires real Discord deferred/result delivery, duplicate-event behavior, dispatch-loss handling, Modal failure/retry handling, and durable job/reply state evidence.
