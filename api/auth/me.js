const { getSession } = require('../_lib/session');

module.exports = (req, res) => {
  const session = getSession(req);
  if (!session) {
    return res.status(200).json({ loggedIn: false });
  }
  res.status(200).json({
    loggedIn: true,
    id: session.id,
    username: session.username,
    avatar: session.avatar,
    roleNames: session.roleNames,
    perms: session.perms
  });
};
