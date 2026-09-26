const { getSession } = require('../_lib/session');
const { sbFetch } = require('../_lib/supabase');
const { CERTIFICATIONS, buildPublicCatalogue, EOI_CHANNEL_ID } = require('../_lib/eoiConfig');
const { createPrivateThread, addThreadMember, sendChannelPayload } = require('../_lib/discord');
const { canReviewApplicationDivision } = require('../_lib/permissions');
const { meetsMinRank } = require('../_lib/ranks');

// Handles the whole website-based EOI flow in one function (kept
// together deliberately — Vercel's Hobby plan caps at 12 serverless
// functions, so this and the Discord acknowledge-button handler share
// the two slots freed up when the old Discord-dropdown version of this
// feature was removed):
//   GET                                         -> the public certification catalogue
//   POST { action: 'apply', certKey, answers }   -> submit an application
//   POST { action: 'review', applicationId, decision } -> staff Accept/Deny

function validateAnswers(cert, answers) {
  answers = answers || {};
  for (const q of cert.questions) {
    if (q.required && !String(answers[q.id] || '').trim()) {
      return 'Please answer: ' + q.label;
    }
  }
  return null;
}

async function handleApply(req, res, session) {
  // Mirrors the frontend's EOIs-tab gating (canViewEoi) — a session
  // that can't even see the tab shouldn't be able to submit to it by
  // calling this endpoint directly.
  if (!session.perms.canViewEoi) {
    return res.status(403).json({ error: 'You do not have permission to apply for certifications' });
  }

  const { certKey, answers } = req.body || {};
  const cert = CERTIFICATIONS[certKey];
  if (!cert) return res.status(400).json({ error: 'Unknown certification' });

  // Minimum rank is enforced against the applicant's own roster entry,
  // not anything the client sends — a session can't claim a rank it
  // doesn't hold. DOJ bypasses this, same as it bypasses every other
  // gate in the app.
  if (cert.minRank && !session.perms.isDOJ) {
    const officerRows = await sbFetch(
      `/officers?discord=eq.${encodeURIComponent(session.id)}&list_key=neq.terminated&select=rank&order=created.desc&limit=1`,
      { extraHeaders: { Prefer: 'return=representation' } }
    );
    const officer = officerRows && officerRows[0];
    if (!officer) {
      return res.status(400).json({ error: 'We could not find your officer record on file — make sure your Discord ID is set correctly on your roster entry, or contact staff.' });
    }
    if (!meetsMinRank(officer.rank, cert.minRank)) {
      return res.status(400).json({ error: 'You must be at least ' + cert.minRank + ' to apply for this certification.' });
    }
  }

  const validationError = validateAnswers(cert, answers);
  if (validationError) return res.status(400).json({ error: validationError });

  // One pending application per cert per person at a time — stops the
  // review queue filling up with duplicates from repeated submits.
  const existing = await sbFetch(
    `/eoi_applications?cert_key=eq.${encodeURIComponent(certKey)}&applicant_id=eq.${encodeURIComponent(session.id)}&status=eq.pending&select=id`,
    { extraHeaders: { Prefer: 'return=representation' } }
  );
  if (existing && existing.length > 0) {
    return res.status(400).json({ error: 'You already have a pending application for this certification.' });
  }

  const row = {
    id: 'eoi' + Date.now() + Math.random().toString(36).slice(2, 7),
    cert_key: certKey,
    applicant_id: session.id,
    applicant_name: session.username,
    answers: answers || {},
    status: 'pending',
    created: Date.now()
  };
  await sbFetch('/eoi_applications', {
    method: 'POST',
    body: row,
    extraHeaders: { Prefer: 'return=minimal' }
  });

  // Optional — only certs with both fields set ping anyone on submit.
  // notifyRoleId may be a single role ID or an array of them (pings
  // each). Never blocks the application from being saved if this fails.
  if (cert.notifyChannelId && cert.notifyRoleId) {
    try {
      const roleIds = Array.isArray(cert.notifyRoleId) ? cert.notifyRoleId : [cert.notifyRoleId];
      const mentions = roleIds.map((id) => `<@&${id}>`).join(' ');
      const link = 'https://www.fallenpd.com/?eoiApp=' + encodeURIComponent(row.id);
      await sendChannelPayload(cert.notifyChannelId, process.env.DISCORD_BOT_TOKEN, {
        content: `${mentions} New **${cert.label}** application from ${session.username} — ${link}`
      });
    } catch (e) {
      console.error('eoi apply: could not post submission notification:', e);
    }
  }

  res.status(200).json({ ok: true });
}

async function handleReview(req, res, session) {
  if (!session.perms.canPromoteAny && !session.perms.isDOJ) {
    return res.status(403).json({ error: 'You do not have permission to review applications' });
  }

  const { applicationId, decision } = req.body || {};
  if (!applicationId || (decision !== 'accept' && decision !== 'deny')) {
    return res.status(400).json({ error: 'Missing applicationId or invalid decision' });
  }

  const rows = await sbFetch(
    `/eoi_applications?id=eq.${encodeURIComponent(applicationId)}&select=*`,
    { extraHeaders: { Prefer: 'return=representation' } }
  );
  const application = rows && rows[0];
  if (!application) return res.status(404).json({ error: 'Application not found' });
  if (application.status !== 'pending') {
    return res.status(400).json({ error: 'This application has already been reviewed.' });
  }

  const cert = CERTIFICATIONS[application.cert_key];
  if (decision === 'accept' && !cert) {
    return res.status(400).json({ error: 'Certification config for this application no longer exists — cannot accept.' });
  }

  // Mirrors the frontend's per-division Review tab gating — a session
  // without that division's role (or High Command / DOJ) can't
  // Accept/Deny this application even by calling this endpoint
  // directly. Falls back to 'general' when the cert config is missing
  // (matches certDivision() on the frontend).
  const division = (cert && cert.division) || 'general';
  if (!canReviewApplicationDivision(session.perms, division)) {
    return res.status(403).json({ error: 'You do not have permission to review this division\'s applications' });
  }

  await sbFetch(`/eoi_applications?id=eq.${encodeURIComponent(applicationId)}`, {
    method: 'PATCH',
    body: {
      status: decision === 'accept' ? 'accepted' : 'denied',
      reviewed_by: session.username,
      reviewed_at: Date.now()
    },
    extraHeaders: { Prefer: 'return=minimal' }
  });

  if (decision === 'accept') {
    // Private thread = the closest thing to a message only the
    // applicant sees, without needing a persistent (Gateway-connected)
    // bot process. The Acknowledge button's custom_id carries the
    // application id, so the interactions endpoint can look up
    // everything else (cert, applicant) from the database rather than
    // needing it all crammed into the id itself.
    try {
      const thread = await createPrivateThread(EOI_CHANNEL_ID, process.env.DISCORD_BOT_TOKEN, cert.label + ' — EOI Accepted');
      await addThreadMember(thread.id, application.applicant_id, process.env.DISCORD_BOT_TOKEN);
      await sendChannelPayload(thread.id, process.env.DISCORD_BOT_TOKEN, {
        content: `<@${application.applicant_id}>`,
        embeds: [{
          title: cert.label + ' — Application Accepted',
          description: cert.acceptMessage || ('Your application for **' + cert.label + '** has been accepted. Press Acknowledge below to receive the certification role — this closes the thread.'),
          color: 0x2f8f5b
        }],
        components: [{
          type: 1,
          components: [
            { type: 2, style: 3, label: 'Acknowledge', custom_id: `eoi:ack:${applicationId}` }
          ]
        }]
      });
    } catch (e) {
      console.error('eoi review: could not create acknowledgement thread:', e);
    }
  }

  res.status(200).json({ ok: true });
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).json({ certifications: buildPublicCatalogue() });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not logged in' });

  const { action } = req.body || {};
  try {
    if (action === 'apply') return await handleApply(req, res, session);
    if (action === 'review') return await handleReview(req, res, session);
    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('eoi action "' + action + '" failed:', err);
    res.status(500).json({ error: 'Action failed' });
  }
};
