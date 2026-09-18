const DISCORD_API = 'https://discord.com/api/v10';

async function exchangeCodeForToken({ code, clientId, clientSecret, redirectUri }) {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri
  });
  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });
  if (!res.ok) throw new Error('Discord token exchange failed: ' + res.status + ' ' + (await res.text()));
  return res.json();
}

async function fetchDiscordUser(accessToken) {
  const res = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error('Failed to fetch Discord user: ' + res.status);
  return res.json();
}

// Bot-token calls below need no privileged intents: fetching a single
// member by ID, listing a guild's roles/channels, posting a message to a
// channel the bot can see, and adding/removing a role on a member the
// bot outranks, are all plain REST calls.
async function fetchGuildMember(guildId, userId, botToken) {
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${userId}`, {
    headers: { Authorization: `Bot ${botToken}` }
  });
  if (res.status === 404) return null; // user isn't a member of the guild
  if (!res.ok) throw new Error('Failed to fetch guild member: ' + res.status);
  return res.json();
}

async function fetchGuildRoles(guildId, botToken) {
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/roles`, {
    headers: { Authorization: `Bot ${botToken}` }
  });
  if (!res.ok) throw new Error('Failed to fetch guild roles: ' + res.status);
  return res.json();
}

async function fetchGuildChannels(guildId, botToken) {
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
    headers: { Authorization: `Bot ${botToken}` }
  });
  if (!res.ok) throw new Error('Failed to fetch guild channels: ' + res.status);
  return res.json();
}

// Finds a text channel by name (case-insensitive, leading "#" ignored).
async function findChannelByName(guildId, botToken, name) {
  const channels = await fetchGuildChannels(guildId, botToken);
  const target = name.toLowerCase().replace(/^#/, '');
  return channels.find(c => (c.name || '').toLowerCase() === target) || null;
}

async function sendChannelMessage(channelId, botToken, content) {
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ content })
  });
  if (!res.ok) throw new Error('Failed to send channel message: ' + res.status + ' ' + (await res.text()));
  return res.json();
}

async function addMemberRole(guildId, userId, roleId, botToken) {
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
    method: 'PUT',
    headers: { Authorization: `Bot ${botToken}` }
  });
  if (!res.ok) throw new Error('Failed to add role: ' + res.status + ' ' + (await res.text()));
}

async function removeMemberRole(guildId, userId, roleId, botToken) {
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bot ${botToken}` }
  });
  if (!res.ok) throw new Error('Failed to remove role: ' + res.status + ' ' + (await res.text()));
}

module.exports = {
  exchangeCodeForToken, fetchDiscordUser, fetchGuildMember, fetchGuildRoles,
  fetchGuildChannels, findChannelByName, sendChannelMessage,
  addMemberRole, removeMemberRole
};
