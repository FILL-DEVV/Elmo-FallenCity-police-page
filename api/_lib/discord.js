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
// member by ID, and listing a guild's roles, are both plain REST calls.
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

module.exports = { exchangeCodeForToken, fetchDiscordUser, fetchGuildMember, fetchGuildRoles };
