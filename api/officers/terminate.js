const { getSession } = require('../_lib/session');
const { sbFetch } = require('../_lib/supabase');
const { setMemberRoles } = require('../_lib/discord');

function isDiscordId(v) {
  return typeof v === 'string' && /^\d{15,25}$/.test(v);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not logged in' });
  if (!session.perms.canTerminate) return res.status(403).json({ error: 'You do not have permission to terminate officers' });

  const { id, time, notes } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Missing officer id' });

  try {
    // Read their Discord ID before overwriting the record.
    const before = await sbFetch(`/officers?id=eq.${encodeURIComponent(id)}&select=discord`, {
      extraHeaders: { Prefer: 'return=representation' }
    });
    const beforeRow = (before && before[0]) || {};

    await sbFetch(`/officers?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { list_key: 'terminated', time, notes },
      extraHeaders: { Prefer: 'return=minimal' }
    });

    // Wipe every Discord role they hold. Never blocks the termination if
    // it fails (no Discord ID on file, a role sits above the bot in the
    // hierarchy, member already left the server, etc).
    if (isDiscordId(beforeRow.discord)) {
      try {
        await setMemberRoles(process.env.DISCORD_GUILD_ID, beforeRow.discord, [], process.env.DISCORD_BOT_TOKEN);
      } catch (roleErr) {
        console.error('Could not wipe roles on termination:', roleErr);
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('terminate failed:', err);
    res.status(500).json({ error: 'Failed to terminate officer' });
  }
};
