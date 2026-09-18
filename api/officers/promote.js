const { getSession } = require('../_lib/session');
const { sbFetch } = require('../_lib/supabase');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not logged in' });

  const { id, currentRank, listKey, callsign, rank, time, logEntry } = req.body || {};
  if (!id || !listKey || !rank) return res.status(400).json({ error: 'Missing required fields' });

  // Senior Sergeant+ can promote anyone. Senior FTO+ can only promote
  // an officer whose CURRENT rank is Student Police Officer.
  const isStudentPromotion = currentRank === 'Student Police Officer';
  const allowed = session.perms.canPromoteAny || (isStudentPromotion && session.perms.canPromoteStudent);
  if (!allowed) return res.status(403).json({ error: 'You do not have permission to promote this officer' });

  try {
    const payload = { rank, list_key: listKey };
    if (callsign) payload.callsign = callsign;
    if (time) payload.time = time;
    await sbFetch(`/officers?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: payload,
      extraHeaders: { Prefer: 'return=minimal' }
    });
    if (logEntry) {
      await sbFetch('/promotion_log', {
        method: 'POST',
        body: logEntry,
        extraHeaders: { Prefer: 'return=minimal' }
      });
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('promote failed:', err);
    res.status(500).json({ error: 'Failed to promote officer' });
  }
};
