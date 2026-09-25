const { exchangeCodeForToken, fetchDiscordUser, fetchGuildMember, fetchGuildRoles } = require('../_lib/discord');
const { computePermissions } = require('../_lib/permissions');
const { makeSessionCookie } = require('../_lib/session');

// Pinned to one canonical host rather than built from req.headers.host.
// Building it dynamically means a visitor on the bare apex domain vs.
// "www" gets a different redirect_uri sent to Discord — and since the
// session cookie is host-scoped, a browser that normalizes/redirects
// between the two differently at any point in the OAuth flow can end up
// with a cookie set for one host while browsing the other, so login
// silently doesn't "stick". This must exactly match the redirect URI
// registered in the Discord Developer Portal.
const CALLBACK_URL = 'https://www.fallenpd.com/api/auth/callback';

module.exports = async (req, res) => {
  const code = req.query && req.query.code;
  if (!code) {
    res.writeHead(302, { Location: '/?auth=missing_code' });
    return res.end();
  }

  try {
    const tokenData = await exchangeCodeForToken({
      code,
      clientId: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      redirectUri: CALLBACK_URL
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
    const roleIds = member.roles || [];
    const roleNames = roleIds.map(id => roleIdToName[id]).filter(Boolean);
    // Most checks match by role name (see permissions.js), but a couple
    // match by raw ID instead — those get the ID list too.
    const perms = computePermissions(roleNames, roleIds);

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
    // Redirect to the same canonical host the cookie was set for, so a
    // browser that arrived via a different host variant still lands
    // somewhere the cookie is actually valid.
    res.writeHead(302, { Location: 'https://www.fallenpd.com/' });
    res.end();
  } catch (err) {
    console.error('Discord auth callback error:', err);
    res.writeHead(302, { Location: '/?auth=error' });
    res.end();
  }
};
