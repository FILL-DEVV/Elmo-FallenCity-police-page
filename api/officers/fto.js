const { getSession } = require('../_lib/session');
const { sbFetch } = require('../_lib/supabase');
const { sendChannelMessage } = require('../_lib/discord');

// #role-request channel — same one promotions and new officers announce to.
// https://discord.com/channels/1401963000935485600/1524244391974404126
const ROLE_REQUEST_CHANNEL_ID = '1524244391974404126';

function isDiscordId(v) {
  return typeof v === 'string' && /^\d{15,25}$/.test(v);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not logged in' });
  if (!session.perms.canSetFto) return res.status(403).json({ error: 'You do not have permission to set FTO status' });

  const { id, value } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Missing officer id' });

  try {
    await sbFetch(`/officers?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { fto: value || '' },
      extraHeaders: { Prefer: 'return=minimal' }
    });

    // Announce granting an FTO role in #role-request. Clearing a status
    // (value is empty) is never announced. A failure here never blocks
    // the FTO update itself.
    if (value) {
      try {
        const rows = await sbFetch(`/officers?id=eq.${encodeURIComponent(id)}&select=callsign,unit,discord`, {
          extraHeaders: { Prefer: 'return=representation' }
        });
        const row = (rows && rows[0]) || {};
        const officerName = row.unit || row.callsign || 'Unknown officer';
        const mention = isDiscordId(row.discord) ? `<@${row.discord}>` : officerName;
        const content = `${mention} ${officerName} ; FTO Status: ${value}`;
        await sendChannelMessage(ROLE_REQUEST_CHANNEL_ID, process.env.DISCORD_BOT_TOKEN, content);
      } catch (announceErr) {
        console.error('FTO announce failed:', announceErr);
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('set fto failed:', err);
    res.status(500).json({ error: 'Failed to update FTO status' });
  }
};
