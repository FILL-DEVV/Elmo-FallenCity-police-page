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
// channel the bot can see, and adding/removing/replacing roles on a
// member the bot outranks, are all plain REST calls.
async function fetchGuildMember(guildId, userId, botToken) {
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${userId}`, {
    headers: { Authorization: `Bot ${botToken}` }
  });
  if (res.status === 404) {
    // Logged so a "not a member" login failure can be diagnosed from
    // Vercel logs — shows exactly which guild/user Discord said no to.
    console.error('fetchGuildMember: Discord returned 404 (not a member) for guildId=' + guildId + ' userId=' + userId);
    return null;
  }
  if (!res.ok) throw new Error('Failed to fetch guild member: ' + res.status + ' ' + (await res.text()));
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

// Generic message send — accepts any valid Discord message payload
// (embeds, components, etc.), unlike sendChannelMessage above which only
// ever sends plain text content.
async function sendChannelPayload(channelId, botToken, payload) {
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('Failed to send channel payload: ' + res.status + ' ' + (await res.text()));
  return res.json();
}

// Opens (or reuses) a DM channel with a user and sends them a message —
// a one-off notification, not a conversation: this is a plain REST call
// and works fine from a serverless function. It does NOT let the bot
// see or react to whatever the person replies with — reading a reply
// back would need Discord's Gateway (a persistent connection), which
// this app doesn't run. Fails harmlessly (throws, caller should catch)
// if the user has DMs from server members disabled or has blocked the
// bot — there is no way to detect that in advance.
async function sendDirectMessage(userId, botToken, payload) {
  const dmRes = await fetch(`${DISCORD_API}/users/@me/channels`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ recipient_id: userId })
  });
  if (!dmRes.ok) throw new Error('Failed to open DM channel: ' + dmRes.status + ' ' + (await dmRes.text()));
  const dmChannel = await dmRes.json();

  const msgRes = await fetch(`${DISCORD_API}/channels/${dmChannel.id}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  if (!msgRes.ok) throw new Error('Failed to send DM: ' + msgRes.status + ' ' + (await msgRes.text()));
  return msgRes.json();
}

// Edits the message an interaction was originally responding to — used
// after the interaction was acknowledged with a DEFERRED response (type
// 6), once the slower work that couldn't fit in Discord's 3-second
// response window has actually finished. Authenticated by the
// interaction's own token, not the bot token (Discord's webhook-style
// auth for interaction follow-ups — no Authorization header needed).
async function editOriginalInteractionResponse(applicationId, interactionToken, payload) {
  const res = await fetch(`${DISCORD_API}/webhooks/${applicationId}/${interactionToken}/messages/@original`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('Failed to edit original interaction response: ' + res.status + ' ' + (await res.text()));
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

// Replaces a member's ENTIRE role list in one call (pass [] to strip
// every role). Requires the bot's top role to sit above every role being
// removed — any role above the bot's own position can't be touched, and
// Discord will reject the whole request if one is included, not just
// skip it.
async function setMemberRoles(guildId, userId, roleIds, botToken) {
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${userId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ roles: roleIds })
  });
  if (!res.ok) throw new Error('Failed to set member roles: ' + res.status + ' ' + (await res.text()));
  return res.json();
}

module.exports = {
  exchangeCodeForToken, fetchDiscordUser, fetchGuildMember, fetchGuildRoles,
  fetchGuildChannels, findChannelByName, sendChannelMessage, sendChannelPayload,
  sendDirectMessage, editOriginalInteractionResponse, addMemberRole, removeMemberRole, setMemberRoles
};
