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
// - label (on a question): the FULL question text — shown as the field
//   name on the review embed (reviewers see the whole thing, no limit
//   that matters here). Discord's popup form only allows a 45-character
//   visible label though, so when a question's wording is longer than
//   that, also set modalLabel (a short version) and optionally
//   placeholder (up to 100 chars) so the applicant still gets useful
//   context in the form itself even though the full wording only shows
//   up later, in the reviewers' embed.
// - discordRoleName: exact Discord role name granted automatically when
//   an Accept button is clicked, matched case-insensitively against the
//   server's roles. Ignored if discordRoleId is set.
// - discordRoleId: the Discord role's ID, granted directly with no name
//   lookup — preferred over discordRoleName since it can't be broken by
//   a role rename later. If both are set, discordRoleId wins.
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
  },
  polair: {
    label: 'PolAir',
    minRankNote: 'Senior Constable +',
    questions: [
      {
        id: 'q1',
        label: 'What do you believe are the primary roles of PolAir?',
        modalLabel: 'Primary roles of PolAir?',
        style: 'long',
        required: true
      },
      {
        id: 'q2',
        label: 'How can aerial support improve police operations? Provide an example of when PolAir should be deployed.',
        modalLabel: 'Aerial support & deployment.',
        style: 'long',
        required: true
      },
      {
        id: 'q3',
        label: 'Explain how you would coordinate and communicate with ground units, including Highway Patrol and TOU, during a major incident or pursuit?',
        modalLabel: 'Communication/radio coms',
        style: 'long',
        required: true
      },
      {
        id: 'q4',
        label: 'How would you prioritise requests if multiple units requiring PolAir assistance at the same time?',
        modalLabel: 'Request Prioritisation.',
        style: 'long',
        required: true
      },
      {
        id: 'q5',
        label: 'What experience do you have with aviation, aerial operations, or similar roles (if any)?',
        modalLabel: 'Past aviation experience',
        style: 'long',
        required: true
      }
    ],
    discordRoleId: '1470382539217571921',
    reviewChannelId: '1534470322655596694'
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
