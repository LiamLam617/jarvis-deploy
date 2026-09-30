const encoder = new TextEncoder();

export function hexBytes(value, length) {
  if (typeof value !== "string" || value.length !== length * 2 || !/^[0-9a-f]+$/i.test(value)) return null;
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function toHex(bytes) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyDiscordRequest(request, publicKeyHex, body) {
  const signature = hexBytes(request.headers.get("x-signature-ed25519"), 64);
  const publicKey = hexBytes(publicKeyHex, 32);
  const timestamp = request.headers.get("x-signature-timestamp");
  if (!signature || !publicKey || !timestamp || !/^\d+$/.test(timestamp)) return false;

  try {
    const key = await crypto.subtle.importKey("raw", publicKey, "Ed25519", false, ["verify"]);
    const timestampBytes = encoder.encode(timestamp);
    const message = new Uint8Array(timestampBytes.length + body.byteLength);
    message.set(timestampBytes);
    message.set(new Uint8Array(body), timestampBytes.length);
    return await crypto.subtle.verify("Ed25519", key, signature, message);
  } catch {
    return false;
  }
}

export function discordResponse(type, content, ephemeral = true) {
  const data = { content, allowed_mentions: { parse: [] } };
  if (ephemeral) data.flags = 64;
  return Response.json({ type, data });
}

export function deferredResponse(content = "已接收，正在處理。") {
  return Response.json({ type: 5, data: { content, flags: 64, allowed_mentions: { parse: [] } } });
}

export function option(interaction, name) {
  const item = interaction.data?.options?.find((candidate) => candidate.name === name);
  return item?.type === 3 && typeof item.value === "string" ? item.value : null;
}

export function allowed(interaction, env) {
  const userId = interaction.member?.user?.id ?? interaction.user?.id;
  const channelIds = [env.DISCORD_JARVIS_CHANNEL_ID, env.DISCORD_INBOX_CHANNEL_ID];
  return (
    typeof interaction.guild_id === "string" &&
    interaction.guild_id === env.DISCORD_GUILD_ID &&
    typeof interaction.channel_id === "string" &&
    channelIds.includes(interaction.channel_id) &&
    typeof userId === "string" &&
    userId === env.DISCORD_ALLOWED_USER_ID
  );
}

function signatureInput(timestamp, path, rawBody) {
  const prefix = encoder.encode(`${timestamp}\n${path}\n`);
  const input = new Uint8Array(prefix.length + rawBody.byteLength);
  input.set(prefix);
  input.set(new Uint8Array(rawBody), prefix.length);
  return input;
}

export async function signInternalRequest(path, rawBody, secret, timestamp = `${Math.floor(Date.now() / 1000)}`) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, signatureInput(timestamp, path, rawBody));
  return { timestamp, signature: toHex(signature) };
}

export async function verifyInternalRequest(request, rawBody, secret, nowMs = Date.now()) {
  if (!secret || new URL(request.url).search) return false;
  const timestamp = request.headers.get("x-jarvis-timestamp");
  const signature = hexBytes(request.headers.get("x-jarvis-signature"), 32);
  if (!timestamp || !/^\d{10,12}$/.test(timestamp) || !signature) return false;
  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isSafeInteger(timestampMs) || Math.abs(nowMs - timestampMs) > 5 * 60 * 1000) return false;

  try {
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    return await crypto.subtle.verify(
      "HMAC",
      key,
      signature,
      signatureInput(timestamp, new URL(request.url).pathname, rawBody),
    );
  } catch {
    return false;
  }
}
