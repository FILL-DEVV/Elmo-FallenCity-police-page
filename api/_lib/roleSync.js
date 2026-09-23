const { fetchGuildRoles, addMemberRole, removeMemberRole } = require('./discord');

// Ranks that always use "High Command Team" as their division-tag role,
// regardless of which division they're actually logged under.
const HCT_RANKS = new Set([
  'Commissioner', 'Deputy Commissioner', 'Assistant Commissioner',
  'Chief Superintendent', 'Superintendent', 'Chief Inspector',
  'Police liaison'
]);

// Maps the app's internal list_key to the exact division role name on
// the server.
const DIVISION_ROLE_TAG = {
  general: 'General Duties',
  highway: 'Highway Patrol',
  tou: 'Tactical Operations Unit',
  crime: 'Criminal Investigations Unit'
};

// Roles that are never removed by role sync, no matter what the swap
// would otherwise do — every PD member keeps General Duties permanently,
// even after transferring to another division.
const NEVER_REMOVE_ROLES = new Set(['general duties']);

// Full rank ladder, most senior first — same order as the app's RANKS
// list — used to work out "Incremental Sergeant and above".
const RANK_LADDER = [
  'Commissioner', 'Deputy Commissioner', 'Assistant Commissioner',
  'Chief Superintendent', 'Superintendent', 'Chief Inspector',
  'Inspector', 'Senior Sergeant', 'Incremental Sergeant', 'Sergeant',
  'Leading Senior Constable', 'Incremental Senior Constable', 'Senior Constable',
  'Constable', 'Probationary Constable', 'student'
];
const RANK_ORDER = Object.fromEntries(RANK_LADDER.map((r, i) => [r, i]));
const INCREMENTAL_SERGEANT_INDEX = RANK_ORDER['Incremental Sergeant'];

// Leadership-role IDs held while an officer is at Incremental Sergeant or
// above, by division. Chief Inspector and above route to the shared
// "High Command Team" tier instead of a real division, so they never hit
// this table — it only applies to the division-specific ladder
// (Inspector, Senior Sergeant, Incremental Sergeant themselves).
const SENIOR_TIER_ROLE_IDS = {
  general: ['1470033826892873955', '1525134536365703249', '1525134748761063677'],
  tou: ['1467025802767110329', '1525134536365703249', '1525134748761063677'],
  highway: ['1467025926234833123', '1470364089338429450', '1525134536365703249', '1525134748761063677'],
  crime: ['1467025962217767075', '1470364244225687767', '1525134536365703249', '1525134748761063677']
};

// Leadership-role IDs held specifically at the Sergeant rank (one tier
// below Incremental Sergeant), by division. Dead for crime/tou now that
// their Sergeant-tier rank was renamed (Detective Supervisor / TOU
// Supervisor) — see RANK_SPECIFIC_ROLE_IDS below, which takes over for
// those two divisions' full custom ladder — but left as-is since
// general/highway still use the plain "Sergeant" name.
const SERGEANT_TIER_ROLE_IDS = {
  general: ['1525134748761063677'],
  tou: ['1470364203503321212', '1525134748761063677'],
  highway: ['1470364089338429450', '1525134748761063677'],
  crime: ['1525134748761063677', '1470364203503321212']
};

// Explicit role-ID set an officer should hold for each rank of CIU's and
// TOU's renamed Detective/Operator ladders (Sergeant through Senior
// Constable renamed, plus a new bottom rank in CIU's case). Keyed by
// rank name directly, since these ranks don't fit the generic
// Sergeant/Incremental-Sergeant naming the two maps above were built
// around. Diffed old-rank-set vs new-rank-set on every promotion, same
// as the maps above, so a role is added when newly earned and stripped
// when no longer held — regardless of how many ranks someone jumps.
const RANK_SPECIFIC_ROLE_IDS = {
  crime: {
    'Detective Supervisor': ['1525134667714400276', '1470364244225687767'],
    'Lead Detective': ['1445629707721642045'],
    'Senior Detective': ['1545713949373243403'],
    'Detective': ['1445628002724745296'],
    'Trial Detective': ['1448247016323944680', '1445628002724745296']
  },
  tou: {
    'TOU Supervisor': ['1470364203503321212', '1525134667714400276'],
    'Lead Operator': ['1552166996723114056', '1445629707721642045'],
    'Senior Operator': ['1545713949373243403', '1535160869514903574'],
    'Operator': ['1445628002724745296', '1546481791458869268'],
    'TOU trial': ['1470030456790454324', '1445628002724745296']
  }
};

// A single blanket role held at ANY rank within that division — layered
// on top of whatever rank-specific roles apply, and (like everything
// else here) diffed automatically: it's added the moment someone is
// promoted into that division and stripped the moment they leave it,
// regardless of which specific rank they hold there.
const DIVISION_WIDE_ROLE_IDS = {
  crime: ['1525135433770729625'],
  tou: ['1525135421271441458']
};

function isDiscordId(v) {
  return typeof v === 'string' && /^\d{15,25}$/.test(v);
}

// Rank and division are two SEPARATE Discord roles (not one combined
// "Division - Rank" role) — an officer holds both at once, and each is
// swapped independently on promotion.

// The rank role name is assumed to match the app's rank string exactly
// (e.g. "Senior Constable", "Chief Inspector", "Police liaison", "student").
function rankRoleName(rank) {
  return rank || null;
}

// The division-tag role name — "High Command Team" for exec ranks and
// Police liaison, otherwise the officer's actual division — or null if
// this rank/list_key combo has no division role (e.g. terminated).
function divisionRoleName(rank, listKey) {
  if (!rank) return null;
  return HCT_RANKS.has(rank) ? 'High Command Team' : (DIVISION_ROLE_TAG[listKey] || null);
}

// The leadership/tier-specific role IDs an officer should hold for a
// given rank + division. Checks CIU/TOU's explicit per-rank map first,
// then falls back to the generic Sergeant / Incremental-Sergeant-and-
// above threshold rule used by general/highway (and by crime/tou's own
// Inspector, Senior Sergeant and Incremental Sergeant, which weren't
// renamed and still hit the threshold branch below). Every crime/tou
// rank also picks up that division's blanket role on top.
function milestoneRoleIds(rank, listKey) {
  if (!rank) return [];
  let ids = [];
  if (RANK_SPECIFIC_ROLE_IDS[listKey] && RANK_SPECIFIC_ROLE_IDS[listKey][rank]) {
    ids = RANK_SPECIFIC_ROLE_IDS[listKey][rank];
  } else if (DIVISION_ROLE_TAG[listKey]) {
    if (rank === 'Sergeant') ids = SERGEANT_TIER_ROLE_IDS[listKey] || [];
    else if (RANK_ORDER[rank] !== undefined && RANK_ORDER[rank] <= INCREMENTAL_SERGEANT_INDEX) {
      ids = SENIOR_TIER_ROLE_IDS[listKey] || [];
    }
  }
  if (DIVISION_WIDE_ROLE_IDS[listKey]) ids = ids.concat(DIVISION_WIDE_ROLE_IDS[listKey]);
  return ids;
}

// Removes a member's old named role (if any) and adds a new named role (if
// any), matched by exact name (case-insensitive) against the server's
// actual roles. Never throws — failures (no Discord ID on file, role
// missing on the server, member left the guild, etc.) are logged and
// swallowed, so a role-sync problem never blocks the roster update itself.
// A role in NEVER_REMOVE_ROLES (e.g. General Duties) is never stripped,
// even when it's the "old" role being swapped out.
async function swapNamedRole({ guildId, botToken, discordUserId, oldName, newName }) {
  if (!isDiscordId(discordUserId)) return;
  if (oldName === newName) return; // nothing to change

  let roles;
  try {
    roles = await fetchGuildRoles(guildId, botToken);
  } catch (e) {
    console.error('Role sync: could not fetch guild roles:', e);
    return;
  }
  const byName = new Map(roles.map(r => [r.name.toLowerCase(), r.id]));

  if (oldName && !NEVER_REMOVE_ROLES.has(oldName.toLowerCase())) {
    const oldId = byName.get(oldName.toLowerCase());
    if (oldId) {
      try { await removeMemberRole(guildId, discordUserId, oldId, botToken); }
      catch (e) { console.error('Role sync: could not remove role "' + oldName + '":', e); }
    } else {
      console.error('Role sync: no server role named "' + oldName + '"');
    }
  }
  if (newName) {
    const newId = byName.get(newName.toLowerCase());
    if (newId) {
      try { await addMemberRole(guildId, discordUserId, newId, botToken); }
      catch (e) { console.error('Role sync: could not add role "' + newName + '":', e); }
    } else {
      console.error('Role sync: no server role named "' + newName + '"');
    }
  }
}

// Swaps the officer's rank role AND their division-tag role independently
// — e.g. moving General Duties - Senior Constable to Tactical Operations
// Unit - Senior Constable removes/adds only the division role, since the
// rank role ("Senior Constable") doesn't change; promoting rank within the
// same division does the reverse. General Duties is never removed here —
// it's added like any other division role, but swapNamedRole refuses to
// strip it.
async function syncRankRole({ guildId, botToken, discordUserId, oldRank, oldListKey, newRank, newListKey }) {
  await swapNamedRole({
    guildId, botToken, discordUserId,
    oldName: rankRoleName(oldRank),
    newName: rankRoleName(newRank)
  });
  await swapNamedRole({
    guildId, botToken, discordUserId,
    oldName: divisionRoleName(oldRank, oldListKey),
    newName: divisionRoleName(newRank, newListKey)
  });
}

// Removes the officer's old FTO-status role (if any) and adds the new one.
// FTO status values ("FTO", "Senior FTO", "FTO supervisor", "FTO Director",
// "Head Of Academy") are assumed to match the Discord role names exactly.
async function syncFtoRole({ guildId, botToken, discordUserId, oldValue, newValue }) {
  await swapNamedRole({
    guildId, botToken, discordUserId,
    oldName: oldValue || null,
    newName: newValue || null
  });
}

// Syncs the leadership roles (Sergeant tier / Incremental Sergeant+ tier,
// or CIU/TOU's per-rank Detective/Operator sets, plus each division's
// blanket role) by diffing what the officer's OLD rank+division earned
// against what their NEW rank+division earns: roles only in the old set
// are stripped (demotion, or moving to a division with a different role
// list), roles only in the new set are added (promotion into a
// qualifying rank). A role held under both stays untouched. Pass
// oldRank/oldListKey as null for a brand-new officer (nothing to strip,
// just grants what's due).
async function syncMilestoneRoles({ guildId, botToken, discordUserId, oldRank, oldListKey, newRank, newListKey }) {
  if (!isDiscordId(discordUserId)) return;

  const oldIds = new Set(milestoneRoleIds(oldRank, oldListKey));
  const newIds = new Set(milestoneRoleIds(newRank, newListKey));
  if (oldIds.size === 0 && newIds.size === 0) return;

  for (const roleId of oldIds) {
    if (newIds.has(roleId)) continue;
    try { await removeMemberRole(guildId, discordUserId, roleId, botToken); }
    catch (e) { console.error('Leadership role remove failed for role ' + roleId + ':', e); }
  }
  for (const roleId of newIds) {
    if (oldIds.has(roleId)) continue;
    try { await addMemberRole(guildId, discordUserId, roleId, botToken); }
    catch (e) { console.error('Leadership role add failed for role ' + roleId + ':', e); }
  }
}

module.exports = { rankRoleName, divisionRoleName, syncRankRole, syncFtoRole, syncMilestoneRoles };
