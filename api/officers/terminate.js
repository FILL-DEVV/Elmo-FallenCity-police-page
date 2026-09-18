const { getSession } = require('../_lib/session');
const { sbFetch } = require('../_lib/supabase');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not logged in' });
  if (!session.perms.canTerminate) return res.status(403).json({ error: 'You do not have permission to terminate officers' });

  const { id, time, notes } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Missing officer id' });

  try {
    await sbFetch(`/officers?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { list_key: 'terminated', time, notes },
      extraHeaders: { Prefer: 'return=minimal' }
    });
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('terminate failed:', err);
    res.status(500).json({ error: 'Failed to terminate officer' });
  }
};
