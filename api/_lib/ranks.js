// Mirrors index.html's RANK_ORDER_LIST exactly — the single canonical
// seniority ordering the website already uses across every division for
// sorting and filtering, reused here to enforce an EOI certification's
// minimum rank. Keep this in sync if that list in index.html ever
// changes (rank renamed, a division's ladder restructured, etc).
//
// Lower index = more senior. Ranks from different divisions that sit at
// the same tier (e.g. "Senior Constable" / "Detective" / "Operator")
// are NOT given identical indices — they're ordered exactly as the
// website's own reference Ranks sheet lists them, so a minimum set to
// one division's rank name is very slightly stricter against another
// division's equivalent-tier rank than an exact tier-for-tier mapping
// would be. This matches the app's one existing source of truth rather
// than inventing a second, separate equivalence table.
const RANK_ORDER_LIST = [
  "Police liaison",
  "Commissioner", "Deputy Commissioner", "Assistant Commissioner",
  "Chief Superintendent", "Superintendent", "Chief Inspector",
  "Inspector", "Senior Sergeant", "Incremental Sergeant",
  "GD supervisor", "Sergeant", "Detective Supervisor", "TOU Supervisor",
  "Leading Senior Constable", "Lead Detective", "Lead Operator",
  "Incremental Senior Constable", "Senior Detective", "Senior Operator",
  "Senior Constable", "Detective", "Operator",
  "Constable", "Trial Detective", "TOU trial",
  "Probationary Constable", "student", "Department Of Justice"
];
const RANK_ORDER = Object.fromEntries(RANK_ORDER_LIST.map((r, i) => [r, i]));

// True if currentRank is at least as senior as minRank. No minRank set
// on the cert always passes. An unrecognized rank string (either side)
// never silently passes — it fails closed rather than letting a typo'd
// or renamed rank bypass the check.
function meetsMinRank(currentRank, minRank) {
  if (!minRank) return true;
  if (RANK_ORDER[currentRank] === undefined || RANK_ORDER[minRank] === undefined) return false;
  return RANK_ORDER[currentRank] <= RANK_ORDER[minRank];
}

module.exports = { RANK_ORDER_LIST, RANK_ORDER, meetsMinRank };
