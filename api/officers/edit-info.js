const { getSession } = require('../_lib/session');
const { sbFetch } = require('../_lib/supabase');

// Only these two fields can be edited this way — everything else on an
// officer's record goes through its own dedicated endpoint (promote,
// terminate, fto, checklist).
const ALLOWED_FIELDS = ['unit', 'discord'];

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not logged in' });
  if (!session.perms.canEditOfficerInfo) return res.status(403).json({ error: 'You do not have permission to edit officer info' });

  const { id, field, value } = req.body || {};
  if (!id || !ALLOWED_FIELDS.includes(field)) return res.status(400).json({ error: 'Invalid request' });

  try {
    await sbFetch(`/officers?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { [field]: value || '' },
      extraHeaders: { Prefer: 'return=minimal' }
    });
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('edit officer info failed:', err);
    res.status(500).json({ error: 'Failed to update officer info' });
  }
};
