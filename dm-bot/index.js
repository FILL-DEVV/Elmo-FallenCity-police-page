// FallenPD DM bot — a small, always-on process separate from the main
// app (which runs as Vercel serverless functions and can't hold a
// Gateway connection open). This process does exactly two things:
//   1. Logs into Discord's Gateway so it's a real, tracked member of
//      the guild — the thing a pure-REST bot never establishes, which
//      is why DMs failed with "no mutual guilds" (error 50278) before.
//   2. Exposes a tiny HTTP API (protected by a shared secret) that the
//      Vercel app calls into whenever it needs a DM sent.
//
// It does NOT read or react to what people reply with in DMs — that
// would need the Message Content intent and a conversation handler on
// top of this. See the README for how to extend it if that's wanted
// later.

const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const API_SECRET = process.env.API_SECRET;
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
  console.error('DISCORD_BOT_TOKEN is not set — exiting.');
  process.exit(1);
}
if (!API_SECRET) {
  console.error('API_SECRET is not set — exiting. This protects the /send-dm endpoint from being called by anyone who finds the URL.');
  process.exit(1);
}

// GuildMembers requires the "Server Members Intent" toggle to be turned
// on for this bot in the Discord Developer Portal (Bot page →
// Privileged Gateway Intents) — without it, login will be refused.
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag} — Gateway connection established.`);
});

client.on('error', (err) => {
  console.error('Discord client error:', err);
});

client.login(BOT_TOKEN);

const app = express();
app.use(express.json());

// Platform health checks (Railway/Render ping this to know the service
// is alive) hit this — it deliberately doesn't require the API secret.
app.get('/health', (req, res) => {
  res.status(200).json({ ok: true, discordReady: client.isReady() });
});

// The one real endpoint. Body: { userId: "123...", content?: "...", embeds?: [...] }
// At least one of content/embeds must be present, same as Discord's own
// message payload rules.
app.post('/send-dm', async (req, res) => {
  const providedSecret = req.headers['x-api-secret'];
  if (providedSecret !== API_SECRET) {
    return res.status(401).json({ error: 'Invalid or missing X-Api-Secret header' });
  }

  if (!client.isReady()) {
    return res.status(503).json({ error: 'Bot is not connected to Discord yet — try again shortly' });
  }

  const { userId, content, embeds } = req.body || {};
  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }
  if (!content && !(embeds && embeds.length)) {
    return res.status(400).json({ error: 'Provide content and/or embeds' });
  }

  try {
    const user = await client.users.fetch(userId);
    const message = await user.send({ content, embeds });
    res.status(200).json({ ok: true, messageId: message.id });
  } catch (err) {
    // Common real-world cases: the user has DMs from server members
    // disabled, or has blocked the bot — both surface as a Discord API
    // error here, not a crash. Logged with detail so it's diagnosable
    // from the platform's log viewer.
    console.error('send-dm failed for userId=' + userId + ':', err);
    res.status(502).json({ error: 'Could not send DM', detail: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`HTTP API listening on port ${PORT}`);
});
