const { getSession } = require('../_lib/session');
const { sbFetch } = require('../_lib/supabase');
const { syncRankRole, syncMilestoneRoles } = require('../_lib/roleSync');

// ---------- TEMPORARY: one-off backfill for the Sept 2026 rank/callsign
// restructuring (GD supervisor rename, ISC/SC callsign swap, CIU/TOU
// trial-tier callsign moves). For every officer: renames a stale rank
// string if needed, reassigns a callsign that still falls in the old
// numeric range, and grants (never removes) whatever rank, division and
// milestone roles they're now due under the new structure — existing
// officers otherwise only pick these up on their NEXT promotion. Delete
// this file, its route, and the temporary "Migrate structure" button in
// index.html once this has been run.

const RANK_RENAMES = {
  general: { 'Sergeant': 'GD supervisor' },
  highway: { 'Sergeant': 'GD supervisor' },
  tou: { 'Trial Operator': 'TOU trial' }
};

// Ranks whose numeric callsign base moved in the restructuring — any
// officer here gets a freshly assigned callsign in the new 50-wide block
// unless their current one already falls inside it. Ranks whose code was
// removed entirely (Operator, Detective) are deliberately absent — they
// keep whatever callsign they already carry.
const CALLSIGN_SPECS = {
  general: {
    'Incremental Senior Constable': { prefix: 'GD', base: 500 },
    'Senior Constable': { prefix: 'GD', base: 550 }
  },
  highway: {
    'Incremental Senior Constable': { prefix: 'TRF', base: 500 },
    'Senior Constable': { prefix: 'TRF', base: 550 }
  },
  crime: {
    'Trial Detective': { prefix: 'CIU', base: 550 }
  },
  tou: {
    'TOU trial': { prefix: 'TOU', base: 550 }
  }
};

function inRange(callsign, prefix, base) {
  const m = /^([A-Z]+)-(\d+)$/.exec(callsign || '');
  if (!m || m[1] !== prefix) return false;
  const n = parseInt(m[2], 10);
  return n >= base && n < base + 50;
}

// What an officer's rank string becomes after the rename map — used to
// seed collision-avoidance sets by the rank they're headed to, not the
// stale name still sitting in the database.
function finalRankOf(o) {
  const renameMap = RANK_RENAMES[o.list_key];
  return (renameMap && renameMap[o.rank]) || o.rank;
}

// Ranks with no callsign code of their own inherit whichever callsign
// they already carry from the rank they were promoted from — Operator
// from TOU trial, Detective from Trial Detective. A collision-avoidance
// set for "TOU trial" must therefore also account for anyone already
// promoted forward into "Operator" (same for crime), since they still
// occupy that callsign even though their current rank has moved on.
const CALLSIGN_INHERITORS = {
  tou: { 'TOU trial': ['Operator'] },
  crime: { 'Trial Detective': ['Detective'] }
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not logged in' });
  if (!session.perms.canImportRoster) return res.status(403).json({ error: 'You do not have permission to run this' });

  const guildId = process.env.DISCORD_GUILD_ID;
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const summary = { checked: 0, renamed: 0, callsignsReassigned: 0, rolesSynced: 0, errors: [] };

  try {
    const officers = await sbFetch('/officers?select=id,list_key,rank,callsign,discord');
    const usedCallsigns = {}; // "listKey|rank" -> Set of callsigns already claimed for that rank

    for (const o of officers) {
      summary.checked++;
      const oldRank = o.rank;
      let rank = finalRankOf(o);
      let callsign = o.callsign;
      let dbChanged = rank !== oldRank;

      const spec = CALLSIGN_SPECS[o.list_key] && CALLSIGN_SPECS[o.list_key][rank];
      if (spec && !inRange(callsign, spec.prefix, spec.base)) {
        const key = o.list_key + '|' + rank;
        if (!usedCallsigns[key]) {
          const inheritors = (CALLSIGN_INHERITORS[o.list_key] && CALLSIGN_INHERITORS[o.list_key][rank]) || [];
          const familyRanks = new Set([rank, ...inheritors]);
          usedCallsigns[key] = new Set(
            officers.filter(x => x.list_key === o.list_key && familyRanks.has(finalRankOf(x))).map(x => x.callsign)
          );
        }
        const used = usedCallsigns[key];
        let n = spec.base;
        while (used.has(spec.prefix + '-' + n)) n++;
        callsign = spec.prefix + '-' + n;
        used.add(callsign);
        dbChanged = true;
        summary.callsignsReassigned++;
      }

      if (dbChanged) {
        try {
          await sbFetch(`/officers?id=eq.${encodeURIComponent(o.id)}`, {
            method: 'PATCH',
            body: { rank, callsign },
            extraHeaders: { Prefer: 'return=minimal' }
          });
          if (rank !== oldRank) summary.renamed++;
        } catch (e) {
          summary.errors.push(o.id + ' (db): ' + e.message);
          continue;
        }
      }

      try {
        // Grant (never strip) the rank/division roles: passing the real
        // oldRank only when it actually changed removes the stale role
        // name; otherwise oldRank=null skips removal and just grants
        // whatever's due under the current rank if it's missing.
        await syncRankRole({
          guildId, botToken, discordUserId: o.discord,
          oldRank: rank !== oldRank ? oldRank : null,
          oldListKey: rank !== oldRank ? o.list_key : null,
          newRank: rank, newListKey: o.list_key
        });
        // Grant (never strip) every milestone/blanket role due for the
        // final rank — oldRank=null means this call never removes
        // anything, only adds what's missing.
        await syncMilestoneRoles({
          guildId, botToken, discordUserId: o.discord,
          oldRank: null, oldListKey: null,
          newRank: rank, newListKey: o.list_key
        });
        summary.rolesSynced++;
      } catch (e) {
        summary.errors.push(o.id + ' (roles): ' + e.message);
      }
    }

    res.status(200).json(summary);
  } catch (err) {
    console.error('migrate-structure failed:', err);
    res.status(500).json({ error: 'Migration failed: ' + err.message });
  }
};
