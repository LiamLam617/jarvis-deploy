import { allowed, discordResponse, option, verifyDiscordRequest } from "./security.mjs";
import { handleP04Request, handleQueue } from "./bridge.mjs";

export async function handleInteraction(request, env) {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  if (!env.DISCORD_PUBLIC_KEY) return new Response("Configuration unavailable", { status: 503 });

  const body = await request.arrayBuffer();
  if (body.byteLength > 64 * 1024) return new Response("Request too large", { status: 413 });
  if (!(await verifyDiscordRequest(request, env.DISCORD_PUBLIC_KEY, body))) {
    if (env.P03_DIAGNOSTICS === "1") console.log("p03_signature_invalid");
    return new Response("Invalid request signature", { status: 401 });
  }

  let interaction;
  try {
    interaction = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (interaction.type === 1) {
    if (env.P03_DIAGNOSTICS === "1") console.log("p03_signed_ping_accepted");
    return Response.json({ type: 1 });
  }
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
  async fetch(request, env, ctx) {
    if (env.P04_QUEUE_ONLY === "1") return new Response("Hello World!");
    if (env.BRIDGE_ENABLED === "1") {
      return handleP04Request(request, env, { waitUntil: (promise) => ctx.waitUntil(promise) });
    }
    return handleInteraction(request, env);
  },
  async queue(batch, env, ctx) {
    return handleQueue(batch, env);
  },
};
