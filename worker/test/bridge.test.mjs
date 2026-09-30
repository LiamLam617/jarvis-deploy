import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { handleP04Request, handleQueue } from "../src/bridge.mjs";
import { signInternalRequest, verifyInternalRequest } from "../src/security.mjs";

const encoder = new TextEncoder();
const NOW = 1_800_000_000_000;
const DISCORD_TOKEN = "test-only-discord-interaction-token";
const INTERNAL_SECRET = "test-only-internal-secret-with-adequate-entropy";
const GUILD = "1488116208426287247";
const JARVIS_CHANNEL = "1553710999444529233";
const INBOX_CHANNEL = "1553711115433938945";
const USER = "249763790709719040";
const APPLICATION = "1511992826815053844";
let sequence = 1;

const discordKeys = await webcrypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
const publicKey = Buffer.from(await webcrypto.subtle.exportKey("raw", discordKeys.publicKey)).toString("hex");

function createD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../migrations/0001_create_p04_job_ledger.sql", import.meta.url), "utf8"));
  return {
    sqlite,
    prepare(sql) {
      let values = [];
      const statement = sqlite.prepare(sql);
      return {
        bind(...args) { values = args; return this; },
        async run() { return { meta: { changes: statement.run(...values).changes } }; },
        async first() { return statement.get(...values) ?? null; },
        async all() { return { results: statement.all(...values) }; },
      };
    },
  };
}

function createEnv(overrides = {}) {
  const sentBatches = [];
  const env = {
    DISCORD_PUBLIC_KEY: publicKey,
    DISCORD_GUILD_ID: GUILD,
    DISCORD_JARVIS_CHANNEL_ID: JARVIS_CHANNEL,
    DISCORD_INBOX_CHANNEL_ID: INBOX_CHANNEL,
    DISCORD_ALLOWED_USER_ID: USER,
    DISCORD_APPLICATION_ID: APPLICATION,
    BRIDGE_ENABLED: "1",
    JARVIS_REPLY_ENCRYPTION_KEY: Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString("base64"),
    JARVIS_INTERNAL_SECRET: INTERNAL_SECRET,
    MODAL_DISPATCH_URL: "https://jarvis-runtime--dispatch.modal.run/dispatch",
    DB: createD1(),
    JOBS: { async sendBatch(messages) { sentBatches.push(messages); } },
    ...overrides,
  };
  return { env, sentBatches };
}

function interaction(name = "jarvis", overrides = {}) {
  const id = `${1_800_000_000_000_000_000n + BigInt(sequence++)}`;
  const optionName = name === "capture" ? "url" : "prompt";
  return {
    id,
    application_id: APPLICATION,
    type: 2,
    guild_id: GUILD,
    channel_id: name === "capture" ? INBOX_CHANNEL : JARVIS_CHANNEL,
    member: { user: { id: USER } },
    token: DISCORD_TOKEN,
    data: { name, options: [{ name: optionName, type: 3, value: name === "capture" ? "https://example.com/source" : "private test prompt" }] },
    ...overrides,
  };
}

async function discordRequest(payload, { badSignature = false } = {}) {
  const body = JSON.stringify(payload);
  const timestamp = "1800000000";
  const signature = Buffer.from(await webcrypto.subtle.sign("Ed25519", discordKeys.privateKey, encoder.encode(timestamp + body))).toString("hex");
  return new Request("https://worker.example/", {
    method: "POST",
    body,
    headers: {
      "x-signature-ed25519": badSignature ? "00".repeat(64) : signature,
      "x-signature-timestamp": timestamp,
    },
  });
}

async function internalRequest(path, payload, { secret = INTERNAL_SECRET, badSignature = false, now = NOW } = {}) {
  const body = encoder.encode(JSON.stringify(payload));
  const timestamp = String(Math.floor(now / 1000));
  const signed = await signInternalRequest(path, body, secret, timestamp);
  return new Request(`https://worker.example${path}`, {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "x-jarvis-timestamp": signed.timestamp,
      "x-jarvis-signature": badSignature ? "00".repeat(32) : signed.signature,
    },
  });
}

async function submit(env, value = interaction(), overrides = {}) {
  const scheduled = [];
  const response = await handleP04Request(await discordRequest(value, overrides), env, {
    now: () => NOW,
    waitUntil(promise) { scheduled.push(promise); },
  });
  await Promise.all(scheduled);
  return response;
}

function queueMessage(body) {
  const state = { acked: false, retried: false, retryOptions: null };
  return {
    state,
    body,
    ack() { state.acked = true; },
    retry(options) { state.retried = true; state.retryOptions = options; },
  };
}

test("acceptance persists encrypted reply token and sends only event IDs to Queue", async () => {
  const { env, sentBatches } = createEnv();
  const value = interaction();
  const response = await submit(env, value);
  const body = await response.json();
  const row = env.DB.sqlite.prepare("SELECT * FROM jarvis_jobs WHERE interaction_id = ?").get(value.id);

  assert.equal(body.type, 5);
  assert.equal(body.data.flags, 64);
  assert.equal(row.dispatch_state, "QUEUED");
  assert.equal(row.reply_state, "DEFERRED");
  assert.notEqual(row.reply_token_ciphertext, DISCORD_TOKEN);
  assert.equal(row.reply_token_nonce.length > 0, true);
  assert.equal(row.payload_json, JSON.stringify({ prompt: "private test prompt" }));
  assert.equal(sentBatches.length, 1);
  assert.deepEqual(sentBatches[0].map((item) => item.body), [
    { schema_version: 1, kind: "run", event_id: value.id },
    { schema_version: 1, kind: "expire", event_id: value.id },
  ]);
  assert.deepEqual(sentBatches[0].map((item) => item.delaySeconds), [2, 900]);
  assert.equal(JSON.stringify(sentBatches).includes("private test prompt"), false);
  assert.equal(JSON.stringify(sentBatches).includes(DISCORD_TOKEN), false);
});

test("deferred acknowledgement does not wait for Queue network completion", async () => {
  const { env } = createEnv();
  let releaseQueue;
  let background;
  env.JOBS.sendBatch = () => new Promise((resolve) => { releaseQueue = resolve; });
  const value = interaction();
  const response = await handleP04Request(await discordRequest(value), env, {
    now: () => NOW,
    waitUntil(promise) { background = promise; },
  });

  assert.equal((await response.json()).type, 5);
  assert.equal(typeof releaseQueue, "function");
  assert.equal(typeof background?.then, "function");
  assert.equal(env.DB.sqlite.prepare("SELECT reply_state FROM jarvis_jobs WHERE interaction_id = ?").get(value.id).reply_state, "DEFERRED");
  releaseQueue();
  await background;
});

test("duplicate Discord interaction is idempotent and does not enqueue twice", async () => {
  const { env, sentBatches } = createEnv();
  const value = interaction("capture");
  const first = await submit(env, value);
  const second = await submit(env, value);

  assert.equal((await first.json()).type, 5);
  assert.equal((await second.json()).type, 5);
  assert.equal(env.DB.sqlite.prepare("SELECT count(*) AS n FROM jarvis_jobs").get().n, 1);
  assert.equal(sentBatches.length, 1);
});

test("invalid signature and unauthorized identity never write or enqueue", async () => {
  const { env, sentBatches } = createEnv();
  const invalid = await submit(env, interaction(), { badSignature: true });
  assert.equal(invalid.status, 401);

  const unauthorized = await submit(env, interaction("jarvis", { member: { user: { id: "249763790709719041" } } }));
  assert.equal((await unauthorized.json()).type, 4);
  assert.equal(env.DB.sqlite.prepare("SELECT count(*) AS n FROM jarvis_jobs").get().n, 0);
  assert.equal(sentBatches.length, 0);
});

test("D1 insert failure never sends a Queue message", async () => {
  const { env, sentBatches } = createEnv();
  const originalPrepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => sql.startsWith("INSERT OR IGNORE")
    ? { bind() { return { async run() { throw new Error("injected D1 write failure"); } }; } }
    : originalPrepare(sql);

  const response = await submit(env, interaction());
  assert.equal((await response.json()).type, 4);
  assert.equal(sentBatches.length, 0);
});

test("uncertain Queue send remains recoverable through /status with the stable event ID", async () => {
  const { env, sentBatches } = createEnv();
  let attempt = 0;
  env.JOBS.sendBatch = async (messages) => {
    sentBatches.push(messages);
    attempt += 1;
    if (attempt === 1) throw new Error("accepted by queue but response was lost");
  };
  const value = interaction();
  const accepted = await submit(env, value);
  assert.equal((await accepted.json()).type, 5);
  assert.equal(env.DB.sqlite.prepare("SELECT dispatch_state FROM jarvis_jobs WHERE interaction_id = ?").get(value.id).dispatch_state, "NEEDS_RECONCILIATION");

  const status = await submit(env, interaction("status"));
  const statusBody = await status.json();
  assert.equal(statusBody.type, 4);
  assert.match(statusBody.data.content, /重新排入/);
  assert.equal(env.DB.sqlite.prepare("SELECT dispatch_state FROM jarvis_jobs WHERE interaction_id = ?").get(value.id).dispatch_state, "QUEUED");
  assert.deepEqual(sentBatches.map((batch) => batch[0].body.event_id), [value.id, value.id]);
});

test("/status recovers an ENQUEUEING row after its lease expires", async () => {
  const { env, sentBatches } = createEnv();
  const originalPrepare = env.DB.prepare.bind(env.DB);
  env.JOBS.sendBatch = async (messages) => { sentBatches.push(messages); };
  env.DB.prepare = (sql) => {
    const normalized = sql.replace(/\s+/g, " ");
    if (normalized.includes("dispatch_state = CASE WHEN dispatch_state = 'ENQUEUEING'")) {
      return { bind() { return { async run() { throw new Error("injected queued-state D1 failure"); } }; } };
    }
    if (normalized.includes("dispatch_state = 'NEEDS_RECONCILIATION'")) {
      return { bind() { return { async run() { throw new Error("injected reconciliation D1 failure"); } }; } };
    }
    return originalPrepare(sql);
  };

  const value = interaction();
  const accepted = await submit(env, value);
  assert.equal((await accepted.json()).type, 5);
  const stuck = env.DB.sqlite.prepare("SELECT dispatch_state, enqueue_lease_until_ms FROM jarvis_jobs WHERE interaction_id = ?").get(value.id);
  assert.equal(stuck.dispatch_state, "ENQUEUEING");
  assert.equal(stuck.enqueue_lease_until_ms, NOW + 30_000);
  assert.equal(sentBatches.length, 1);

  env.DB.prepare = originalPrepare;
  const statusInteraction = interaction("status");
  const statusResponse = await handleP04Request(await discordRequest(statusInteraction), env, { now: () => NOW + 31_000 });
  assert.match((await statusResponse.json()).data.content, /重新排入/);
  assert.equal(env.DB.sqlite.prepare("SELECT dispatch_state FROM jarvis_jobs WHERE interaction_id = ?").get(value.id).dispatch_state, "QUEUED");
  assert.equal(sentBatches.length, 2);
  assert.equal(sentBatches[0][0].body.event_id, sentBatches[1][0].body.event_id);
});

test("Queue dispatch records Modal call ID and retries transient Modal errors", async () => {
  const { env, sentBatches } = createEnv();
  const value = interaction();
  await submit(env, value);
  const runBody = sentBatches[0][0].body;
  const failed = queueMessage(runBody);
  await handleQueue({ messages: [failed] }, env, {
    now: () => NOW,
    fetchImpl: async () => Response.json({ error: "temporary" }, { status: 503 }),
  });
  assert.equal(failed.state.retried, true);
  assert.deepEqual(failed.state.retryOptions, { delaySeconds: 30 });

  const delivered = queueMessage(runBody);
  let callCount = 0;
  await handleQueue({ messages: [delivered] }, env, {
    now: () => NOW,
    fetchImpl: async (url, init) => {
      callCount += 1;
      assert.equal(url.pathname, "/dispatch");
      assert.equal(init.method, "POST");
      const raw = encoder.encode(init.body);
      assert.equal(await verifyInternalRequest(new Request(url, { method: "POST", headers: init.headers }), raw, INTERNAL_SECRET, NOW), true);
      return Response.json({ call_id: "fc-test-call" });
    },
  });
  assert.equal(delivered.state.acked, true);
  assert.equal(callCount, 1);
  const row = env.DB.sqlite.prepare("SELECT dispatch_state, modal_call_id FROM jarvis_jobs WHERE interaction_id = ?").get(value.id);
  assert.equal(row.dispatch_state, "DISPATCHED");
  assert.equal(row.modal_call_id, "fc-test-call");
});

test("internal claim rejects forged requests and competing run IDs", async () => {
  const { env, sentBatches } = createEnv();
  const value = interaction();
  await submit(env, value);
  const runMessage = queueMessage(sentBatches[0][0].body);
  await handleQueue({ messages: [runMessage] }, env, {
    now: () => NOW,
    fetchImpl: async () => Response.json({ call_id: "fc-test-call" }),
  });

  const firstRun = "123e4567-e89b-42d3-a456-426614174000";
  const bad = await handleP04Request(await internalRequest("/internal/claim", { event_id: value.id, run_id: firstRun }, { badSignature: true }), env, { now: () => NOW });
  assert.equal(bad.status, 401);
  assert.equal(env.DB.sqlite.prepare("SELECT dispatch_state FROM jarvis_jobs WHERE interaction_id = ?").get(value.id).dispatch_state, "DISPATCHED");
  const stale = await handleP04Request(await internalRequest("/internal/claim", { event_id: value.id, run_id: firstRun }, { now: NOW - 6 * 60 * 1000 }), env, { now: () => NOW });
  assert.equal(stale.status, 401);

  const claim = await handleP04Request(await internalRequest("/internal/claim", { event_id: value.id, run_id: firstRun }), env, { now: () => NOW });
  assert.equal(claim.status, 200);
  const claimBody = await claim.json();
  assert.equal(claimBody.command, "jarvis");
  assert.equal(Object.hasOwn(claimBody, "payload"), false);
  assert.equal(JSON.stringify(claimBody).includes("private test prompt"), false);
  const competing = await handleP04Request(await internalRequest("/internal/claim", { event_id: value.id, run_id: "223e4567-e89b-42d3-a456-426614174000" }), env, { now: () => NOW });
  assert.equal(competing.status, 409);
});

test("completion edits one ephemeral original, clears secrets and is safe to repeat", async () => {
  const { env, sentBatches } = createEnv();
  const value = interaction();
  await submit(env, value);
  await handleQueue({ messages: [queueMessage(sentBatches[0][0].body)] }, env, {
    now: () => NOW,
    fetchImpl: async () => Response.json({ call_id: "fc-test-call" }),
  });
  const runId = "123e4567-e89b-42d3-a456-426614174000";
  await handleP04Request(await internalRequest("/internal/claim", { event_id: value.id, run_id: runId }), env, { now: () => NOW });

  const calls = [];
  const completeRequest = () => internalRequest("/internal/complete", {
    event_id: value.id,
    run_id: runId,
    result: "P04 固定回覆：Queue 與 Modal 派發已完成；Hermes 尚未接入。",
  });
  const complete = await handleP04Request(await completeRequest(), env, {
    now: () => NOW,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response("{}", { status: 200 });
    },
  });
  assert.equal(complete.status, 200);
  assert.equal((await complete.json()).reply_state, "DELIVERED");
  const row = env.DB.sqlite.prepare("SELECT dispatch_state, reply_state, payload_json, reply_token_ciphertext, reply_token_nonce FROM jarvis_jobs WHERE interaction_id = ?").get(value.id);
  assert.equal(row.dispatch_state, "SUCCEEDED");
  assert.equal(row.reply_state, "DELIVERED");
  assert.equal(row.payload_json, "{}");
  assert.equal(row.reply_token_ciphertext, null);
  assert.equal(row.reply_token_nonce, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.includes(DISCORD_TOKEN), true);
  assert.equal(calls[0].init.method, "PATCH");

  const repeated = await handleP04Request(await completeRequest(), env, {
    now: () => NOW,
    fetchImpl: async () => { throw new Error("already-delivered response must not be patched again"); },
  });
  assert.equal((await repeated.json()).reply_state, "DELIVERED");
});

test("Discord 503 preserves result for retry; expired token is never called", async () => {
  const { env, sentBatches } = createEnv();
  const value = interaction();
  await submit(env, value);
  await handleQueue({ messages: [queueMessage(sentBatches[0][0].body)] }, env, {
    now: () => NOW,
    fetchImpl: async () => Response.json({ call_id: "fc-test-call" }),
  });
  const runId = "123e4567-e89b-42d3-a456-426614174000";
  await handleP04Request(await internalRequest("/internal/claim", { event_id: value.id, run_id: runId }), env, { now: () => NOW });
  const payload = {
    event_id: value.id,
    run_id: runId,
    result: "P04 固定回覆：Queue 與 Modal 派發已完成；Hermes 尚未接入。",
  };
  const first = await handleP04Request(await internalRequest("/internal/complete", payload), env, {
    now: () => NOW,
    fetchImpl: async () => new Response("retry", { status: 503 }),
  });
  assert.equal(first.status, 503);
  assert.equal(env.DB.sqlite.prepare("SELECT dispatch_state, reply_state FROM jarvis_jobs WHERE interaction_id = ?").get(value.id).dispatch_state, "SUCCEEDED");

  let fetchCount = 0;
  const retry = await handleP04Request(await internalRequest("/internal/complete", payload), env, {
    now: () => NOW,
    fetchImpl: async () => { fetchCount += 1; return new Response("{}", { status: 200 }); },
  });
  assert.equal((await retry.json()).reply_state, "DELIVERED");
  assert.equal(fetchCount, 1);

  const capture = interaction("capture");
  await submit(env, capture);
  const expiryMessage = queueMessage(sentBatches[1][1].body);
  await handleQueue({ messages: [expiryMessage] }, env, {
    now: () => NOW + 901_000,
    fetchImpl: async () => { throw new Error("expired token must not be used"); },
  });
  assert.equal(expiryMessage.state.acked, true);
  const expired = env.DB.sqlite.prepare("SELECT dispatch_state, reply_state, reply_token_ciphertext FROM jarvis_jobs WHERE interaction_id = ?").get(capture.id);
  assert.equal(expired.reply_state, "EXPIRED");
  assert.equal(expired.reply_token_ciphertext, null);
});
