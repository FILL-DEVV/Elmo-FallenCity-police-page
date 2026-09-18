const { getSession } = require('../_lib/session');
const { sbFetch } = require('../_lib/supabase');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not logged in' });
  if (!session.perms.canClearAll) return res.status(403).json({ error: 'You do not have permission to clear the roster' });

  try {
    await sbFetch('/officers?id=neq.__none__', {
      method: 'DELETE',
      extraHeaders: { Prefer: 'return=minimal' }
    });
    await sbFetch('/promotion_log?id=neq.__none__', {
      method: 'DELETE',
      extraHeaders: { Prefer: 'return=minimal' }
    });
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('clear-all failed:', err);
    res.status(500).json({ error: 'Failed to clear data' });
  }
};
