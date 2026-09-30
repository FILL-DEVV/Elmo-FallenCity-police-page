const { getSession } = require('../_lib/session');
const { getLivePerms } = require('../_lib/liveAuth');
const { sbFetch } = require('../_lib/supabase');
const { sendChannelMessage } = require('../_lib/discord');
const { syncRankRole, syncMilestoneRoles } = require('../_lib/roleSync');

// #role-request channel — pinned by ID rather than looked up by name.
// https://discord.com/channels/1401963000935485600/1524244391974404126
const ROLE_REQUEST_CHANNEL_ID = '1524244391974404126';

function isDiscordId(v) {
  return typeof v === 'string' && /^\d{15,25}$/.test(v);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not logged in' });

  const { id, listKey, callsign, rank, time, logEntry, toDivisionLabel } = req.body || {};
  if (!id || !listKey || !rank) return res.status(400).json({ error: 'Missing required fields' });

  // See liveAuth.js — session.perms is cached at login for up to 7
  // days, so a stripped role wouldn't otherwise take effect until the
  // person's next login.
  let livePerms;
  try {
    livePerms = await getLivePerms(session);
  } catch (err) {
    console.error('Could not verify live Discord roles for promote:', err);
    return res.status(503).json({ error: 'Could not verify your permissions right now — try again' });
  }

  try {
    // Read the officer's CURRENT record before authorizing or overwriting
    // it — both the permission check below and the announcement/role
    // sync further down need the real current rank, callsign, division
    // and Discord ID, taken from the database rather than trusted from
    // the browser.
    const before = await sbFetch(`/officers?id=eq.${encodeURIComponent(id)}&select=callsign,unit,discord,rank,list_key`, {
      extraHeaders: { Prefer: 'return=representation' }
    });
    const beforeRow = (before && before[0]) || {};

    // Senior Sergeant+ (canPromoteAny) can promote anyone, anywhere.
    // Senior FTO+ (canPromoteStudent) without that broader access can
    // only ever advance an officer whose CURRENT rank is student — and
    // only straight to Probationary Constable in their existing
    // division, never to any other rank or division. Both checks read
    // the officer's real current rank/division from the database, not
    // from the client, so this can't be bypassed by lying in the request.
    const isStudentPromotion = beforeRow.rank === 'student';
    const allowed = livePerms.canPromoteAny || (isStudentPromotion && livePerms.canPromoteStudent);
    if (!allowed) return res.status(403).json({ error: 'You do not have permission to promote this officer' });
    if (!livePerms.canPromoteAny) {
      if (rank !== 'Probationary Constable' || listKey !== beforeRow.list_key) {
        return res.status(403).json({ error: 'You may only promote students to Probationary Constable in their current division' });
      }
    }

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

    // Swap their Discord role to match the new rank/division. Never
    // blocks the promotion if it fails (missing role, no Discord ID, etc).
    await syncRankRole({
      guildId: process.env.DISCORD_GUILD_ID,
      botToken: process.env.DISCORD_BOT_TOKEN,
      discordUserId: beforeRow.discord,
      oldRank: beforeRow.rank,
      oldListKey: beforeRow.list_key,
      newRank: rank,
      newListKey: listKey
    });

    // Sync the Sergeant / Incremental Sergeant+ leadership roles — grants
    // them on promotion into a qualifying rank, strips them on demotion
    // out of one (or on transferring to a division whose role list differs).
    await syncMilestoneRoles({
      guildId: process.env.DISCORD_GUILD_ID,
      botToken: process.env.DISCORD_BOT_TOKEN,
      discordUserId: beforeRow.discord,
      oldRank: beforeRow.rank,
      oldListKey: beforeRow.list_key,
      newRank: rank,
      newListKey: listKey
    });

    if (logEntry) {
      // The promoting officer's name AND Discord ID both come from the
      // verified session, never from the client, so neither can be
      // spoofed. promoted_by_id lets staff pin the log entry to an exact
      // Discord account rather than just a display name (which can change
      // or collide between two members).
      await sbFetch('/promotion_log', {
        method: 'POST',
        body: { ...logEntry, promoted_by: session.username, promoted_by_id: session.id },
        extraHeaders: { Prefer: 'return=minimal' }
      });

      // Announce the promotion in #role-request. A failure here (missing
      // bot permission, etc.) never fails the promotion itself — it's
      // just logged.
      try {
        const officerName = beforeRow.unit || beforeRow.callsign || 'Unknown officer';
        const mention = isDiscordId(beforeRow.discord) ? `<@${beforeRow.discord}>` : officerName;
        const content = `${mention} - ${beforeRow.callsign || '—'} ${officerName} + ${toDivisionLabel || ''}, ${rank} ; Callsign ${callsign}`;
        await sendChannelMessage(ROLE_REQUEST_CHANNEL_ID, process.env.DISCORD_BOT_TOKEN, content);
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
