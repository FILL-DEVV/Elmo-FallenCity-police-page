// Certification EOI catalogue — add a new certification by adding a new
// entry here; the application form on the website, the staff review
// page, and auto-granting the role on Acknowledge all read from this
// one list, so this file is the only thing that needs editing to add
// more.
//
// Applications are submitted through the website now (not a Discord
// popup form), so the 45-character label / 100-character placeholder
// limits that used to matter no longer apply — modalLabel and
// placeholder below are vestigial (harmless if left, safe to drop for
// new entries).
//
// - key: short slug (letters/numbers/hyphens only, no colons) — used
//   in the application's stored cert_key and inside Discord component
//   custom_ids. Keep it stable once used: changing it orphans any
//   already-submitted applications for this cert.
// - label: shown on the website and in the Discord acknowledgement
//   thread.
// - minRankNote: shown next to the label on the website, e.g.
//   "Constable +". Display only — not currently checked against the
//   applicant's actual rank.
// - questions: each becomes one text box on the website's application
//   form. style "short" is a single line, "long" is a paragraph box.
// - discordRoleName: exact Discord role name granted automatically when
//   the applicant clicks Acknowledge (after staff Accepts on the
//   website), matched case-insensitively against the server's roles.
//   Ignored if discordRoleId is set.
// - discordRoleId: the Discord role's ID, granted directly with no name
//   lookup — preferred over discordRoleName since it can't be broken by
//   a role rename later. If both are set, discordRoleId wins.
const CERTIFICATIONS = {
  test: {
    label: 'Test Certification',
    minRankNote: '(placeholder — for testing the flow)',
    questions: [
      { id: 'q1', label: 'Why are you interested in this certification?', style: 'long', required: true },
      { id: 'q2', label: 'Relevant experience?', style: 'long', required: true },
      { id: 'q3', label: 'Anything else we should know?', style: 'long', required: false }
    ],
    discordRoleName: 'Test Cert'
  },
  polair: {
    label: 'PolAir',
    minRankNote: 'Senior Constable +',
    questions: [
      {
        id: 'q1',
        label: 'What do you believe are the primary roles of PolAir?',
        style: 'long',
        required: true
      },
      {
        id: 'q2',
        label: 'How can aerial support improve police operations? Provide an example of when PolAir should be deployed.',
        style: 'long',
        required: true
      },
      {
        id: 'q3',
        label: 'Explain how you would coordinate and communicate with ground units, including Highway Patrol and TOU, during a major incident or pursuit?',
        style: 'long',
        required: true
      },
      {
        id: 'q4',
        label: 'How would you prioritise requests if multiple units requiring PolAir assistance at the same time?',
        style: 'long',
        required: true
      },
      {
        id: 'q5',
        label: 'What experience do you have with aviation, aerial operations, or similar roles (if any)?',
        style: 'long',
        required: true
      }
    ],
    discordRoleId: '1470382539217571921'
  },
  sfc: {
    label: 'SFC',
    minRankNote: 'Senior Constable +',
    questions: [
      {
        id: 'q1',
        label: 'Describe a situation where you should NOT draw or use your 2 handed firearm.',
        style: 'long',
        required: true
      },
      {
        id: 'q2',
        label: 'Describe a situation where you SHOULD draw or use your 2 handed firearm.',
        style: 'long',
        required: true
      },
      {
        id: 'q3',
        label: 'Why should the command team trust you with Specialised Firearms Certification, and how will you maintain your proficiency after being certified?',
        style: 'long',
        required: true
      },
      {
        id: 'q4',
        label: 'What would you do if a supervisor gave you an instruction you believed was unsafe or against policy?',
        style: 'long',
        required: true
      },
      {
        id: 'q5',
        label: 'Do you understand that if you breach the rules and guidelines of the SFC certification, It will be taken off you?',
        style: 'long',
        required: true
      }
    ],
    discordRoleId: '1483691612994408518'
  }
};

// The website's application form and "my applications" / review views
// need the cert list and questions, but never the Discord role
// name/ID — those stay server-side only. This is what the catalogue
// endpoint sends to the browser.
function buildPublicCatalogue() {
  return Object.entries(CERTIFICATIONS).map(([key, cert]) => ({
    key,
    label: cert.label,
    minRankNote: cert.minRankNote || '',
    questions: cert.questions.map((q) => ({
      id: q.id,
      label: q.label,
      style: q.style || 'long',
      required: !!q.required
    }))
  }));
}

module.exports = { CERTIFICATIONS, buildPublicCatalogue };
