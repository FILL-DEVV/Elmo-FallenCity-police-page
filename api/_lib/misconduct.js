const { sbFetch } = require('./supabase');
const { computePermissions } = require('./permissions');
const { sendChannelPayload, deleteChannelMessage } = require('./discord');

// Misconduct system — lives in a library file (not its own api/ route)
// because the project is at Vercel's Hobby function cap; api/eoi/actions.js
// routes the three misconduct-* actions here.
//
//   misconduct-create { officerId, severity, title, details }
//       Incremental Sergeant+ (any division). Superintendent+ send
//       immediately; everyone else's goes to a Superintendent+ for
//       approval first and only posts to Discord once approved.
//   misconduct-review { misconductId, decision: 'approve' | 'deny' }
//       Superintendent+ only.
//   misconduct-list {}
//       Incremental Sergeant+ — every record, newest first.

// Where the officer-facing message is posted, and where the "needs
// approval" alert (pinging the approver role) is posted.
const MISCONDUCT_CHANNEL_ID = '1554062634574151820';
const APPROVAL_CHANNEL_ID = '1554062368818856026';
const APPROVAL_ROLE_ID = '1445015107255013396';
const SITE_URL = 'https://www.fallenpd.com';

// Severities: minor < major < critical. 2 minor misconducts count as 1
// major, and 1 critical counts as MAJORS_PER_CRITICAL majors; an officer
// whose total (counting those conversions) reaches 3 majors is flagged.
// Only APPROVED records count — pending and denied ones are logged but
// never counted against anyone.
const SEVERITIES = ['minor', 'major', 'critical'];
const MINORS_PER_MAJOR = 2;
const MAJORS_PER_CRITICAL = 3;
const FLAG_AT_EFFECTIVE_MAJORS = 3;

const TITLE_MAX = 100;
const DETAILS_MAX = 1800;

// Permissions are derived from the session's stored role NAMES at request
// time (not from the perms object baked into the cookie at login), so
// these work for people who logged in before this feature existed —
// no forced re-login.
function misconductPerms(session) {
  const p = computePermissions(session.roleNames || [], session.roleIds || []);
  return {
    canSend: !!p.canSendMisconduct,
    canView: !!p.canViewMisconduct,
    canApprove: !!p.canApproveMisconduct
  };
}

function tally(rows) {
  let minor = 0;
  let major = 0;
  let critical = 0;
  (rows || []).forEach((r) => {
    if (r.status && r.status !== 'approved') return;
    if (r.severity === 'critical') critical++;
    else if (r.severity === 'major') major++;
    else minor++;
  });
  const effective = major + critical * MAJORS_PER_CRITICAL + Math.floor(minor / MINORS_PER_MAJOR);
  return { minor, major, critical, effective, flagged: effective >= FLAG_AT_EFFECTIVE_MAJORS };
}

// The roster's "Discord ID" column is free text; only a real numeric
// Discord ID (optionally wrapped as <@id>) can actually be pinged.
function pingableId(raw) {
  const cleaned = String(raw || '').trim().replace(/^<@!?(\d+)>$/, '$1');
  return /^\d{17,20}$/.test(cleaned) ? cleaned : null;
}

function sevLabel(severity) {
  return severity === 'critical' ? 'Critical' : severity === 'major' ? 'Major' : 'Minor';
}

function clip(text, max) {
  const s = String(text == null ? '' : text);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function buildMisconductMessage(row, totals) {
  const pingId = pingableId(row.officer_discord);
  const label = sevLabel(row.severity);
  const officer = row.officer_name + (row.officer_callsign ? ' (' + row.officer_callsign + ')' : '');

  const fields = [
    { name: 'Officer', value: clip(officer, 1000), inline: true },
    { name: 'Issued by', value: clip(row.created_by, 1000), inline: true }
  ];
  if (row.reviewed_by && row.reviewed_by !== row.created_by) {
    fields.push({ name: 'Approved by', value: clip(row.reviewed_by, 1000), inline: true });
  }
  const parts = [totals.minor + ' minor', totals.major + ' major'];
  if (totals.critical) parts.push(totals.critical + ' critical');
  fields.push({
    name: 'Record',
    value: parts.join(' · ') + ' · ' + totals.effective + ' counted as major' + (totals.effective === 1 ? '' : 's') +
      ' (' + MINORS_PER_MAJOR + ' minors = 1 major' + (totals.critical ? '; 1 critical = ' + MAJORS_PER_CRITICAL + ' majors' : '') + ')'
  });
  if (totals.flagged) {
    fields.push({ name: 'Notice', value: 'This officer now has ' + FLAG_AT_EFFECTIVE_MAJORS + ' or more major misconducts on record.' });
  }

  return {
    content: pingId
      ? '<@' + pingId + '> you have received a **' + label + '** misconduct.'
      : '**' + clip(row.officer_name, 200) + '** has received a **' + label + '** misconduct.',
    // The officer is the ONLY thing this message may ping — the details
    // text is typed by staff and must never be able to @everyone or ping
    // a role.
    allowed_mentions: { parse: [], users: pingId ? [pingId] : [] },
    embeds: [{
      title: clip(label + ' misconduct — ' + row.title, 250),
      description: clip(row.details, 4000),
      color: row.severity === 'critical' ? 0xc62828 : row.severity === 'major' ? 0xe06a5f : 0xd99a1f,
      fields,
      footer: { text: 'FallenPD Roster' },
      timestamp: new Date().toISOString()
    }]
  };
}

// Posts the officer-facing message for an already-APPROVED record (so its
// own row is included in the totals). Best-effort: returns false instead
// of throwing, so the record itself is never lost to a Discord hiccup.
async function deliver(row) {
  try {
    const approved = await sbFetch(
      '/misconduct?officer_id=eq.' + encodeURIComponent(row.officer_id) + '&status=eq.approved&select=severity,status'
    );
    const message = await sendChannelPayload(
      MISCONDUCT_CHANNEL_ID,
      process.env.DISCORD_BOT_TOKEN,
      buildMisconductMessage(row, tally(approved))
    );
    await sbFetch('/misconduct?id=eq.' + encodeURIComponent(row.id), {
      method: 'PATCH',
      body: { message_id: message.id },
      extraHeaders: { Prefer: 'return=minimal' }
    });
    return true;
  } catch (e) {
    console.error('misconduct: could not post misconduct message:', e);
    return false;
  }
}

async function postApprovalAlert(row) {
  try {
    const message = await sendChannelPayload(APPROVAL_CHANNEL_ID, process.env.DISCORD_BOT_TOKEN, {
      content:
        '<@&' + APPROVAL_ROLE_ID + '> Misconduct awaiting approval — **' + sevLabel(row.severity) + '** for **' +
        clip(row.officer_name, 100) + '**' + (row.officer_callsign ? ' (' + row.officer_callsign + ')' : '') +
        ', submitted by ' + clip(row.created_by, 100) + ': **' + clip(row.title, TITLE_MAX) + '** — ' +
        SITE_URL + '/?misconduct=' + encodeURIComponent(row.id),
      allowed_mentions: { parse: [], roles: [APPROVAL_ROLE_ID] }
    });
    await sbFetch('/misconduct?id=eq.' + encodeURIComponent(row.id), {
      method: 'PATCH',
      body: { notify_channel_id: APPROVAL_CHANNEL_ID, notify_message_id: message.id },
      extraHeaders: { Prefer: 'return=minimal' }
    });
  } catch (e) {
    console.error('misconduct: could not post approval alert:', e);
  }
}

async function handleCreate(req, res, session) {
  const perms = misconductPerms(session);
  if (!perms.canSend) {
    return res.status(403).json({ error: 'You do not have permission to send misconduct' });
  }

  const body = req.body || {};
  const severity = SEVERITIES.includes(body.severity) ? body.severity : null;
  const title = String(body.title || '').trim();
  const details = String(body.details || '').trim();
  const officerId = String(body.officerId || '').trim();

  if (!officerId) return res.status(400).json({ error: 'Choose an officer.' });
  if (!severity) return res.status(400).json({ error: 'Choose a severity: minor, major or critical.' });
  if (!title) return res.status(400).json({ error: 'Enter a title for the misconduct.' });
  if (title.length > TITLE_MAX) return res.status(400).json({ error: 'Title must be ' + TITLE_MAX + ' characters or fewer.' });
  if (!details) return res.status(400).json({ error: 'Enter the misconduct details.' });
  if (details.length > DETAILS_MAX) return res.status(400).json({ error: 'Details must be ' + DETAILS_MAX + ' characters or fewer.' });

  // Officer identity comes from the roster row, never from the client.
  const officerRows = await sbFetch(
    '/officers?id=eq.' + encodeURIComponent(officerId) + '&list_key=neq.terminated&select=id,callsign,unit,discord&limit=1'
  );
  const officer = officerRows && officerRows[0];
  if (!officer) return res.status(400).json({ error: 'That officer could not be found on the roster.' });

  // Repeat-click guard: the same person sending the exact same thing to
  // the same officer within two minutes is a double submit, not a second
  // misconduct.
  const recent = await sbFetch(
    '/misconduct?created_by_id=eq.' + encodeURIComponent(session.id) +
    '&officer_id=eq.' + encodeURIComponent(officer.id) +
    '&title=eq.' + encodeURIComponent(title) +
    '&created=gte.' + (Date.now() - 120000) + '&select=id&limit=1'
  );
  if (recent && recent.length > 0) {
    return res.status(400).json({ error: 'You already submitted this misconduct a moment ago.' });
  }

  const autoApprove = perms.canApprove;
  const now = Date.now();
  const row = {
    id: 'mc' + now + Math.random().toString(36).slice(2, 7),
    officer_id: officer.id,
    officer_name: officer.unit || officer.callsign || 'Unknown officer',
    officer_callsign: officer.callsign || '',
    officer_discord: officer.discord || '',
    severity,
    title,
    details,
    created_by: session.username,
    created_by_id: session.id,
    created: now,
    status: autoApprove ? 'approved' : 'pending',
    reviewed_by: autoApprove ? session.username : null,
    reviewed_at: autoApprove ? now : null
  };
  await sbFetch('/misconduct', { method: 'POST', body: row, extraHeaders: { Prefer: 'return=minimal' } });

  if (autoApprove) {
    const sent = await deliver(row);
    return res.status(200).json({
      ok: true,
      status: 'approved',
      warning: sent ? undefined : 'The misconduct was saved, but the Discord message could not be sent.'
    });
  }

  await postApprovalAlert(row);
  return res.status(200).json({ ok: true, status: 'pending' });
}

async function handleReview(req, res, session) {
  const perms = misconductPerms(session);
  if (!perms.canApprove) {
    return res.status(403).json({ error: 'Only Superintendent and above can approve or deny misconduct' });
  }

  const { misconductId, decision } = req.body || {};
  if (!misconductId || (decision !== 'approve' && decision !== 'deny')) {
    return res.status(400).json({ error: 'Missing misconductId or invalid decision' });
  }

  const existing = await sbFetch('/misconduct?id=eq.' + encodeURIComponent(misconductId) + '&select=id,status&limit=1');
  if (!existing || !existing[0]) return res.status(404).json({ error: 'Misconduct record not found' });
  if (existing[0].status !== 'pending') {
    return res.status(400).json({ error: 'This misconduct has already been reviewed.' });
  }

  // Claim it atomically — the status=pending filter means if two
  // approvers click at once, only one PATCH matches a row and the other
  // gets an empty result.
  const claimed = await sbFetch('/misconduct?id=eq.' + encodeURIComponent(misconductId) + '&status=eq.pending', {
    method: 'PATCH',
    body: {
      status: decision === 'approve' ? 'approved' : 'denied',
      reviewed_by: session.username,
      reviewed_at: Date.now()
    },
    extraHeaders: { Prefer: 'return=representation' }
  });
  const row = claimed && claimed[0];
  if (!row) return res.status(400).json({ error: 'This misconduct has already been reviewed.' });

  // The "needs approval" alert has done its job either way.
  if (row.notify_channel_id && row.notify_message_id) {
    try {
      await deleteChannelMessage(row.notify_channel_id, row.notify_message_id, process.env.DISCORD_BOT_TOKEN);
    } catch (e) {
      console.error('misconduct review: could not delete approval alert:', e);
    }
  }

  if (decision === 'approve') {
    const sent = await deliver(row);
    return res.status(200).json({
      ok: true,
      status: 'approved',
      warning: sent ? undefined : 'Approved and saved, but the Discord message could not be sent.'
    });
  }
  return res.status(200).json({ ok: true, status: 'denied' });
}

async function handleList(req, res, session) {
  const perms = misconductPerms(session);
  if (!perms.canView) {
    return res.status(403).json({ error: 'You do not have permission to view misconduct records' });
  }
  const records = await sbFetch(
    '/misconduct?select=id,officer_id,officer_name,officer_callsign,severity,title,details,created_by,created,status,reviewed_by,reviewed_at&order=created.desc&limit=2000'
  );
  return res.status(200).json({ records: records || [] });
}

module.exports = {
  handleCreate, handleReview, handleList,
  // exported for tests
  tally, pingableId, buildMisconductMessage, misconductPerms,
  MISCONDUCT_CHANNEL_ID, APPROVAL_CHANNEL_ID, APPROVAL_ROLE_ID
};
