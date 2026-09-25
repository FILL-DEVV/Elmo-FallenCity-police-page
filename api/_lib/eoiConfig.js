// Certification EOI catalogue — add a new certification by adding a new
// entry here; the application form on the website, the staff review
// page, and auto-granting the role on Acknowledge all read from this
// one list, so this file is the only thing that needs editing to add
// more.
//
// Applications are submitted through the website now (not a Discord
// popup form), so the 45-character label / 100-character placeholder
// limits that used to matter no longer apply.
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
// - division: which Review-tab this cert's pending applications sort
//   under on the website — one of 'general' (GD), 'highway', 'tou',
//   'crime' (CIU), or 'srcmd' (Senior command). Defaults to 'general'
//   if omitted. Display/sorting only — never checked against the
//   applicant's actual division.
// - questions: each becomes one text box on the website's application
//   form. style "short" is a single line, "long" is a paragraph box.
// - discordRoleName: exact Discord role name granted automatically when
//   the applicant clicks Acknowledge (after staff Accepts on the
//   website), matched case-insensitively against the server's roles.
//   Ignored if discordRoleId is set.
// - discordRoleId: the Discord role's ID, granted directly with no name
//   lookup — preferred over discordRoleName since it can't be broken by
//   a role rename later. If both are set, discordRoleId wins.
// - notifyChannelId / notifyRoleId: if both are set, submitting an
//   application for this cert pings notifyRoleId in notifyChannelId
//   with a deep link straight to that application on the website's
//   Review tab. Optional — omit both to submit silently (staff just see
//   it appear in the Review tab / realtime).
const CERTIFICATIONS = {
  test: {
    label: 'Test Certification',
    minRankNote: '(placeholder — for testing the flow)',
    division: 'general',
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
    // Filed under Senior command — PolAir applications are reviewed
    // there rather than under any single division.
    division: 'srcmd',
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
    // Filed under TOU — its notifyRoleId below is the same role ID
    // used as TOU's senior-tier leadership role in roleSync.js.
    division: 'tou',
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
    discordRoleId: '1483691612994408518',
    notifyChannelId: '1534468202384330825',
    notifyRoleId: '1467025802767110329'
  }
};

// Parent channel the private EOI acknowledgement thread gets created
// under when staff Accept an application on the website — same channel
// the old Discord-side EOI dropdown used to live in.
const EOI_CHANNEL_ID = '1534466794411004086';

// The website's application form and "my applications" / review views
// need the cert list and questions, but never the Discord role
// name/ID — those stay server-side only. This is what the catalogue
// endpoint sends to the browser.
function buildPublicCatalogue() {
  return Object.entries(CERTIFICATIONS).map(([key, cert]) => ({
    key,
    label: cert.label,
    minRankNote: cert.minRankNote || '',
    division: cert.division || 'general',
    questions: cert.questions.map((q) => ({
      id: q.id,
      label: q.label,
      style: q.style || 'long',
      required: !!q.required
    }))
  }));
}

module.exports = { CERTIFICATIONS, buildPublicCatalogue, EOI_CHANNEL_ID };
