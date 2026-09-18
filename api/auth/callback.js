const { exchangeCodeForToken, fetchDiscordUser, fetchGuildMember, fetchGuildRoles } = require('../_lib/discord');
const { computePermissions } = require('../_lib/permissions');
const { makeSessionCookie } = require('../_lib/session');

module.exports = async (req, res) => {
  const code = req.query && req.query.code;
  if (!code) {
    res.writeHead(302, { Location: '/?auth=missing_code' });
    return res.end();
  }

  try {
    const redirectUri = `https://${req.headers.host}/api/auth/callback`;
    const tokenData = await exchangeCodeForToken({
      code,
      clientId: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      redirectUri
    });

    const user = await fetchDiscordUser(tokenData.access_token);

    const member = await fetchGuildMember(
      process.env.DISCORD_GUILD_ID,
      user.id,
      process.env.DISCORD_BOT_TOKEN
    );
    if (!member) {
      res.writeHead(302, { Location: '/?auth=not_a_member' });
      return res.end();
    }

    const roles = await fetchGuildRoles(process.env.DISCORD_GUILD_ID, process.env.DISCORD_BOT_TOKEN);
    const roleIdToName = Object.fromEntries(roles.map(r => [r.id, r.name]));
    const roleNames = (member.roles || []).map(id => roleIdToName[id]).filter(Boolean);
    const perms = computePermissions(roleNames);

    // Prefer the server nickname (what everyone actually sees in this
    // Discord) over the account's global display name or username.
    const displayName = member.nick || user.global_name || user.username;

    const cookie = makeSessionCookie({
      id: user.id,
      username: displayName,
      avatar: user.avatar,
      roleNames,
      perms
    });
    res.setHeader('Set-Cookie', cookie);
    res.writeHead(302, { Location: '/' });
    res.end();
  } catch (err) {
    console.error('Discord auth callback error:', err);
    res.writeHead(302, { Location: '/?auth=error' });
    res.end();
  }
};
