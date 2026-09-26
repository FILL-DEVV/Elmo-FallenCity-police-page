// Seniority ordering used to enforce an EOI certification's minimum
// rank across every division. Unlike index.html's flat RANK_ORDER_LIST
// (used there only to sort rows within one division's own roster, where
// cross-division ties never come up), this groups each division's
// equivalent working rank into the SAME tier — GD's "Senior Constable",
// CIU's "Detective", and TOU's "Operator" all sit at tier index 13,
// since they're each that division's ordinary rank past trial/
// probation, not meaningfully senior/junior to one another. A minimum
// set to any one of a tied group's names is met by every name in that
// group.
//
// Keep this in sync with index.html's own rank ladder if a rank is
// renamed or a division's ladder restructured — the grouping here may
// need to change too if a division's ladder gains or loses a rung.
const RANK_TIERS = [
  ["Police liaison"],
  ["Commissioner"],
  ["Deputy Commissioner"],
  ["Assistant Commissioner"],
  ["Chief Superintendent"],
  ["Superintendent"],
  ["Chief Inspector"],
  ["Inspector"],
  ["Senior Sergeant"],
  ["Incremental Sergeant"],
  ["GD supervisor", "Sergeant", "Detective Supervisor", "TOU Supervisor"],
  ["Leading Senior Constable", "Lead Detective", "Lead Operator"],
  ["Incremental Senior Constable", "Senior Detective", "Senior Operator"],
  ["Senior Constable", "Detective", "Operator"],
  ["Constable", "Trial Detective", "TOU trial"],
  ["Probationary Constable"],
  ["student"],
  ["Department Of Justice"]
];
// Flat list of every rank name, in the same tier order — kept for
// anything that just wants "every recognized rank name" rather than the
// grouping (e.g. validating a string is a real rank at all).
const RANK_ORDER_LIST = RANK_TIERS.flat();

// Matched case-insensitively with surrounding whitespace trimmed — a
// roster entry that came in through Import roster (raw CSV, never
// passed through the app's own rank dropdown) or an old manual edit can
// easily carry different casing or a stray space, and an exact-string
// comparison would silently fail closed on that, blocking a genuinely
// qualified applicant with the exact same "you must be at least X"
// message a real rank shortfall produces — indistinguishable to the
// person applying.
function normalizeRank(r) {
  return String(r || '').trim().toLowerCase();
}
const RANK_ORDER = {};
RANK_TIERS.forEach((tier, tierIndex) => {
  tier.forEach((rank) => { RANK_ORDER[normalizeRank(rank)] = tierIndex; });
});

// True if currentRank is at least as senior as minRank (lower/equal
// tier index). No minRank set on the cert always passes. An
// unrecognized rank string (either side, after normalizing) never
// silently passes — it fails closed rather than letting a typo'd or
// renamed rank bypass the check entirely.
function meetsMinRank(currentRank, minRank) {
  if (!minRank) return true;
  const cur = RANK_ORDER[normalizeRank(currentRank)];
  const min = RANK_ORDER[normalizeRank(minRank)];
  if (cur === undefined || min === undefined) return false;
  return cur <= min;
}

module.exports = { RANK_TIERS, RANK_ORDER_LIST, RANK_ORDER, meetsMinRank, normalizeRank };
