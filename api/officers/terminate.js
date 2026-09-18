const { getSession } = require('../_lib/session');
const { sbFetch } = require('../_lib/supabase');
const { syncRankRole } = require('../_lib/roleSync');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not logged in' });
  if (!session.perms.canTerminate) return res.status(403).json({ error: 'You do not have permission to terminate officers' });

  const { id, time, notes } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Missing officer id' });

  try {
    // Read their current rank/division/Discord ID before overwriting it,
    // so the role removal below knows what to strip.
    const before = await sbFetch(`/officers?id=eq.${encodeURIComponent(id)}&select=discord,rank,list_key`, {
      extraHeaders: { Prefer: 'return=representation' }
    });
    const beforeRow = (before && before[0]) || {};

    await sbFetch(`/officers?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { list_key: 'terminated', time, notes },
      extraHeaders: { Prefer: 'return=minimal' }
    });

    // Strip their rank role — no replacement, since "terminated" has no
    // corresponding Discord role. Never blocks the termination if it fails.
    await syncRankRole({
      guildId: process.env.DISCORD_GUILD_ID,
      botToken: process.env.DISCORD_BOT_TOKEN,
      discordUserId: beforeRow.discord,
      oldRank: beforeRow.rank,
      oldListKey: beforeRow.list_key,
      newRank: null,
      newListKey: null
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('terminate failed:', err);
    res.status(500).json({ error: 'Failed to terminate officer' });
  }
};
