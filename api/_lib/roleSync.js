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
  'Constable', 'Probationary Constable', 'Student Police Officer'
];
const RANK_ORDER = Object.fromEntries(RANK_LADDER.map((r, i) => [r, i]));
const INCREMENTAL_SERGEANT_INDEX = RANK_ORDER['Incremental Sergeant'];

// Milestone role IDs added (never removed) once an officer reaches
// Incremental Sergeant or above, by division. Chief Inspector and above
// route to the shared "High Command Team" tier instead of a real
// division, so they never hit this table — it only applies to the
// division-specific ladder (Inspector, Senior Sergeant, Incremental
// Sergeant themselves).
const SENIOR_TIER_ROLE_IDS = {
  general: ['1470033826892873955', '1525134536365703249', '1525134748761063677'],
  tou: ['1467025802767110329', '1525134536365703249', '1525134748761063677'],
  highway: ['1467025926234833123', '1470364089338429450', '1525134536365703249', '1525134748761063677'],
  crime: ['1467025962217767075', '1470364244225687767', '1525134536365703249', '1525134748761063677']
};

// Milestone role IDs added (never removed) specifically at the Sergeant
// rank (one tier below Incremental Sergeant), by division.
const SERGEANT_TIER_ROLE_IDS = {
  general: ['1525134748761063677'],
  tou: ['1470364203503321212', '1525134748761063677'],
  highway: ['1470364089338429450', '1525134748761063677'],
  crime: ['1525134748761063677', '1470364203503321212']
};

function isDiscordId(v) {
  return typeof v === 'string' && /^\d{15,25}$/.test(v);
}

// Rank and division are two SEPARATE Discord roles (not one combined
// "Division - Rank" role) — an officer holds both at once, and each is
// swapped independently on promotion.

// The rank role name is assumed to match the app's rank string exactly
// (e.g. "Senior Constable", "Chief Inspector", "Police liaison").
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

// Grants the fixed milestone role set for reaching Sergeant, or
// Incremental Sergeant and above, in a given division. These are ADDED
// ONLY — never removed, even if the officer is later promoted further or
// demoted — since they're meant as permanent qualification badges.
async function grantMilestoneRoles({ guildId, botToken, discordUserId, rank, listKey }) {
  if (!isDiscordId(discordUserId)) return;
  if (!rank || !DIVISION_ROLE_TAG[listKey]) return; // not a real division (e.g. shared/HCT, terminated)

  let idsToAdd;
  if (rank === 'Sergeant') {
    idsToAdd = SERGEANT_TIER_ROLE_IDS[listKey];
  } else if (RANK_ORDER[rank] !== undefined && RANK_ORDER[rank] <= INCREMENTAL_SERGEANT_INDEX) {
    idsToAdd = SENIOR_TIER_ROLE_IDS[listKey];
  }
  if (!idsToAdd || !idsToAdd.length) return;

  for (const roleId of new Set(idsToAdd)) {
    try { await addMemberRole(guildId, discordUserId, roleId, botToken); }
    catch (e) { console.error('Milestone role add failed for role ' + roleId + ':', e); }
  }
}

module.exports = { rankRoleName, divisionRoleName, syncRankRole, syncFtoRole, grantMilestoneRoles };
