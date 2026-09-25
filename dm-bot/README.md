# FallenPD DM bot

A small, always-on Node process — separate from the main app, which
runs as Vercel serverless functions and can't hold a Discord Gateway
connection open. This process holds that connection and exposes one
HTTP endpoint the main app can call to send a DM.

Same bot, same token, same Discord application as the main app already
uses — this isn't a second bot. It just runs somewhere that can stay
connected 24/7, which Vercel doesn't support.

## Why this exists

The main app tried sending DMs over Discord's plain REST API and got
`403 — Cannot send messages to this user due to having no mutual
guilds` (error 50278). That happens specifically to bots that have
never opened a Gateway connection: Discord's mutual-guild check for DM
permission relies on Gateway-tracked membership data, which a pure-REST
bot never populates. This process fixes that by actually connecting.

## One-time setup

1. **Enable the Server Members intent.** In the
   [Discord Developer Portal](https://discord.com/developers/applications),
   open the same application the main bot already uses → **Bot** page →
   under **Privileged Gateway Intents**, turn on **Server Members
   Intent**. Save.

2. **Generate an API secret** — this protects `/send-dm` so only your
   own app can call it:
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

3. **Deploy this folder** to an always-on host. Railway or Render both
   have small free/cheap tiers that work well for this:

   **Railway:**
   - New Project → Deploy from GitHub repo → pick this repo
   - Set the **Root Directory** to `dm-bot`
   - Add environment variables: `DISCORD_BOT_TOKEN` (same value as in
     Vercel), `API_SECRET` (from step 2)
   - Railway auto-detects `npm start` and deploys

   **Render:**
   - New → Web Service → connect this repo
   - Root Directory: `dm-bot`
   - Build command: `npm install`, Start command: `npm start`
   - Add the same two environment variables

4. **Check it's alive** — visit `https://<your-deployed-url>/health`,
   should return `{"ok":true,"discordReady":true}`. If `discordReady`
   is `false`, check the platform's logs — usually means the intent in
   step 1 wasn't saved, or the token is wrong.

5. **Add two env vars to the Vercel project** (not this one):
   - `DM_BOT_URL` — the deployed URL from step 3, e.g.
     `https://fallenpd-dm-bot.up.railway.app`
   - `DM_BOT_SECRET` — the same value as `API_SECRET` from step 2

## Calling it from the Vercel app

Once deployed, sending a DM from any of the existing `/api/*` functions
looks like this:

```js
async function sendDM(userId, payload) {
  const res = await fetch(process.env.DM_BOT_URL + '/send-dm', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Secret': process.env.DM_BOT_SECRET
    },
    body: JSON.stringify({ userId, ...payload })
  });
  if (!res.ok) throw new Error('DM bot request failed: ' + res.status + ' ' + (await res.text()));
  return res.json();
}

// e.g.
await sendDM(applicantId, {
  embeds: [{ title: 'EOI Accepted', description: 'Congrats!', color: 0x2f8f5b }]
});
```

This isn't wired into `interactions.js` yet — say the word once this is
deployed and working, and it can be added back into the Accept/Deny
flow.

## Extending it to read replies (optional, bigger change)

This process only *sends* DMs right now — it doesn't see what anyone
replies with. Turning it into an actual back-and-forth DM conversation
(e.g. asking questions one at a time and reading answers) would need:

- The **Message Content** intent enabled alongside Server Members
- A `client.on('messageCreate', ...)` handler here that recognizes DM
  channel messages and correlates them to whatever's in progress
- Somewhere to persist "where each person is in the conversation"
  between messages (the existing Supabase database would work fine —
  a table keyed by Discord user ID)

That's a meaningfully bigger piece of work than the send-only version
here — worth a separate conversation if it's something you want later.
