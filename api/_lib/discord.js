const DISCORD_API = 'https://discord.com/api/v10';

// Wraps fetch() with a couple of retries for NETWORK-level failures only
// (the TypeError undici throws for connection problems — e.g. "other
// side closed" — never for an actual HTTP error response from Discord,
// which fetch() resolves normally with res.ok === false). Serverless
// functions can go idle between invocations while a pooled keep-alive
// connection to Discord's edge is silently closed on the far side; the
// next reuse attempt then fails at the socket level before any request
// reaches Discord at all. A short retry clears this reliably without
// masking genuine Discord-side errors, which still come back as normal
// (non-ok) responses for the caller to handle.
async function discordFetch(url, options, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetch(url, options);
    } catch (e) {
      if (attempt === retries) throw e;
      console.error('discordFetch: network error on attempt ' + (attempt + 1) + ' of ' + (retries + 1) + ', retrying:', e.message || e);
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
}

async function exchangeCodeForToken({ code, clientId, clientSecret, redirectUri }) {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri
  });
  const res = await discordFetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });
  if (!res.ok) throw new Error('Discord token exchange failed: ' + res.status + ' ' + (await res.text()));
  return res.json();
}

async function fetchDiscordUser(accessToken) {
  const res = await discordFetch(`${DISCORD_API}/users/@me`, {
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
  const res = await discordFetch(`${DISCORD_API}/guilds/${guildId}/members/${userId}`, {
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
  const res = await discordFetch(`${DISCORD_API}/guilds/${guildId}/roles`, {
    headers: { Authorization: `Bot ${botToken}` }
  });
  if (!res.ok) throw new Error('Failed to fetch guild roles: ' + res.status);
  return res.json();
}

async function fetchGuildChannels(guildId, botToken) {
  const res = await discordFetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
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
  const res = await discordFetch(`${DISCORD_API}/channels/${channelId}/messages`, {
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
  const res = await discordFetch(`${DISCORD_API}/channels/${channelId}/messages`, {
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

// Edits the message an interaction was originally responding to — used
// after the interaction was acknowledged with a DEFERRED response (type
// 6), once the slower work that couldn't fit in Discord's 3-second
// response window has actually finished. Authenticated by the
// interaction's own token, not the bot token (Discord's webhook-style
// auth for interaction follow-ups — no Authorization header needed).
async function editOriginalInteractionResponse(applicationId, interactionToken, payload) {
  const res = await discordFetch(`${DISCORD_API}/webhooks/${applicationId}/${interactionToken}/messages/@original`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('Failed to edit original interaction response: ' + res.status + ' ' + (await res.text()));
  return res.json();
}

// Sends a NEW followup message for an interaction that's already been
// acknowledged (deferred or otherwise) — used instead of
// editOriginalInteractionResponse when the reply shouldn't touch the
// original message itself, e.g. an ephemeral "you can't do that" after
// deferring an update.
async function sendInteractionFollowup(applicationId, interactionToken, payload) {
  const res = await discordFetch(`${DISCORD_API}/webhooks/${applicationId}/${interactionToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('Failed to send interaction followup: ' + res.status + ' ' + (await res.text()));
  return res.json();
}

// Creates a PRIVATE thread under a channel — used to post something only
// the applicant (and staff able to see private threads) will see, since
// Discord has no way for a bot to post a truly ephemeral message into a
// channel outside of replying to that person's own interaction. The
// caller still needs to add the target user as a thread member (below)
// for them to actually see it.
async function createPrivateThread(channelId, botToken, name) {
  const res = await discordFetch(`${DISCORD_API}/channels/${channelId}/threads`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name: name.slice(0, 100), type: 12, invitable: false, auto_archive_duration: 1440 })
  });
  if (!res.ok) throw new Error('Failed to create private thread: ' + res.status + ' ' + (await res.text()));
  return res.json();
}

async function addThreadMember(threadId, userId, botToken) {
  const res = await discordFetch(`${DISCORD_API}/channels/${threadId}/thread-members/${userId}`, {
    method: 'PUT',
    headers: { Authorization: `Bot ${botToken}` }
  });
  if (!res.ok) throw new Error('Failed to add thread member: ' + res.status + ' ' + (await res.text()));
}

// Archives (and locks) a thread — kept for any future use, though the
// EOI acknowledge flow now deletes the thread outright instead (below).
async function archiveThread(threadId, botToken) {
  const res = await discordFetch(`${DISCORD_API}/channels/${threadId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ archived: true, locked: true })
  });
  if (!res.ok) throw new Error('Failed to archive thread: ' + res.status + ' ' + (await res.text()));
}

// Deletes a channel or thread outright (not just archiving it) — used to
// remove the private EOI acknowledgement thread once the applicant has
// acknowledged, since it's served its purpose and there's nothing in it
// worth keeping around.
async function deleteThread(threadId, botToken) {
  const res = await discordFetch(`${DISCORD_API}/channels/${threadId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bot ${botToken}` }
  });
  if (!res.ok) throw new Error('Failed to delete thread: ' + res.status + ' ' + (await res.text()));
}

async function addMemberRole(guildId, userId, roleId, botToken) {
  const res = await discordFetch(`${DISCORD_API}/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
    method: 'PUT',
    headers: { Authorization: `Bot ${botToken}` }
  });
  if (!res.ok) throw new Error('Failed to add role: ' + res.status + ' ' + (await res.text()));
}

async function removeMemberRole(guildId, userId, roleId, botToken) {
  const res = await discordFetch(`${DISCORD_API}/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
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
  const res = await discordFetch(`${DISCORD_API}/guilds/${guildId}/members/${userId}`, {
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
  editOriginalInteractionResponse, sendInteractionFollowup, createPrivateThread, addThreadMember, archiveThread, deleteThread,
  addMemberRole, removeMemberRole, setMemberRoles
};
