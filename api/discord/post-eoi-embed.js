const { getSession } = require('../_lib/session');
const { sendChannelPayload } = require('../_lib/discord');
const { buildEoiSelectPayload, EOI_CHANNEL_ID } = require('../_lib/eoiConfig');

// Posts (or re-posts) the "Certification EOIs" dropdown embed — call
// this again after editing CERTIFICATIONS in eoiConfig.js to refresh
// the options shown in the dropdown. Gated to full promote access
// (Senior Sergeant+ / Incremental Sergeant / DOJ), same as the other
// admin-ish actions in this app.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not logged in' });
  if (!(session.perms.canPromoteAny || session.perms.isDOJ)) {
    return res.status(403).json({ error: 'You do not have permission to post this' });
  }

  try {
    await sendChannelPayload(EOI_CHANNEL_ID, process.env.DISCORD_BOT_TOKEN, buildEoiSelectPayload());
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('post-eoi-embed failed:', err);
    res.status(500).json({ error: 'Failed to post embed' });
  }
};
