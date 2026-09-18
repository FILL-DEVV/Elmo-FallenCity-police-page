const { getSession } = require('../_lib/session');
const { sbFetch } = require('../_lib/supabase');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not logged in' });
  if (!session.perms.canAddTerminatedRecord) return res.status(403).json({ error: 'You do not have permission to add terminated records' });

  const entry = req.body || {};
  if (!entry.id || !entry.callsign) return res.status(400).json({ error: 'Missing required fields' });
  entry.list_key = 'terminated';

  try {
    await sbFetch('/officers', {
      method: 'POST',
      body: entry,
      extraHeaders: { Prefer: 'return=minimal' }
    });
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('terminated-add failed:', err);
    res.status(500).json({ error: 'Failed to add terminated record' });
  }
};
