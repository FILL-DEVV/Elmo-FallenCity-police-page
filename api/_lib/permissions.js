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
// High Command Team / Commissioners Office — unlocks the Senior Command tab.
const HIGH_COMMAND_ROLES = ['high command team', 'commissioners office'];
// Department of Justice — full access to every tab and every action,
// overriding all other tiers.
const DOJ_ROLES = ['department of justice'];
// Superintendent and above — a narrower slice of TIER1_ROLES (excludes
// Chief Inspector, Inspector, Senior Sergeant) — can edit an existing
// officer's name and Discord ID directly on the roster.
const EDIT_INFO_ROLES = [
  'commissioner', 'deputy commissioner', 'assistant commissioner',
  'chief superintendent', 'superintendent'
];

function computePermissions(roleNames) {
  const names = (roleNames || []).map(n => String(n).toLowerCase());
  const has = (list) => list.some(r => names.includes(r));

  const tier1 = has(TIER1_ROLES);       // Senior Sergeant and above
  const tier2 = has(TIER2_ROLES);       // FTO
  const tier3 = has(TIER3_ROLES);       // Senior FTO and above
  const highCommand = has(HIGH_COMMAND_ROLES); // High Command Team / Commissioners Office
  const isDOJ = has(DOJ_ROLES);         // Department of Justice — sees/does everything
  const editInfo = has(EDIT_INFO_ROLES); // Superintendent and above

  return {
    tier1, tier2, tier3, highCommand, isDOJ,
    // Full access: add, promote anyone, terminate.
    canAdd: tier1 || tier2 || isDOJ,
    canTerminate: tier1 || isDOJ,
    canPromoteAny: tier1 || isDOJ,
    // Tier 3 (Senior FTO+) can additionally promote officers whose
    // CURRENT rank is Student Police Officer — checked per-request
    // against the officer's actual current rank, not assumed here.
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
    // Senior Command is High Command Team / Commissioners Office. DOJ sees both.
    canViewAcademy: tier2 || tier3 || isDOJ,
    canViewSeniorCommand: highCommand || isDOJ
  };
}

module.exports = { computePermissions, TIER1_ROLES, TIER2_ROLES, TIER3_ROLES, HIGH_COMMAND_ROLES, DOJ_ROLES, EDIT_INFO_ROLES };
