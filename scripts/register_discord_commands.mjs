import { desiredCommands, planCommandChanges } from "./discord_commands.mjs";

const apply = process.argv.includes("--apply");
const token = process.env.DISCORD_BOT_TOKEN;
const applicationId = process.env.DISCORD_APPLICATION_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !/^\d+$/.test(applicationId ?? "") || !/^\d+$/.test(guildId ?? "")) {
  console.error("需要 DISCORD_BOT_TOKEN、DISCORD_APPLICATION_ID 與 DISCORD_GUILD_ID；ID 必須是數字字串。");
  process.exit(2);
}

const base = `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`;

async function discordApi(path, method = "GET", body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`Discord API ${method} failed with HTTP ${response.status}`);
  return response.json();
}

try {
  const existing = await discordApi("");
  if (!Array.isArray(existing)) throw new Error("Discord API did not return a command list");
  const plan = planCommandChanges(existing);
  for (const change of plan) console.log(`${change.action}: /${change.command.name}`);

  if (apply) {
    for (const change of plan) {
      if (change.action === "create") await discordApi("", "POST", change.command);
      if (change.action === "update") await discordApi(`/${change.id}`, "PATCH", change.command);
    }
    const after = await discordApi("");
    if (!Array.isArray(after) || planCommandChanges(after, desiredCommands).some((item) => item.action !== "unchanged")) {
      throw new Error("Discord commands did not match after readback");
    }
    console.log("readback: three Jarvis commands match; unrelated commands preserved");
  } else {
    console.log("read-only plan; pass --apply only after P03 approval");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Discord command operation failed");
  process.exitCode = 1;
}
