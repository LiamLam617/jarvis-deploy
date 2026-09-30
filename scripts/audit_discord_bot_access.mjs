const token = process.env.DISCORD_BOT_TOKEN;
if (!token) throw new Error("Missing bot credential");
const guildId = "1488116208426287247";
const base = "https://discord.com/api/v10";
const hermesRoleId = "1511997834625417240";
const targetChannels = new Set(["1553710999444529233", "1553711115433938945"]);
async function get(path) {
  const response = await fetch(`${base}${path}`, { headers: { Authorization: `Bot ${token}` } });
  if (!response.ok) throw new Error(`Discord read failed with HTTP ${response.status}: ${path}`);
  return response.json();
}

const [self, roles, channels] = await Promise.all([
  get("/users/@me"),
  get(`/guilds/${guildId}/roles`),
  get(`/guilds/${guildId}/channels`),
]);
const member = await get(`/guilds/${guildId}/members/${self.id}`);
const everyone = roles.find((role) => role.id === guildId);
const assigned = roles.filter((role) => member.roles.includes(role.id));
if (!everyone) throw new Error("Guild @everyone role missing");
let guildPermissions = BigInt(everyone.permissions);
for (const role of assigned) guildPermissions |= BigInt(role.permissions);

const VIEW = 1n << 10n;
const SEND = 1n << 11n;
const ADMIN = 1n << 3n;
// Discord's current text-channel permission flags, including the permissions
// represented in Channel Settings > Permissions.
const TEXT_CHANNEL_BITS = [0, 4, 6, 10, 11, 12, 13, 14, 15, 16, 17, 18, 28, 29, 31, 34, 35, 36, 37, 38, 39, 46, 49, 50, 51, 52];
const TEXT_CHANNEL_MASK = TEXT_CHANNEL_BITS.reduce((mask, bit) => mask | (1n << BigInt(bit)), 0n);
const EXPECTED_ALLOW = VIEW | SEND;
const EXPECTED_DENY = TEXT_CHANNEL_MASK & ~EXPECTED_ALLOW;
function effective(channel) {
  if (guildPermissions & ADMIN) return guildPermissions;
  let permissions = guildPermissions;
  const overwrites = channel.permission_overwrites ?? [];
  const all = overwrites.find((entry) => entry.id === guildId && entry.type === 0);
  if (all) permissions = (permissions & ~BigInt(all.deny)) | BigInt(all.allow);
  let deny = 0n;
  let allow = 0n;
  for (const entry of overwrites) {
    if (entry.type === 0 && member.roles.includes(entry.id)) {
      deny |= BigInt(entry.deny);
      allow |= BigInt(entry.allow);
    }
  }
  permissions = (permissions & ~deny) | allow;
  const user = overwrites.find((entry) => entry.id === self.id && entry.type === 1);
  if (user) permissions = (permissions & ~BigInt(user.deny)) | BigInt(user.allow);
  return permissions;
}

console.log(`bot ${self.id}: ${member.nick ?? self.username}`);
console.log(`guild permissions: ${guildPermissions.toString()}`);
console.log(`assigned roles: ${assigned.map((r) => r.name).join(", ")}`);
const hermesRole = roles.find((role) => role.id === hermesRoleId);
if (!hermesRole || !member.roles.includes(hermesRoleId)) throw new Error("Hermes role is not assigned to the bot");
let targetsPassed = 0;
for (const channel of channels.filter((c) => [0, 2].includes(c.type))) {
  const permissions = effective(channel);
  const view = Boolean(permissions & VIEW);
  const send = Boolean(permissions & SEND);
  if (targetChannels.has(channel.id)) {
    const overwrite = (channel.permission_overwrites ?? []).find((entry) => entry.id === hermesRoleId && entry.type === 0);
    if (!overwrite) throw new Error(`Missing Hermes channel overwrite: ${channel.name}`);
    const allow = BigInt(overwrite.allow);
    const deny = BigInt(overwrite.deny);
    const scopedEffective = permissions & TEXT_CHANNEL_MASK;
    const exact = allow === EXPECTED_ALLOW && deny === EXPECTED_DENY && scopedEffective === EXPECTED_ALLOW;
    if (exact) targetsPassed++;
    console.log(`${channel.id} text ${channel.name}: Hermes overwrite allow=${allow} deny=${deny}; effective_text=${scopedEffective}; view=${view} send=${send}; least_privilege=${exact ? "PASS" : "FAIL"}`);
  } else {
    console.log(`${channel.id} ${channel.type === 0 ? "text" : "voice"} ${channel.name}: view=${view} send=${send}`);
  }
}
if (targetsPassed !== targetChannels.size) process.exitCode = 1;
