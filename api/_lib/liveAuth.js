const { fetchGuildMember, fetchGuildRoles } = require('./discord');
const { computePermissions } = require('./permissions');

// session.perms (from the signed session cookie — see session.js) is
// computed ONCE at login and cached for up to 7 days. If a role is
// granted and later stripped — or the person is kicked from the
// server entirely — their existing session keeps the OLD, possibly
// elevated perms until the cookie expires or they explicitly log out
// and back in. That gap is exactly how someone holding NO current
// Discord roles was still able to use privileged actions like Add.
//
// Every endpoint that gates a write on a permission MUST call this
// and check the returned (live) perms — never session.perms directly.
// session.id/username/avatar from the cookie are still fine to use for
// identity (who's making the request), just not for what they're
// allowed to do.
async function getLivePerms(session) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const botToken = process.env.DISCORD_BOT_TOKEN;

  const member = await fetchGuildMember(guildId, session.id, botToken);
  if (!member) {
    // No longer even a guild member — zero permissions, regardless of
    // whatever the stale cookie says.
    return computePermissions([], []);
  }

  const roles = await fetchGuildRoles(guildId, botToken);
  const roleIdToName = Object.fromEntries(roles.map(r => [r.id, r.name]));
  const roleIds = member.roles || [];
  const roleNames = roleIds.map(id => roleIdToName[id]).filter(Boolean);

  return computePermissions(roleNames, roleIds);
}

module.exports = { getLivePerms };
