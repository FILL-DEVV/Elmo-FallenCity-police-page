const { getSession } = require('../_lib/session');
const { computePermissions } = require('../_lib/permissions');

module.exports = (req, res) => {
  const session = getSession(req);
  if (!session) {
    return res.status(200).json({ loggedIn: false });
  }
  // The misconduct permissions are derived from the role NAMES already
  // stored in the session, so they're layered on top of the perms baked
  // into the cookie at login — people who logged in before the
  // misconduct feature existed get them without logging out and in.
  const fresh = computePermissions(session.roleNames || [], session.roleIds || []);
  const perms = {
    ...(session.perms || {}),
    canSendMisconduct: fresh.canSendMisconduct,
    canViewMisconduct: fresh.canViewMisconduct,
    canApproveMisconduct: fresh.canApproveMisconduct
  };
  res.status(200).json({
    loggedIn: true,
    id: session.id,
    username: session.username,
    avatar: session.avatar,
    roleNames: session.roleNames,
    roleIds: session.roleIds,
    perms
  });
};
