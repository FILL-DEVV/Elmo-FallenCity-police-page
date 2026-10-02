const { getSession } = require('../_lib/session');
const { getLivePerms } = require('../_lib/liveAuth');
const { sbFetch } = require('../_lib/supabase');
const {
  setMemberRoles, sendChannelMessage,
  createPrivateThread, addThreadMember, sendChannelPayload
} = require('../_lib/discord');

// #role-request channel — same one Add/Promote already announce to.
// https://discord.com/channels/1401963000935485600/1524244391974404126
const ROLE_REQUEST_CHANNEL_ID = '1524244391974404126';

function isDiscordId(v) {
  return typeof v === 'string' && /^\d{15,25}$/.test(v);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not logged in' });

  // See liveAuth.js — session.perms is cached at login for up to 7
  // days, so a stripped role wouldn't otherwise take effect until the
  // person's next login.
  let livePerms;
  try {
    livePerms = await getLivePerms(session);
  } catch (err) {
    console.error('Could not verify live Discord roles for terminate:', err);
    return res.status(503).json({ error: 'Could not verify your permissions right now — try again' });
  }
  if (!livePerms.canTerminate) return res.status(403).json({ error: 'You do not have permission to terminate officers' });

  const { id, time, notes } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Missing officer id' });

  try {
    // Read their full record before overwriting it — name/callsign for
    // the notifications below, Discord ID for both the role wipe and
    // reaching them at all.
    const before = await sbFetch(`/officers?id=eq.${encodeURIComponent(id)}&select=callsign,unit,discord`, {
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

    const officerName = beforeRow.unit || beforeRow.callsign || 'Unknown officer';
    const hasDiscordId = isDiscordId(beforeRow.discord);

    // Plain log post in #role-request, same as every other roster-status
    // change (Add/Promote). Deliberately leaves the reason/notes out of
    // this one — it's a public channel — the private thread below
    // carries those instead. Never blocks the termination if it fails.
    try {
      const mention = hasDiscordId ? `<@${beforeRow.discord}>` : officerName;
      await sendChannelMessage(
        ROLE_REQUEST_CHANNEL_ID,
        process.env.DISCORD_BOT_TOKEN,
        `${mention} - ${beforeRow.callsign || '—'} ${officerName} has been terminated.`
      );
    } catch (announceErr) {
      console.error('Termination announce failed:', announceErr);
    }

    // Private thread = the closest thing to a direct message a bot can
    // send without a persistent Gateway connection (same pattern as the
    // EOI-acceptance notice) — only the terminated officer and staff
    // able to see private threads will see it. Carries the reason/notes
    // if one was given. Skipped if there's no real Discord ID to add as
    // a thread member. Never blocks the termination if it fails.
    if (hasDiscordId) {
      try {
        const thread = await createPrivateThread(
          ROLE_REQUEST_CHANNEL_ID,
          process.env.DISCORD_BOT_TOKEN,
          'Termination notice — ' + (beforeRow.callsign || officerName)
        );
        await addThreadMember(thread.id, beforeRow.discord, process.env.DISCORD_BOT_TOKEN);
        await sendChannelPayload(thread.id, process.env.DISCORD_BOT_TOKEN, {
          content: `<@${beforeRow.discord}>`,
          embeds: [{
            title: 'You have been terminated from NSW Police Department (Fallen City)',
            description: notes ? `Reason given:\n${notes}` : 'No reason was given.',
            color: 0xe06a5f
          }]
        });
      } catch (threadErr) {
        console.error('Could not create termination notice thread:', threadErr);
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('terminate failed:', err);
    res.status(500).json({ error: 'Failed to terminate officer' });
  }
};
