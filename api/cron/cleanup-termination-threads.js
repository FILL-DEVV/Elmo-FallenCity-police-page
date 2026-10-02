const { sbFetch } = require('../_lib/supabase');
const { deleteThread } = require('../_lib/discord');

const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

// Deletes every termination-notice private thread (see terminate.js)
// that's at least 48 hours old. Triggered on a schedule by Vercel Cron
// (see vercel.json) rather than something a person clicks — Discord
// has no "delete this thread in 48 hours" primitive, only fixed
// auto-archive durations (1h/24h/3d/7d), none of which land on 48h,
// and archiving isn't deleting anyway.
module.exports = async (req, res) => {
  // Vercel automatically sends `Authorization: Bearer <CRON_SECRET>`
  // on cron-triggered invocations once CRON_SECRET is set as a project
  // env var — this must be set in Vercel for the schedule to actually
  // authenticate; without it every call (including the real cron) gets
  // rejected here. Rejecting anything else keeps a stray request from
  // early-deleting threads that haven't hit 48 hours yet.
  const auth = req.headers.authorization;
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const cutoff = Date.now() - FORTY_EIGHT_HOURS_MS;
  let rows;
  try {
    rows = await sbFetch(`/termination_threads?created=lt.${cutoff}&select=id`);
  } catch (err) {
    console.error('cleanup-termination-threads: could not list due threads:', err);
    return res.status(500).json({ error: 'Could not list threads due for cleanup' });
  }

  let deleted = 0;
  let failed = 0;
  for (const row of (rows || [])) {
    try {
      await deleteThread(row.id, process.env.DISCORD_BOT_TOKEN);
    } catch (err) {
      // Leave the tracking row in place — picked up again next run.
      console.error('cleanup-termination-threads: could not delete thread ' + row.id + ':', err);
      failed++;
      continue;
    }
    try {
      await sbFetch(`/termination_threads?id=eq.${encodeURIComponent(row.id)}`, {
        method: 'DELETE',
        extraHeaders: { Prefer: 'return=minimal' }
      });
    } catch (err) {
      // The Discord thread is already gone either way — just means
      // this row will be retried next run against an already-deleted
      // (404-tolerant) thread, which is harmless.
      console.error('cleanup-termination-threads: deleted thread but could not clear tracking row for ' + row.id + ':', err);
    }
    deleted++;
  }

  res.status(200).json({ ok: true, deleted, failed });
};
