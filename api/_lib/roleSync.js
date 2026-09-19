const { fetchGuildRoles, addMemberRole, removeMemberRole } = require('./discord');

// Ranks that always use "High Command Team" as their role's division tag,
// regardless of which division they're actually logged under.
const HCT_RANKS = new Set([
  'Commissioner', 'Deputy Commissioner', 'Assistant Commissioner',
  'Chief Superintendent', 'Superintendent', 'Chief Inspector',
  'Police liaison'
]);

// Maps the app's internal list_key to the exact division name used in
// Discord role names.
const DIVISION_ROLE_TAG = {
  general: 'General Duties',
  highway: 'Highway Patrol',
  tou: 'Tactical Operations Unit',
  crime: 'Criminal Investigations Unit'
};

function isDiscordId(v) {
  return typeof v === 'string' && /^\d{15,25}$/.test(v);
}

// Builds the exact Discord role name for a rank + list_key ("Division -
// Rank"), or null if this combo has no corresponding role (e.g. terminated).
function roleNameFor(rank, listKey) {
  if (!rank) return null;
  const tag = HCT_RANKS.has(rank) ? 'High Command Team' : DIVISION_ROLE_TAG[listKey];
  if (!tag) return null;
  return `${tag} - ${rank}`;
}

// Removes a member's old named role (if any) and adds a new named role (if
// any), matched by exact name (case-insensitive) against the server's
// actual roles. Never throws — failures (no Discord ID on file, role
// missing on the server, member left the guild, etc.) are logged and
// swallowed, so a role-sync problem never blocks the roster update itself.
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

  if (oldName) {
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

// Removes the officer's old rank role (if any) and adds the new one.
async function syncRankRole({ guildId, botToken, discordUserId, oldRank, oldListKey, newRank, newListKey }) {
  await swapNamedRole({
    guildId, botToken, discordUserId,
    oldName: roleNameFor(oldRank, oldListKey),
    newName: roleNameFor(newRank, newListKey)
  });
}

// Removes the officer's old FTO-status role (if any) and adds the new one.
// FTO status values ("FTO", "Senior FTO", "Lead FTO", "FTO Director",
// "Head Of Academy") are assumed to match the Discord role names exactly.
async function syncFtoRole({ guildId, botToken, discordUserId, oldValue, newValue }) {
  await swapNamedRole({
    guildId, botToken, discordUserId,
    oldName: oldValue || null,
    newName: newValue || null
  });
}

module.exports = { roleNameFor, syncRankRole, syncFtoRole };
