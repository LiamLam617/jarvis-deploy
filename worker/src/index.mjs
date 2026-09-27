const encoder = new TextEncoder();

function hexBytes(value, length) {
  if (typeof value !== "string" || value.length !== length * 2 || !/^[0-9a-f]+$/i.test(value)) {
    return null;
  }
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return bytes;
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

function discordResponse(type, content, ephemeral = true) {
  const data = { content, allowed_mentions: { parse: [] } };
  if (ephemeral) data.flags = 64;
  return Response.json({ type, data });
}

function option(interaction, name) {
  const item = interaction.data?.options?.find((candidate) => candidate.name === name);
  return item?.type === 3 && typeof item.value === "string" ? item.value : null;
}

function allowed(interaction, env) {
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

export async function handleInteraction(request, env) {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  if (!env.DISCORD_PUBLIC_KEY) return new Response("Configuration unavailable", { status: 503 });

  const body = await request.arrayBuffer();
  if (body.byteLength > 64 * 1024) return new Response("Request too large", { status: 413 });
  if (!(await verifyDiscordRequest(request, env.DISCORD_PUBLIC_KEY, body))) {
    return new Response("Invalid request signature", { status: 401 });
  }

  let interaction;
  try {
    interaction = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (interaction.type === 1) return Response.json({ type: 1 });
  if (interaction.type !== 2) return discordResponse(4, "尚未支援這項互動。");
  if (!allowed(interaction, env)) return discordResponse(4, "未授權使用此入口。");

  switch (interaction.data?.name) {
    case "jarvis":
      return option(interaction, "prompt")?.trim()
        ? discordResponse(4, "入口測試：Hermes 尚未接入，這是固定回覆。")
        : discordResponse(4, "請提供 prompt 文字。");
    case "capture":
      return option(interaction, "url")?.trim()
        ? discordResponse(4, "入口測試：尚未保存連結。")
        : discordResponse(4, "請提供 URL。");
    case "status":
      return discordResponse(4, "入口測試中；Queue、Modal 與 Hermes 尚未接入。");
    default:
      return discordResponse(4, "未知的指令。");
  }
}

export default {
  fetch: handleInteraction,
};
