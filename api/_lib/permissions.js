// Role names are matched case-insensitively against whatever roles the
// Discord bot reports for the logged-in user. Edit these lists if role
// names on the server ever change.
const TIER1_ROLES = [
  'commissioner', 'deputy commissioner', 'assistant commissioner',
  'chief superintendent', 'superintendent', 'chief inspector',
  'inspector', 'senior sergeant'
];
const TIER2_ROLES = ['fto'];
const TIER3_ROLES = ['senior fto', 'lead fto', 'fto director', 'head of academy'];

function computePermissions(roleNames) {
  const names = (roleNames || []).map(n => String(n).toLowerCase());
  const has = (list) => list.some(r => names.includes(r));

  const tier1 = has(TIER1_ROLES); // Senior Sergeant and above
  const tier2 = has(TIER2_ROLES); // FTO
  const tier3 = has(TIER3_ROLES); // Senior FTO and above

  return {
    tier1, tier2, tier3,
    // Full access: add, promote anyone, terminate.
    canAdd: tier1 || tier2,
    canTerminate: tier1,
    canPromoteAny: tier1,
    // Tier 3 (Senior FTO+) can additionally promote officers whose
    // CURRENT rank is Student Police Officer — checked per-request
    // against the officer's actual current rank, not assumed here.
    canPromoteStudent: tier1 || tier3,
    canSetFto: tier1 || tier3,
    canClearAll: tier1,
    canImportRoster: tier1,
    canAddTerminatedRecord: tier1
  };
}

module.exports = { computePermissions, TIER1_ROLES, TIER2_ROLES, TIER3_ROLES };
