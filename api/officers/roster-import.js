const { getSession } = require('../_lib/session');
const { sbFetch } = require('../_lib/supabase');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not logged in' });
  if (!session.perms.canImportRoster) return res.status(403).json({ error: 'You do not have permission to import rosters' });

  const rows = req.body && req.body.rows;
  if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'No rows to import' });

  try {
    await sbFetch('/officers', {
      method: 'POST',
      body: rows,
      extraHeaders: { Prefer: 'return=minimal' }
    });
    res.status(200).json({ ok: true, count: rows.length });
  } catch (err) {
    console.error('roster import failed:', err);
    res.status(500).json({ error: 'Failed to import roster' });
  }
};
