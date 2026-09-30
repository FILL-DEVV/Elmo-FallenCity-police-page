const { getSession } = require('../_lib/session');
const { getLivePerms } = require('../_lib/liveAuth');
const { sbFetch } = require('../_lib/supabase');
const { syncRankRole, syncMilestoneRoles } = require('../_lib/roleSync');
const { sendChannelMessage, addMemberRole, removeMemberRole } = require('../_lib/discord');

// #role-request channel — same one promotions are announced to.
// https://discord.com/channels/1401963000935485600/1524244391974404126
const ROLE_REQUEST_CHANNEL_ID = '1524244391974404126';

// Every new officer gets these roles added (e.g. base "member" / "officer"
// roles) and this one removed (e.g. an "applicant" or "pending" role),
// on top of the rank+division role from syncRankRole above.
const NEW_OFFICER_ADD_ROLE_IDS = ['1475023066265550919', '1401964701688270948', '1401964701008658473'];
const NEW_OFFICER_REMOVE_ROLE_ID = '1470307178199122021';

function isDiscordId(v) {
  return typeof v === 'string' && /^\d{15,25}$/.test(v);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not logged in' });

  // Never trust session.perms here — it's baked into the cookie at
  // login and can be up to 7 days stale. Re-check against this
  // person's CURRENT Discord roles so a stripped role (or a kick from
  // the server) takes effect immediately, not whenever they next log
  // in. See liveAuth.js for why.
  let livePerms;
  try {
    livePerms = await getLivePerms(session);
  } catch (err) {
    console.error('Could not verify live Discord roles for add:', err);
    return res.status(503).json({ error: 'Could not verify your permissions right now — try again' });
  }
  if (!livePerms.canAdd) return res.status(403).json({ error: 'You do not have permission to add officers' });

  // divisionLabel is only used for the announcement below — it isn't an
  // officers table column, so it's split out before the insert.
  const { divisionLabel, ...entry } = req.body || {};
  if (!entry.id || !entry.list_key || !entry.callsign) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // promo (the roster's "Promotion officer" column) is stamped from the
  // verified session, never trusted from the client — same as
  // promote.js — so it can't be left blank or spoofed by whatever the
  // Add form's free-text field happened to contain.
  entry.promo = session.username;

  // Add can now only ever create a brand-new student — never trusted
  // from the client (the rank <select> is UI-only and can be bypassed
  // by calling this endpoint directly), so it's forced here regardless
  // of what the request sent. Promoting a student to a real rank is a
  // separate, already-gated action (see promote.js).
  entry.rank = 'student';

  try {
    await sbFetch('/officers', {
      method: 'POST',
      body: entry,
      extraHeaders: { Prefer: 'return=minimal' }
    });

    // Log this addition into the same table (and Promotion logs tab)
    // promotions use, so every new roster row is traceable to who added
    // it — not just this row's own promo display field, which a later
    // promotion would overwrite anyway. promoted_by_id is the ADDER's own
    // Discord ID (the person who actually clicked Add officer), taken
    // from the verified session — never the ID of the officer being
    // added, and never trusted from the client. from_rank/from_division
    // are left null as the "this was a brand-new add, not a promotion"
    // marker; the frontend renders that as "New addition". Best-effort —
    // a logging failure never blocks the add itself.
    try {
      await sbFetch('/promotion_log', {
        method: 'POST',
        body: {
          id: 'a' + Date.now() + Math.random().toString(36).slice(2, 7),
          name: entry.unit || entry.callsign,
          callsign: entry.callsign,
          from_rank: null,
          from_division: null,
          to_rank: entry.rank,
          to_division: divisionLabel || '',
          promoted_by: session.username,
          promoted_by_id: session.id,
          date: entry.time || null,
          created: Date.now()
        },
        extraHeaders: { Prefer: 'return=minimal' }
      });
    } catch (logErr) {
      console.error('Could not log new officer addition:', logErr);
    }

    // Assign their starting Discord role. Never blocks the add if it
    // fails (missing role, no Discord ID, etc).
    await syncRankRole({
      guildId: process.env.DISCORD_GUILD_ID,
      botToken: process.env.DISCORD_BOT_TOKEN,
      discordUserId: entry.discord,
      oldRank: null,
      oldListKey: null,
      newRank: entry.rank,
      newListKey: entry.list_key
    });

    // Grant the fixed Sergeant / Incremental Sergeant+ leadership roles if
    // they're being added directly at that rank or above (no old state to
    // strip, since they're brand new).
    await syncMilestoneRoles({
      guildId: process.env.DISCORD_GUILD_ID,
      botToken: process.env.DISCORD_BOT_TOKEN,
      discordUserId: entry.discord,
      oldRank: null,
      oldListKey: null,
      newRank: entry.rank,
      newListKey: entry.list_key
    });

    // Fixed onboarding roles: add the standard set, remove the pending one.
    // Never blocks the add if it fails (no Discord ID, missing permission, etc).
    if (isDiscordId(entry.discord)) {
      for (const roleId of NEW_OFFICER_ADD_ROLE_IDS) {
        try {
          await addMemberRole(process.env.DISCORD_GUILD_ID, entry.discord, roleId, process.env.DISCORD_BOT_TOKEN);
        } catch (e) {
          console.error('Could not add onboarding role ' + roleId + ':', e);
        }
      }
      try {
        await removeMemberRole(process.env.DISCORD_GUILD_ID, entry.discord, NEW_OFFICER_REMOVE_ROLE_ID, process.env.DISCORD_BOT_TOKEN);
      } catch (e) {
        console.error('Could not remove pending role ' + NEW_OFFICER_REMOVE_ROLE_ID + ':', e);
      }
    }

    // Announce the new officer in #role-request. Never blocks the add
    // if it fails.
    try {
      const officerName = entry.unit || entry.callsign || 'Unknown officer';
      const mention = isDiscordId(entry.discord) ? `<@${entry.discord}>` : officerName;
      const content = `${mention} ${officerName} + ${divisionLabel || ''}, ${entry.rank} ; Callsign ${entry.callsign}`;
      await sendChannelMessage(ROLE_REQUEST_CHANNEL_ID, process.env.DISCORD_BOT_TOKEN, content);
    } catch (announceErr) {
      console.error('New officer announce failed:', announceErr);
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('add officer failed:', err);
    res.status(500).json({ error: 'Failed to add officer' });
  }
};
