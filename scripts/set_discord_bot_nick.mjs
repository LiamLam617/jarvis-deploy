const token = process.env.DISCORD_BOT_TOKEN;
if (!token) throw new Error("Missing bot credential");

const endpoint = "https://discord.com/api/v10/guilds/1488116208426287247/members/@me";
const response = await fetch(endpoint, {
  method: "PATCH",
  headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ nick: "Jarvis" }),
});
if (!response.ok) throw new Error(`Discord nickname update failed with HTTP ${response.status}`);
const member = await response.json();
if (member.nick !== "Jarvis") throw new Error("Discord nickname readback mismatch");
console.log("Bot nickname readback: Jarvis");
