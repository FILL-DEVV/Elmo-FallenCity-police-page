const { getSession } = require('../_lib/session');
const { sbFetch } = require('../_lib/supabase');

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
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('set fto failed:', err);
    res.status(500).json({ error: 'Failed to update FTO status' });
  }
};
