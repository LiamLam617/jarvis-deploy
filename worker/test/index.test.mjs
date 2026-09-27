import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";
import { handleInteraction } from "../src/index.mjs";

const encoder = new TextEncoder();
const keys = await webcrypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
const publicKey = Buffer.from(await webcrypto.subtle.exportKey("raw", keys.publicKey)).toString("hex");
const env = {
  DISCORD_PUBLIC_KEY: publicKey,
  DISCORD_GUILD_ID: "123",
  DISCORD_JARVIS_CHANNEL_ID: "456",
  DISCORD_INBOX_CHANNEL_ID: "789",
  DISCORD_ALLOWED_USER_ID: "249763790709719040",
};

async function signedRequest(payload, override = {}) {
  const body = JSON.stringify(payload);
  const timestamp = "1780000000";
  const message = encoder.encode(timestamp + body);
  const signature = Buffer.from(await webcrypto.subtle.sign("Ed25519", keys.privateKey, message)).toString("hex");
  return new Request("https://example.test/", {
    method: "POST",
    body,
    headers: {
      "x-signature-ed25519": signature,
      "x-signature-timestamp": timestamp,
      ...override,
    },
  });
}

function command(name, ids = {}) {
  return {
    type: 2,
    guild_id: ids.guild_id ?? "123",
    channel_id: ids.channel_id ?? "456",
    member: { user: { id: ids.user_id ?? "249763790709719040" } },
    data: { name, options: [{ name: name === "capture" ? "url" : "prompt", type: 3, value: "hello" }] },
  };
}

test("valid signed PING succeeds without user or channel fields", async () => {
  const response = await handleInteraction(await signedRequest({ type: 1 }), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { type: 1 });
});

test("signature must match the raw body", async () => {
  const request = await signedRequest(command("jarvis"));
  const altered = new Request(request, { body: JSON.stringify(command("capture")) });
  const response = await handleInteraction(altered, env);
  assert.equal(response.status, 401);
});

test("missing or malformed signature is rejected", async () => {
  const response = await handleInteraction(await signedRequest(command("jarvis"), { "x-signature-ed25519": "bad" }), env);
  assert.equal(response.status, 401);
});

for (const ids of [{ guild_id: "other" }, { channel_id: "other" }, { user_id: "other" }]) {
  test(`unauthorized identity gets no action: ${Object.keys(ids)[0]}`, async () => {
    const response = await handleInteraction(await signedRequest(command("jarvis", ids)), env);
    const body = await response.json();
    assert.equal(body.type, 4);
    assert.match(body.data.content, /未授權/);
    assert.equal(body.data.flags, 64);
  });
}

test("known commands state that they are fixed entry tests", async () => {
  for (const [name, expected] of [["jarvis", /固定回覆/], ["capture", /尚未保存/], ["status", /尚未接入/]]) {
    const response = await handleInteraction(await signedRequest(command(name)), env);
    const body = await response.json();
    assert.match(body.data.content, expected);
    assert.deepEqual(body.data.allowed_mentions, { parse: [] });
  }
});
