// Certification EOI catalogue — add a new certification by adding a new
// entry here; the dropdown, the popup application form, the review
// embed, and auto-granting the role on Accept all read from this one
// list, so this file is the only thing that needs editing to add more.
//
// - key: short slug (letters/numbers/hyphens only, no colons) — used
//   inside component custom_ids. Keep it stable once posted: changing
//   it breaks any application form someone already has open.
// - label: shown in the dropdown and on the review embed.
// - minRankNote: shown next to the label in the dropdown, e.g.
//   "Constable +". Display only — not currently checked against the
//   applicant's actual rank.
// - questions: up to 5 (Discord's popup-form limit), each becomes one
//   text box. style "short" is a single line, "long" is a paragraph box.
// - discordRoleName: exact Discord role name granted automatically when
//   an Accept button is clicked. Must match a real server role name
//   (case-insensitive) or the grant is skipped and logged.
// - reviewChannelId: the Discord channel completed applications for
//   THIS certification get posted to for Accept/Deny — each
//   certification can route to its own channel.
const CERTIFICATIONS = {
  test: {
    label: 'Test Certification',
    minRankNote: '(placeholder — for testing the flow)',
    questions: [
      { id: 'q1', label: 'Why are you interested in this certification?', style: 'long', required: true },
      { id: 'q2', label: 'Relevant experience?', style: 'long', required: true },
      { id: 'q3', label: 'Anything else we should know?', style: 'long', required: false }
    ],
    discordRoleName: 'Test Cert',
    reviewChannelId: 'REPLACE_ME_REVIEW_CHANNEL_ID'
  }
};

// Builds the "Certification EOIs" dropdown embed message — shared by
// the one-time poster endpoint and anywhere else that needs to (re)post
// the same embed after CERTIFICATIONS changes.
function buildEoiSelectPayload() {
  const options = Object.entries(CERTIFICATIONS).map(([key, cert]) => ({
    label: cert.label,
    value: key,
    description: cert.minRankNote ? cert.minRankNote.slice(0, 100) : undefined
  }));
  return {
    embeds: [{
      title: 'Certification EOIs',
      description: Object.values(CERTIFICATIONS).map(c => `**${c.label}** ${c.minRankNote || ''}`).join('\n'),
      color: 0x3b82f6
    }],
    components: [{
      type: 1,
      components: [{
        type: 3,
        custom_id: 'eoi:select',
        placeholder: 'Make a selection',
        options
      }]
    }]
  };
}

module.exports = { CERTIFICATIONS, buildEoiSelectPayload };
