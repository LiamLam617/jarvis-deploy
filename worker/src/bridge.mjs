import {
  allowed,
  deferredResponse,
  discordResponse,
  option,
  verifyDiscordRequest,
  verifyInternalRequest,
} from "./security.mjs";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const TOKEN_TTL_MS = 15 * 60 * 1000;
const ENQUEUE_LEASE_MS = 30 * 1000;
const RUN_LEASE_MS = 11 * 60 * 1000;
const EXPIRY_DELAY_SECONDS = 15 * 60;
const RUN_START_DELAY_SECONDS = 2;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_PROMPT_LENGTH = 1200;
const MAX_URL_LENGTH = 2048;
const RETRY_DELAY_SECONDS = 30;
const STALE_DISPATCH_MS = 90 * 1000;
const DISCORD_API = "https://discord.com/api/v10";

const SQL = {
  get: `SELECT * FROM jarvis_jobs WHERE interaction_id = ?`,
  insert: `INSERT OR IGNORE INTO jarvis_jobs (
    interaction_id, schema_version, correlation_id, guild_id, channel_id, user_id,
    command, session_key, payload_json, received_at_ms, reply_expires_at_ms,
    reply_token_ciphertext, reply_token_nonce, dispatch_state, reply_state,
    created_at_ms, updated_at_ms
  ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DISPATCH_PENDING', 'DEFERRED', ?, ?)`,
  enqueueClaim: `UPDATE jarvis_jobs
    SET dispatch_state = 'ENQUEUEING', enqueue_lease_until_ms = ?, updated_at_ms = ?
    WHERE interaction_id = ? AND reply_expires_at_ms > ? AND (
      dispatch_state IN ('DISPATCH_PENDING', 'NEEDS_RECONCILIATION') OR
      (dispatch_state = 'ENQUEUEING' AND COALESCE(enqueue_lease_until_ms, 0) <= ?)
    )`,
  queued: `UPDATE jarvis_jobs SET dispatch_state = CASE WHEN dispatch_state = 'ENQUEUEING' THEN 'QUEUED' ELSE dispatch_state END,
      enqueue_lease_until_ms = NULL,
      reply_state = CASE WHEN reply_state = 'PENDING' THEN 'DEFERRED' ELSE reply_state END,
      updated_at_ms = ?
    WHERE interaction_id = ? AND dispatch_state NOT IN ('FAILED', 'EXPIRED')`,
  enqueueFailed: `UPDATE jarvis_jobs SET dispatch_state = 'NEEDS_RECONCILIATION',
      enqueue_lease_until_ms = NULL,
      reply_state = CASE WHEN reply_state = 'PENDING' THEN 'DEFERRED' ELSE reply_state END,
      last_error_code = ?, updated_at_ms = ?
    WHERE interaction_id = ? AND dispatch_state = 'ENQUEUEING'`,
  session: `SELECT interaction_id, command, dispatch_state, reply_state, received_at_ms,
      reply_expires_at_ms, attempt_count, enqueue_lease_until_ms, claim_lease_until_ms
    FROM jarvis_jobs WHERE guild_id = ? AND channel_id = ? AND user_id = ?
    ORDER BY received_at_ms DESC LIMIT 5`,
  cleanupExpired: `UPDATE jarvis_jobs SET
      reply_token_ciphertext = NULL, reply_token_nonce = NULL, reply_state = 'EXPIRED',
      dispatch_state = CASE WHEN dispatch_state IN ('SUCCEEDED', 'FAILED') THEN dispatch_state ELSE 'EXPIRED' END,
      payload_json = '{}', result_content = NULL, updated_at_ms = ?
    WHERE reply_state IN ('PENDING', 'DEFERRED', 'DELIVERY_FAILED') AND reply_expires_at_ms <= ?`,
  recoverStale: `UPDATE jarvis_jobs SET dispatch_state = 'NEEDS_RECONCILIATION',
      enqueue_lease_until_ms = NULL, last_error_code = 'RUN_LEASE_EXPIRED', updated_at_ms = ?
    WHERE guild_id = ? AND channel_id = ? AND user_id = ? AND reply_expires_at_ms > ? AND (
      (dispatch_state = 'RUNNING' AND COALESCE(claim_lease_until_ms, 0) <= ?) OR
      (dispatch_state = 'DISPATCHED' AND updated_at_ms <= ?)
    )`,
  claim: `UPDATE jarvis_jobs SET dispatch_state = 'RUNNING', claim_run_id = ?,
      claim_lease_until_ms = ?, attempt_count = attempt_count + 1, updated_at_ms = ?
    WHERE interaction_id = ? AND reply_expires_at_ms > ? AND (
      dispatch_state IN ('DISPATCH_PENDING', 'ENQUEUEING', 'QUEUED', 'DISPATCHED', 'NEEDS_RECONCILIATION') OR
      (dispatch_state = 'RUNNING' AND claim_run_id = ?) OR
      (dispatch_state = 'RUNNING' AND COALESCE(claim_lease_until_ms, 0) <= ?)
    )`,
  dispatched: `UPDATE jarvis_jobs SET dispatch_state = 'DISPATCHED', modal_call_id = ?, updated_at_ms = ?
    WHERE interaction_id = ? AND dispatch_state IN ('QUEUED', 'ENQUEUEING', 'DISPATCH_PENDING', 'NEEDS_RECONCILIATION')`,
  dispatchFailed: `UPDATE jarvis_jobs SET dispatch_state = 'FAILED', last_error_code = ?, updated_at_ms = ?
    WHERE interaction_id = ? AND dispatch_state NOT IN ('SUCCEEDED', 'FAILED', 'EXPIRED')`,
  setSucceeded: `UPDATE jarvis_jobs SET dispatch_state = 'SUCCEEDED', result_content = ?, updated_at_ms = ?
    WHERE interaction_id = ? AND dispatch_state = 'RUNNING' AND claim_run_id = ?`,
  deliveryFailed: `UPDATE jarvis_jobs SET reply_state = 'DELIVERY_FAILED', last_error_code = ?, updated_at_ms = ?
    WHERE interaction_id = ? AND reply_state != 'DELIVERED'`,
  delivered: `UPDATE jarvis_jobs SET reply_state = 'DELIVERED', reply_token_ciphertext = NULL,
      reply_token_nonce = NULL, payload_json = '{}', result_content = NULL, last_error_code = NULL, updated_at_ms = ?
    WHERE interaction_id = ?`,
  expired: `UPDATE jarvis_jobs SET dispatch_state = CASE
      WHEN dispatch_state IN ('SUCCEEDED', 'FAILED') THEN dispatch_state ELSE 'EXPIRED' END,
      reply_state = 'EXPIRED', reply_token_ciphertext = NULL, reply_token_nonce = NULL,
      payload_json = '{}', result_content = NULL, updated_at_ms = ?
    WHERE interaction_id = ? AND reply_state != 'DELIVERED'`,
  fail: `UPDATE jarvis_jobs SET dispatch_state = 'FAILED', last_error_code = ?, updated_at_ms = ?
    WHERE interaction_id = ? AND dispatch_state = 'RUNNING' AND claim_run_id = ?`,
};

function changed(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

async function getJob(db, eventId) {
  return db.prepare(SQL.get).bind(eventId).first();
}

async function clearExpired(db, now) {
  await db.prepare(SQL.cleanupExpired).bind(now, now).run();
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function encryptionKey(secret) {
  const raw = base64ToBytes(secret);
  if (!raw || raw.byteLength !== 32) throw new Error("INVALID_REPLY_ENCRYPTION_KEY");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function tokenAad(job) {
  return encoder.encode(`${job.interaction_id}|${job.guild_id}|${job.channel_id}|${job.user_id}|${job.reply_expires_at_ms}`);
}

async function encryptToken(token, secret, job) {
  const key = await encryptionKey(secret);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: tokenAad(job) },
    key,
    encoder.encode(token),
  );
  return { ciphertext: bytesToBase64(ciphertext), nonce: bytesToBase64(nonce) };
}

async function decryptToken(row, secret) {
  const key = await encryptionKey(secret);
  const ciphertext = base64ToBytes(row.reply_token_ciphertext);
  const nonce = base64ToBytes(row.reply_token_nonce);
  if (!ciphertext || !nonce || nonce.byteLength !== 12) throw new Error("INVALID_ENCRYPTED_REPLY_TOKEN");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce, additionalData: tokenAad(row) },
    key,
    ciphertext,
  );
  return decoder.decode(plaintext);
}

function validSnowflake(value) {
  return typeof value === "string" && /^\d{17,20}$/.test(value);
}

function queueRun(eventId) {
  return { schema_version: 1, kind: "run", event_id: eventId };
}

function queueExpiry(eventId) {
  return { schema_version: 1, kind: "expire", event_id: eventId };
}

async function enqueueInitial(env, eventId, db, now) {
  const lease = await db.prepare(SQL.enqueueClaim)
    .bind(now + ENQUEUE_LEASE_MS, now, eventId, now, now)
    .run();
  if (!changed(lease)) return { enqueued: false, row: await getJob(db, eventId) };

  try {
    await env.JOBS.sendBatch([
      { body: queueRun(eventId), delaySeconds: RUN_START_DELAY_SECONDS },
      { body: queueExpiry(eventId), delaySeconds: EXPIRY_DELAY_SECONDS },
    ]);
    await db.prepare(SQL.queued).bind(now, eventId).run();
    return { enqueued: true, row: await getJob(db, eventId) };
  } catch {
    await db.prepare(SQL.enqueueFailed).bind("QUEUE_SEND_UNCERTAIN", now, eventId).run();
    return { enqueued: false, uncertain: true, row: await getJob(db, eventId) };
  }
}

async function enqueueRecovery(env, eventId, db, now) {
  const lease = await db.prepare(SQL.enqueueClaim)
    .bind(now + ENQUEUE_LEASE_MS, now, eventId, now, now)
    .run();
  if (!changed(lease)) return false;
  try {
    await env.JOBS.sendBatch([
      { body: queueRun(eventId), delaySeconds: RUN_START_DELAY_SECONDS },
      { body: queueExpiry(eventId), delaySeconds: EXPIRY_DELAY_SECONDS },
    ]);
    await db.prepare(SQL.queued).bind(now, eventId).run();
    return true;
  } catch {
    await db.prepare(SQL.enqueueFailed).bind("QUEUE_RECOVERY_UNCERTAIN", now, eventId).run();
    return false;
  }
}

function fixedResult(command) {
  return command === "capture"
    ? "P04 固定回覆：Queue 與 Modal 已處理此連結測試；尚未保存。"
    : "P04 固定回覆：Queue 與 Modal 派發已完成；Hermes 尚未接入。";
}

function statusContent(rows, recovered) {
  if (!rows.length) return "目前沒有 Jarvis 工作紀錄。";
  const labels = rows.map((row) => `${row.command}：${row.dispatch_state}／回覆 ${row.reply_state}`);
  const prefix = recovered ? "已重新排入一筆待確認工作。\n" : "最近工作：\n";
  return `${prefix}${labels.join("\n")}`.slice(0, 1900);
}

async function readSession(db, interaction) {
  const userId = interaction.member?.user?.id ?? interaction.user?.id;
  const result = await db.prepare(SQL.session)
    .bind(interaction.guild_id, interaction.channel_id, userId)
    .all();
  return result.results ?? [];
}

async function handleStatus(interaction, env, now) {
  if (!env.DB || !env.JOBS) return discordResponse(4, "P04 控制平面尚未就緒，請稍後再試。");
  await clearExpired(env.DB, now);
  const userId = interaction.member?.user?.id ?? interaction.user?.id;
  await env.DB.prepare(SQL.recoverStale)
    .bind(now, interaction.guild_id, interaction.channel_id, userId, now, now, now - STALE_DISPATCH_MS)
    .run();
  let rows = await readSession(env.DB, interaction);
  const pending = rows.find((row) => {
    const outboxState = ["DISPATCH_PENDING", "NEEDS_RECONCILIATION"].includes(row.dispatch_state);
    const expiredEnqueueLease = row.dispatch_state === "ENQUEUEING" && Number(row.enqueue_lease_until_ms ?? 0) <= now;
    return (outboxState || expiredEnqueueLease) && row.reply_expires_at_ms > now &&
      Number(row.enqueue_lease_until_ms ?? 0) <= now;
  });
  let recovered = false;
  if (pending) {
    const pendingJob = await getJob(env.DB, pending.interaction_id);
    if (pendingJob?.reply_state === "PENDING") await postInitialDefer(pendingJob, env, fetch, now);
    recovered = await enqueueRecovery(env, pending.interaction_id, env.DB, now);
  }
  if (recovered) rows = await readSession(env.DB, interaction);
  return discordResponse(4, statusContent(rows, recovered));
}

async function acceptInteraction(interaction, env, now, waitUntil) {
  if (!env.DB || !env.JOBS || !env.JARVIS_REPLY_ENCRYPTION_KEY || !env.JARVIS_INTERNAL_SECRET || !env.MODAL_DISPATCH_URL) {
    return discordResponse(4, "Jarvis 工作佇列尚未設定完成，這次沒有啟動工作。");
  }
  const eventId = interaction.id;
  const userId = interaction.member?.user?.id ?? interaction.user?.id;
  const command = interaction.data?.name;
  const value = option(interaction, command === "capture" ? "url" : "prompt")?.trim();
  const maxLength = command === "capture" ? MAX_URL_LENGTH : MAX_PROMPT_LENGTH;
  if (!validSnowflake(eventId) || !validSnowflake(interaction.guild_id) ||
      !validSnowflake(interaction.channel_id) || !validSnowflake(userId) ||
      interaction.application_id !== env.DISCORD_APPLICATION_ID ||
      typeof interaction.token !== "string" || interaction.token.length < 20 ||
      !value || value.length > maxLength) {
    return discordResponse(4, "工作資料格式不完整或超出允許長度。");
  }
  if (command === "capture") {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password) return discordResponse(4, "URL 必須使用 HTTPS，且不能包含登入資料。");
    } catch {
      return discordResponse(4, "請提供有效的 HTTPS URL。");
    }
  }

  const receivedAt = now;
  const expiresAt = now + TOKEN_TTL_MS;
  const payload = command === "capture" ? { url: value } : { prompt: value };
  const rowIdentity = {
    interaction_id: eventId,
    guild_id: interaction.guild_id,
    channel_id: interaction.channel_id,
    user_id: userId,
    reply_expires_at_ms: expiresAt,
  };
  let encrypted;
  try {
    encrypted = await encryptToken(interaction.token, env.JARVIS_REPLY_ENCRYPTION_KEY, rowIdentity);
  } catch {
    return discordResponse(4, "工作回覆憑證尚未安全設定，這次沒有啟動工作。");
  }

  let insertResult;
  try {
    insertResult = await env.DB.prepare(SQL.insert).bind(
      eventId,
      eventId,
      interaction.guild_id,
      interaction.channel_id,
      userId,
      command,
      `${interaction.guild_id}:${interaction.channel_id}:${userId}`,
      JSON.stringify(payload),
      receivedAt,
      expiresAt,
      encrypted.ciphertext,
      encrypted.nonce,
      receivedAt,
      receivedAt,
    ).run();
  } catch {
    return discordResponse(4, "工作紀錄無法保存，這次沒有啟動工作。");
  }

  const row = await getJob(env.DB, eventId);
  if (!row) return discordResponse(4, "工作紀錄無法讀回，這次沒有啟動工作。");
  if (!changed(insertResult)) {
    if (["SUCCEEDED", "FAILED", "EXPIRED"].includes(row.dispatch_state)) {
      return discordResponse(4, row.result_content ?? "這個互動已處理完成。");
    }
    return deferredResponse("此互動已在處理中。");
  }

  const dispatch = enqueueInitial(env, eventId, env.DB, now).catch(async () => {
    try {
      await env.DB.prepare(SQL.enqueueFailed).bind("QUEUE_RECOVERY_UNCERTAIN", now, eventId).run();
    } catch {
      // Keep the durable outbox row visible to /status recovery.
    }
  });
  if (typeof waitUntil === "function") waitUntil(dispatch);
  else await dispatch;
  return deferredResponse("已接收，正在確認工作派發。");
}

async function patchOriginal(row, content, env, fetchImpl, now) {
  if (row.reply_expires_at_ms <= now || !row.reply_token_ciphertext || !row.reply_token_nonce) {
    await expireJob(env.DB, row.interaction_id, now);
    return { delivered: false, expired: true };
  }
  let token;
  try {
    token = await decryptToken(row, env.JARVIS_REPLY_ENCRYPTION_KEY);
  } catch {
    await env.DB.prepare(SQL.deliveryFailed).bind("REPLY_TOKEN_DECRYPT_FAILED", now, row.interaction_id).run();
    return { delivered: false, retryable: false };
  }

  let response;
  try {
    response = await fetchImpl(
      `${DISCORD_API}/webhooks/${env.DISCORD_APPLICATION_ID}/${encodeURIComponent(token)}/messages/@original`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
      },
    );
  } catch {
    await env.DB.prepare(SQL.deliveryFailed).bind("DISCORD_DELIVERY_NETWORK", now, row.interaction_id).run();
    return { delivered: false, retryable: true };
  }

  if (response.ok) {
    await env.DB.prepare(SQL.delivered).bind(now, row.interaction_id).run();
    return { delivered: true };
  }
  if (response.status === 401 || response.status === 404) {
    await expireJob(env.DB, row.interaction_id, now);
    return { delivered: false, expired: true };
  }
  await env.DB.prepare(SQL.deliveryFailed).bind(`DISCORD_DELIVERY_${response.status}`, now, row.interaction_id).run();
  return { delivered: false, retryable: response.status === 429 || response.status >= 500 };
}

async function postInitialDefer(row, env, fetchImpl, now) {
  if (row.reply_expires_at_ms <= now || !row.reply_token_ciphertext || !row.reply_token_nonce) {
    await expireJob(env.DB, row.interaction_id, now);
    return false;
  }
  let token;
  try {
    token = await decryptToken(row, env.JARVIS_REPLY_ENCRYPTION_KEY);
  } catch {
    return false;
  }
  try {
    const response = await fetchImpl(
      `${DISCORD_API}/interactions/${row.interaction_id}/${encodeURIComponent(token)}/callback`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: 5, data: { content: "已接收，正在確認工作派發。", flags: 64, allowed_mentions: { parse: [] } } }),
      },
    );
    if (!response.ok && response.status !== 400) return false;
    await env.DB.prepare(`UPDATE jarvis_jobs SET reply_state = 'DEFERRED', updated_at_ms = ?
      WHERE interaction_id = ? AND reply_state = 'PENDING'`).bind(now, row.interaction_id).run();
    return true;
  } catch {
    return false;
  }
}

async function expireJob(db, eventId, now) {
  await db.prepare(SQL.expired).bind(now, eventId).run();
}

async function handleInternal(request, env, deps) {
  const { now = Date.now, fetchImpl = fetch } = deps;
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  if (!env.JARVIS_INTERNAL_SECRET) return new Response("Internal service unavailable", { status: 503 });
  const rawBody = await request.arrayBuffer();
  if (rawBody.byteLength > 16 * 1024) return new Response("Request too large", { status: 413 });
  if (!(await verifyInternalRequest(request, rawBody, env.JARVIS_INTERNAL_SECRET, now()))) {
    return new Response("Unauthorized", { status: 401 });
  }
  let payload;
  try {
    payload = JSON.parse(decoder.decode(rawBody));
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (!env.DB) return new Response("Control database unavailable", { status: 503 });

  const path = new URL(request.url).pathname;
  if (path === "/internal/claim") {
    if (!validSnowflake(payload.event_id) || typeof payload.run_id !== "string" || !/^[0-9a-f-]{36}$/i.test(payload.run_id)) {
      return Response.json({ error: "invalid_claim" }, { status: 400 });
    }
    const time = now();
    await clearExpired(env.DB, time);
    const result = await env.DB.prepare(SQL.claim)
      .bind(payload.run_id, time + RUN_LEASE_MS, time, payload.event_id, time, payload.run_id, time)
      .run();
    if (!changed(result)) {
      const existing = await getJob(env.DB, payload.event_id);
      if (existing?.dispatch_state === "SUCCEEDED" && existing.claim_run_id === payload.run_id && existing.reply_state !== "DELIVERED") {
        return Response.json({
          schema_version: existing.schema_version,
          event_id: existing.interaction_id,
          command: existing.command,
          reply_expires_at_ms: existing.reply_expires_at_ms,
          run_id: payload.run_id,
          already_succeeded: true,
          result: existing.result_content,
        });
      }
      return Response.json({ error: "not_claimable" }, { status: 409 });
    }
    const row = await getJob(env.DB, payload.event_id);
    if (!row || row.dispatch_state !== "RUNNING" || row.claim_run_id !== payload.run_id) {
      return Response.json({ error: "claim_lost" }, { status: 409 });
    }
    return Response.json({
      schema_version: row.schema_version,
      event_id: row.interaction_id,
      command: row.command,
      reply_expires_at_ms: row.reply_expires_at_ms,
      run_id: payload.run_id,
    });
  }

  if (path === "/internal/complete") {
    if (!validSnowflake(payload.event_id) || typeof payload.run_id !== "string") {
      return Response.json({ error: "invalid_completion" }, { status: 400 });
    }
    const time = now();
    let row = await getJob(env.DB, payload.event_id);
    if (!row) return Response.json({ error: "job_not_found" }, { status: 404 });
    if (row.claim_run_id !== payload.run_id || !["RUNNING", "SUCCEEDED"].includes(row.dispatch_state)) {
      return Response.json({ error: "claim_mismatch" }, { status: 409 });
    }
    const expected = fixedResult(row.command);
    if (payload.result !== expected) return Response.json({ error: "result_not_allowed" }, { status: 400 });
    if (row.reply_state === "DELIVERED") return Response.json({ ok: true, reply_state: "DELIVERED" });
    if (row.dispatch_state === "RUNNING") {
      await env.DB.prepare(SQL.setSucceeded).bind(expected, time, row.interaction_id, payload.run_id).run();
      row = await getJob(env.DB, payload.event_id);
    }
    const delivery = await patchOriginal(row, expected, env, fetchImpl, time);
    if (delivery.retryable) return Response.json({ error: "delivery_retryable" }, { status: 503 });
    return Response.json({ ok: true, reply_state: delivery.delivered ? "DELIVERED" : delivery.expired ? "EXPIRED" : "DELIVERY_FAILED" });
  }

  if (path === "/internal/fail") {
    if (!validSnowflake(payload.event_id) || typeof payload.run_id !== "string" ||
        typeof payload.error_code !== "string" || !/^[A-Z0-9_]{1,40}$/.test(payload.error_code)) {
      return Response.json({ error: "invalid_failure" }, { status: 400 });
    }
    const time = now();
    let row = await getJob(env.DB, payload.event_id);
    if (!row) return Response.json({ error: "job_not_found" }, { status: 404 });
    if (row.claim_run_id !== payload.run_id) return Response.json({ error: "claim_mismatch" }, { status: 409 });
    if (row.dispatch_state === "SUCCEEDED") {
      const delivery = await patchOriginal(row, row.result_content ?? fixedResult(row.command), env, fetchImpl, time);
      if (delivery.retryable) return Response.json({ error: "delivery_retryable" }, { status: 503 });
      return Response.json({ ok: true, reply_state: delivery.delivered ? "DELIVERED" : "DELIVERY_FAILED" });
    }
    if (row.dispatch_state === "RUNNING") {
      await env.DB.prepare(SQL.fail).bind(payload.error_code, time, row.interaction_id, payload.run_id).run();
      row = await getJob(env.DB, payload.event_id);
    }
    const content = "P04 固定回覆工作暫時失敗；請使用 /status 查詢狀態。";
    const delivery = await patchOriginal(row, content, env, fetchImpl, time);
    if (delivery.retryable) return Response.json({ error: "delivery_retryable" }, { status: 503 });
    return Response.json({ ok: true, reply_state: delivery.delivered ? "DELIVERED" : delivery.expired ? "EXPIRED" : "DELIVERY_FAILED" });
  }
  return new Response("Not Found", { status: 404 });
}

export async function handleP04Request(request, env, deps = {}) {
  const path = new URL(request.url).pathname;
  if (path.startsWith("/internal/")) return handleInternal(request, env, deps);
  if (path !== "/") return new Response("Not Found", { status: 404 });
  const { now = Date.now } = deps;
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  if (!env.DISCORD_PUBLIC_KEY) return new Response("Configuration unavailable", { status: 503 });
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) return new Response("Request too large", { status: 413 });
  if (!(await verifyDiscordRequest(request, env.DISCORD_PUBLIC_KEY, body))) {
    if (env.P03_DIAGNOSTICS === "1") console.log("p03_signature_invalid");
    return new Response("Invalid request signature", { status: 401 });
  }
  let interaction;
  try {
    interaction = JSON.parse(decoder.decode(body));
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (interaction.type === 1) return Response.json({ type: 1 });
  if (interaction.type !== 2) return discordResponse(4, "尚未支援這項互動。");
  if (!allowed(interaction, env)) return discordResponse(4, "未授權使用此入口。");
  if (interaction.data?.name === "status") return handleStatus(interaction, env, now());
  if (!["jarvis", "capture"].includes(interaction.data?.name)) return discordResponse(4, "未知的指令。");
  return acceptInteraction(interaction, env, now(), deps.waitUntil);
}

async function dispatchToModal(eventId, env, fetchImpl, now) {
  if (!env.MODAL_DISPATCH_URL || !env.JARVIS_INTERNAL_SECRET) throw new Error("MODAL_DISPATCH_UNCONFIGURED");
  const url = new URL(env.MODAL_DISPATCH_URL);
  if (url.protocol !== "https:" || url.search || url.hash) throw new Error("MODAL_DISPATCH_URL_INVALID");
  const body = JSON.stringify({ schema_version: 1, event_id: eventId });
  const timestamp = `${Math.floor(now / 1000)}`;
  const prefix = encoder.encode(`${timestamp}\n${url.pathname}\n`);
  const raw = encoder.encode(body);
  const bytes = new Uint8Array(prefix.length + raw.length);
  bytes.set(prefix);
  bytes.set(raw, prefix.length);
  const key = await crypto.subtle.importKey("raw", encoder.encode(env.JARVIS_INTERNAL_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-jarvis-timestamp": timestamp,
      "x-jarvis-signature": signature,
    },
    body,
  });
  if (!response.ok) return { status: response.status };
  const result = await response.json();
  if (typeof result.call_id !== "string" || !result.call_id.startsWith("fc-")) throw new Error("MODAL_CALL_ID_MISSING");
  return { status: response.status, callId: result.call_id };
}

async function dispatchFailure(row, env, fetchImpl, now) {
  await env.DB.prepare(SQL.dispatchFailed).bind("MODAL_DISPATCH_DENIED", now, row.interaction_id).run();
  const updated = await getJob(env.DB, row.interaction_id);
  await patchOriginal(updated, "P04 固定回覆工作無法安全派發；請聯絡管理者。", env, fetchImpl, now);
}

export async function handleQueue(batch, env, deps = {}) {
  const { now = Date.now, fetchImpl = fetch } = deps;
  for (const message of batch.messages ?? []) {
    const data = message.body;
    if (!data || data.schema_version !== 1 || !["run", "expire"].includes(data.kind) || !validSnowflake(data.event_id)) {
      message.ack();
      continue;
    }
    const time = now();
    try {
      if (!env.DB) throw new Error("CONTROL_DB_UNAVAILABLE");
      if (data.kind === "expire") {
        await clearExpired(env.DB, time);
        await expireJob(env.DB, data.event_id, time);
        message.ack();
        continue;
      }
      const row = await getJob(env.DB, data.event_id);
      if (!row || ["SUCCEEDED", "FAILED", "EXPIRED"].includes(row.dispatch_state)) {
        message.ack();
        continue;
      }
      if (row.reply_expires_at_ms <= time) {
        await expireJob(env.DB, row.interaction_id, time);
        message.ack();
        continue;
      }
      if (row.dispatch_state === "DISPATCHED" ||
          (row.dispatch_state === "RUNNING" && Number(row.claim_lease_until_ms ?? 0) > time)) {
        message.ack();
        continue;
      }
      const dispatched = await dispatchToModal(row.interaction_id, env, fetchImpl, time);
      if (dispatched.status === 401 || dispatched.status === 403 || (dispatched.status >= 400 && dispatched.status < 500 && dispatched.status !== 429)) {
        await dispatchFailure(row, env, fetchImpl, time);
        message.ack();
        continue;
      }
      if (dispatched.status === 429 || dispatched.status >= 500) {
        message.retry({ delaySeconds: RETRY_DELAY_SECONDS });
        continue;
      }
      await env.DB.prepare(SQL.dispatched).bind(dispatched.callId, time, row.interaction_id).run();
      message.ack();
    } catch {
      message.retry({ delaySeconds: RETRY_DELAY_SECONDS });
    }
  }
}

export const bridgeTest = {
  fixedResult,
  SQL,
  encryptToken,
  decryptToken,
  expireJob,
  getJob,
  enqueueRecovery,
};
