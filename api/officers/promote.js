const { getSession } = require('../_lib/session');
const { sbFetch } = require('../_lib/supabase');
const { findChannelByName, sendChannelMessage } = require('../_lib/discord');

// Text channel the promotion announcement is posted to.
const ROLE_REQUEST_CHANNEL_NAME = 'role-request';

function isDiscordId(v) {
  return typeof v === 'string' && /^\d{15,25}$/.test(v);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not logged in' });

  const { id, currentRank, listKey, callsign, rank, time, logEntry, toDivisionLabel } = req.body || {};
  if (!id || !listKey || !rank) return res.status(400).json({ error: 'Missing required fields' });

  // Senior Sergeant+ can promote anyone. Senior FTO+ can only promote
  // an officer whose CURRENT rank is Student Police Officer.
  const isStudentPromotion = currentRank === 'Student Police Officer';
  const allowed = session.perms.canPromoteAny || (isStudentPromotion && session.perms.canPromoteStudent);
  if (!allowed) return res.status(403).json({ error: 'You do not have permission to promote this officer' });

  try {
    // Read the officer's CURRENT record before overwriting it — the
    // announcement below needs the old callsign and Discord ID, taken
    // from the database rather than trusted from the browser.
    const before = await sbFetch(`/officers?id=eq.${encodeURIComponent(id)}&select=callsign,unit,discord`, {
      extraHeaders: { Prefer: 'return=representation' }
    });
    const beforeRow = (before && before[0]) || {};

    // promo (the roster's "Promotion officer" column) is stamped from the
    // verified session too, same as promoted_by on the log entry below —
    // never trusted from the client.
    const payload = { rank, list_key: listKey, promo: session.username };
    if (callsign) payload.callsign = callsign;
    if (time) payload.time = time;
    await sbFetch(`/officers?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: payload,
      extraHeaders: { Prefer: 'return=minimal' }
    });
    if (logEntry) {
      // The promoting officer's name comes from the verified session,
      // never from the client, so it can't be spoofed.
      await sbFetch('/promotion_log', {
        method: 'POST',
        body: { ...logEntry, promoted_by: session.username },
        extraHeaders: { Prefer: 'return=minimal' }
      });

      // Announce the promotion in #role-request. A failure here (missing
      // channel, missing bot permission, etc.) never fails the promotion
      // itself — it's just logged.
      try {
        const channel = await findChannelByName(
          process.env.DISCORD_GUILD_ID,
          process.env.DISCORD_BOT_TOKEN,
          ROLE_REQUEST_CHANNEL_NAME
        );
        if (channel) {
          const officerName = beforeRow.unit || beforeRow.callsign || 'Unknown officer';
          const mention = isDiscordId(beforeRow.discord) ? `<@${beforeRow.discord}>` : officerName;
          const content = `${mention} - ${beforeRow.callsign || '—'} ${officerName} + ${toDivisionLabel || ''}, ${rank} ; Callsign ${callsign}`;
          await sendChannelMessage(channel.id, process.env.DISCORD_BOT_TOKEN, content);
        } else {
          console.error(`Promotion announce skipped: no channel named #${ROLE_REQUEST_CHANNEL_NAME} found`);
        }
      } catch (announceErr) {
        console.error('Promotion announce failed:', announceErr);
      }
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('promote failed:', err);
    res.status(500).json({ error: 'Failed to promote officer' });
  }
};
