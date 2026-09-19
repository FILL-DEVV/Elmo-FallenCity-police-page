const { getSession } = require('../_lib/session');
const { sbFetch } = require('../_lib/supabase');
const { syncRankRole } = require('../_lib/roleSync');
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
  if (!session.perms.canAdd) return res.status(403).json({ error: 'You do not have permission to add officers' });

  // divisionLabel is only used for the announcement below — it isn't an
  // officers table column, so it's split out before the insert.
  const { divisionLabel, ...entry } = req.body || {};
  if (!entry.id || !entry.list_key || !entry.callsign) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    await sbFetch('/officers', {
      method: 'POST',
      body: entry,
      extraHeaders: { Prefer: 'return=minimal' }
    });

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
