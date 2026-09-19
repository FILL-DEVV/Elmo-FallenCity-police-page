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

module.exports = { rankRoleName, divisionRoleName, syncRankRole, syncFtoRole };
