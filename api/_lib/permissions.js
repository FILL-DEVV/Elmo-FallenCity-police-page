// Role names are matched case-insensitively against whatever roles the
// Discord bot reports for the logged-in user. Edit these lists if role
// names on the server ever change.
const TIER1_ROLES = [
  'commissioner', 'deputy commissioner', 'assistant commissioner',
  'chief superintendent', 'superintendent', 'chief inspector',
  'inspector', 'senior sergeant'
];
const TIER2_ROLES = ['fto'];
const TIER3_ROLES = ['senior fto', 'fto supervisor', 'fto director', 'head of academy'];
// High Command Team / Commissioned Office — unlocks the Senior Command tab.
const HIGH_COMMAND_ROLES = ['high command team', 'commissioned office'];
// Department of Justice — full access to every tab and every action,
// overriding all other tiers. (Formerly named "AFP" on the server and
// in this list; renamed here to match the server-side role rename.)
const DOJ_ROLES = ['department of justice'];
// Superintendent and above — a narrower slice of TIER1_ROLES (excludes
// Chief Inspector, Inspector, Senior Sergeant) — can edit an existing
// officer's name and Discord ID directly on the roster.
const EDIT_INFO_ROLES = [
  'commissioner', 'deputy commissioner', 'assistant commissioner',
  'chief superintendent', 'superintendent'
];
// Incremental Sergeant — one tier below Senior Sergeant (TIER1). Gets
// the Promote, Terminate, and Add Officer buttons, but not the rest of
// TIER1's access (roster import, clear all, terminated records).
const INCREMENTAL_SERGEANT_ROLES = ['incremental sergeant'];
// EOIs tab visibility — matched by role ID rather than name (unlike
// every other check on this page) since this role's exact name wasn't
// given, only its ID; ID matching is also immune to the role later
// being renamed. DOJ still sees every tab per the invariant above.
const EOI_VIEWER_ROLE_ID = '1401964701688270948';

// Per-division EOI *reviewer* gating — these are the exact same
// "division-wide" blanket role IDs already used in roleSync.js's
// DIVISION_WIDE_ROLE_IDS (granted the moment someone's posted to that
// division, stripped the moment they transfer out). Holding the
// matching role unlocks that division's tab on the website's Review
// sub-tab. General duties has no such role of its own — its division
// tag is NEVER stripped (see NEVER_REMOVE_ROLES in roleSync.js), so
// gating on it would unlock the tab for essentially everyone; GD's
// review access is left to the base reviewer tier instead.
const TOU_MEMBER_ROLE_IDS = ['1525135421271441458'];
const HIGHWAY_MEMBER_ROLE_IDS = ['1525135429643276349'];
const CRIME_MEMBER_ROLE_IDS = ['1525135433770729625'];

function computePermissions(roleNames, roleIds) {
  const names = (roleNames || []).map(n => String(n).toLowerCase());
  const ids = roleIds || [];
  const has = (list) => list.some(r => names.includes(r));
  const hasIds = (list) => list.some(id => ids.includes(id));

  const tier1 = has(TIER1_ROLES);       // Senior Sergeant and above
  const tier2 = has(TIER2_ROLES);       // FTO
  const tier3 = has(TIER3_ROLES);       // Senior FTO and above
  const highCommand = has(HIGH_COMMAND_ROLES); // High Command Team / Commissioned Office
  const isDOJ = has(DOJ_ROLES);         // Department of Justice — sees/does everything
  const editInfo = has(EDIT_INFO_ROLES); // Superintendent and above
  const incrementalSgt = has(INCREMENTAL_SERGEANT_ROLES); // Incremental Sergeant
  const inTou = hasIds(TOU_MEMBER_ROLE_IDS);
  const inHighway = hasIds(HIGHWAY_MEMBER_ROLE_IDS);
  const inCrime = hasIds(CRIME_MEMBER_ROLE_IDS);

  const canPromoteAny = tier1 || incrementalSgt || isDOJ;

  return {
    tier1, tier2, tier3, highCommand, isDOJ,
    // Add, Promote, and Terminate are also open to Incremental Sergeant,
    // one tier below the rest of TIER1's access.
    canAdd: tier1 || tier2 || incrementalSgt || isDOJ,
    canTerminate: tier1 || incrementalSgt || isDOJ,
    canPromoteAny,
    // Tier 3 (Senior FTO+) can additionally promote officers whose
    // CURRENT rank is student — checked per-request against the
    // officer's actual current rank, not assumed here.
    canPromoteStudent: tier1 || tier3 || isDOJ,
    // FTO (tier2) can edit the promotion checklist, even though they
    // can't perform the promotion itself.
    canEditChecklist: tier1 || tier2 || tier3 || isDOJ,
    canSetFto: tier1 || tier3 || isDOJ,
    canClearAll: tier1 || isDOJ,
    canImportRoster: tier1 || isDOJ,
    canAddTerminatedRecord: tier1 || isDOJ,
    // Superintendent and above (or DOJ) can edit an existing officer's
    // name and Discord ID directly on the roster grid.
    canEditOfficerInfo: editInfo || isDOJ,
    // Tab visibility: Academy is FTO-affiliated (FTO or Senior FTO+);
    // Senior Command is High Command Team / Commissioned Office. DOJ sees both.
    canViewAcademy: tier2 || tier3 || isDOJ,
    canViewSeniorCommand: highCommand || isDOJ,
    // High Command division (Police liaison through Chief Inspector) —
    // same audience as Senior Command, kept as its own field since the
    // two features may diverge later.
    canViewHighCommand: highCommand || isDOJ,
    // EOIs tab — restricted to holders of EOI_VIEWER_ROLE_ID, plus DOJ.
    canViewEoi: ids.includes(EOI_VIEWER_ROLE_ID) || isDOJ,
    // Per-division EOI Review tabs (see comment on the role-ID lists
    // above). High Command Team / Commissioned Office and DOJ can
    // review every division's tab; everyone else needs both the base
    // reviewer tier AND that division's own membership role (General
    // duties needs only the base tier).
    canReviewGeneral: canPromoteAny || isDOJ,
    canReviewHighway: (canPromoteAny && inHighway) || highCommand || isDOJ,
    canReviewTou: (canPromoteAny && inTou) || highCommand || isDOJ,
    canReviewCrime: (canPromoteAny && inCrime) || highCommand || isDOJ,
    canReviewSrcmd: highCommand || isDOJ
  };
}

// Shared by the frontend's tab-visibility gating and the review API
// endpoint's server-side check — given a full perms object and an
// application's cert division ('general'/'highway'/'tou'/'crime'/'srcmd'),
// says whether this session may review applications in that division.
function canReviewApplicationDivision(perms, division) {
  const p = perms || {};
  switch (division) {
    case 'highway': return !!p.canReviewHighway;
    case 'tou': return !!p.canReviewTou;
    case 'crime': return !!p.canReviewCrime;
    case 'srcmd': return !!p.canReviewSrcmd;
    default: return !!p.canReviewGeneral;
  }
}

module.exports = {
  computePermissions, canReviewApplicationDivision,
  TIER1_ROLES, TIER2_ROLES, TIER3_ROLES, HIGH_COMMAND_ROLES, DOJ_ROLES, EDIT_INFO_ROLES, INCREMENTAL_SERGEANT_ROLES,
  EOI_VIEWER_ROLE_ID, TOU_MEMBER_ROLE_IDS, HIGHWAY_MEMBER_ROLE_IDS, CRIME_MEMBER_ROLE_IDS
};
