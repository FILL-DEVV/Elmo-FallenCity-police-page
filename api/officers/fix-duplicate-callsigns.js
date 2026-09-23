const { getSession } = require('../_lib/session');
const { sbFetch } = require('../_lib/supabase');

// ---------- TEMPORARY: one-off cleanup for duplicate callsigns caused by
// a bug in nextCallsignForRank() — ranks with no callsign code of their
// own (Operator, Detective) silently inherit a callsign from the rank
// they were promoted from (TOU trial, Trial Detective), but the old
// collision check only looked at officers with the exact same CURRENT
// rank, so it never saw that an already-promoted Operator/Detective was
// still sitting on that number. A new hire at the source rank could then
// be handed the same callsign. That bug is fixed in index.html and
// migrate-structure.js; this endpoint repairs the duplicates it already
// produced. For every callsign held by more than one officer: the
// earliest-created officer keeps it, everyone else gets reassigned to
// the next free number in their rank's proper block (or, for a rank with
// no code of its own, the next free number under the same letter prefix
// their current callsign already uses). Delete this file, its route,
// and the temporary "Fix duplicate callsigns" button in index.html once
// this has been run.

// Every rank's callsign block, by division — mirrors DIVISION_RANK_CODES
// in index.html. Operator and Detective are listed explicitly here
// (pointing at their source rank's block) purely so a genuinely free
// slot can still be found for them if THEY turn out to be the one that
// needs reassigning out of a duplicate pair.
const CALLSIGN_CODES = {
  general: {
    'Inspector': ['GD', 100], 'Senior Sergeant': ['GD', 200], 'Incremental Sergeant': ['GD', 300],
    'GD supervisor': ['GD', 301], 'Leading Senior Constable': ['GD', 400],
    'Incremental Senior Constable': ['GD', 500], 'Senior Constable': ['GD', 550],
    'Constable': ['GD', 600], 'Probationary Constable': ['GD', 700], 'student': ['GD', 800]
  },
  highway: {
    'Inspector': ['TRF', 100], 'Senior Sergeant': ['TRF', 200], 'Incremental Sergeant': ['TRF', 300],
    'GD supervisor': ['TRF', 301], 'Leading Senior Constable': ['TRF', 400],
    'Incremental Senior Constable': ['TRF', 500], 'Senior Constable': ['TRF', 550],
    'Constable': ['TRF', 600]
  },
  tou: {
    'Inspector': ['TOU', 100], 'Senior Sergeant': ['TOU', 200], 'Incremental Sergeant': ['TOU', 300],
    'TOU Supervisor': ['TOU', 301], 'Lead Operator': ['TOU', 400], 'Senior Operator': ['TOU', 500],
    'TOU trial': ['TOU', 550], 'Operator': ['TOU', 550]
  },
  crime: {
    'Inspector': ['CIU', 100], 'Senior Sergeant': ['CIU', 200], 'Incremental Sergeant': ['CIU', 300],
    'Detective Supervisor': ['CIU', 301], 'Lead Detective': ['CIU', 400], 'Senior Detective': ['CIU', 500],
    'Trial Detective': ['CIU', 550], 'Detective': ['CIU', 550]
  },
  afp: {
    'Inspector': ['AFP', 100], 'Senior Sergeant': ['AFP', 200], 'Incremental Sergeant': ['AFP', 300],
    'GD supervisor': ['AFP', 301], 'Leading Senior Constable': ['AFP', 400],
    'Incremental Senior Constable': ['AFP', 550], 'Senior Constable': ['AFP', 500],
    'Constable': ['AFP', 600]
  }
};
// Exec ranks (Police liaison through Chief Inspector) share one PD-wide
// block regardless of which division they're logged under.
const EXEC_CALLSIGN_CODES = {
  'Police liaison': ['PL', 100], 'Commissioner': ['COM', 100], 'Deputy Commissioner': ['COM', 200],
  'Assistant Commissioner': ['COM', 300], 'Chief Superintendent': ['CMD', 100],
  'Superintendent': ['CMD', 200], 'Chief Inspector': ['CMD', 300]
};

function codeFor(listKey, rank) {
  if (EXEC_CALLSIGN_CODES[rank]) return EXEC_CALLSIGN_CODES[rank];
  const d = CALLSIGN_CODES[listKey];
  return (d && d[rank]) || null;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not logged in' });
  if (!session.perms.canImportRoster) return res.status(403).json({ error: 'You do not have permission to run this' });

  const summary = { duplicateGroups: 0, reassigned: 0, errors: [], details: [] };

  try {
    const officers = await sbFetch('/officers?select=id,list_key,rank,callsign,unit,created');
    const allUsed = new Set(officers.map(o => o.callsign).filter(Boolean));

    const byCallsign = {};
    officers.forEach(o => {
      if (!o.callsign) return;
      (byCallsign[o.callsign] = byCallsign[o.callsign] || []).push(o);
    });

    for (const group of Object.values(byCallsign)) {
      if (group.length < 2) continue;
      summary.duplicateGroups++;
      // Keep the earliest-created officer's callsign unchanged; reassign
      // everyone else who was handed the same number.
      const sorted = group.slice().sort((a, b) => (a.created || 0) - (b.created || 0));
      for (const o of sorted.slice(1)) {
        const code = codeFor(o.list_key, o.rank);
        let prefix, base;
        if (code) {
          [prefix, base] = code;
        } else {
          const m = /^([A-Z]+)-(\d+)$/.exec(o.callsign || '');
          prefix = m ? m[1] : String(o.list_key || 'X').toUpperCase();
          base = 1;
        }
        let n = base;
        let candidate = prefix + '-' + n;
        while (allUsed.has(candidate)) { n++; candidate = prefix + '-' + n; }
        allUsed.add(candidate);
        try {
          await sbFetch(`/officers?id=eq.${encodeURIComponent(o.id)}`, {
            method: 'PATCH',
            body: { callsign: candidate },
            extraHeaders: { Prefer: 'return=minimal' }
          });
          summary.reassigned++;
          summary.details.push((o.unit || o.id) + ': ' + o.callsign + ' -> ' + candidate);
        } catch (e) {
          summary.errors.push(o.id + ': ' + e.message);
        }
      }
    }

    res.status(200).json(summary);
  } catch (err) {
    console.error('fix-duplicate-callsigns failed:', err);
    res.status(500).json({ error: 'Fix failed: ' + err.message });
  }
};
