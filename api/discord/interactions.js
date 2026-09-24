const { verifyDiscordRequest } = require('../_lib/discordVerify');
const { CERTIFICATIONS } = require('../_lib/eoiConfig');
const { fetchGuildRoles, addMemberRole, sendChannelPayload, sendDirectMessage } = require('../_lib/discord');
const { TIER1_ROLES, INCREMENTAL_SERGEANT_ROLES, DOJ_ROLES } = require('../_lib/permissions');

// Discord interactions must be verified with the raw request body, so
// the platform's default JSON body-parsing is disabled here and the raw
// bytes are read manually below.
module.exports.config = { api: { bodyParser: false } };

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// Same tier used for full promote access elsewhere in the app
// (Incremental Sergeant and above, or DOJ) — reused here so Accept/Deny
// permissions stay in lockstep with the site's own permission tiers
// instead of drifting into a second, separately-maintained role list.
const APPROVER_ROLE_NAMES = new Set(
  [...TIER1_ROLES, ...INCREMENTAL_SERGEANT_ROLES, ...DOJ_ROLES].map((r) => r.toLowerCase())
);

async function isApprover(memberRoleIds, guildId, botToken) {
  if (!memberRoleIds || memberRoleIds.length === 0) return false;
  let roles;
  try {
    roles = await fetchGuildRoles(guildId, botToken);
  } catch (e) {
    console.error('interactions: could not fetch guild roles for approver check:', e);
    return false;
  }
  const idToName = new Map(roles.map((r) => [r.id, r.name.toLowerCase()]));
  return memberRoleIds.some((id) => APPROVER_ROLE_NAMES.has(idToName.get(id) || ''));
}

// Builds the popup application form (a Discord "Modal") for a given
// certification — up to 5 questions, each its own text box. A question
// can set modalLabel (short version, since Discord caps the visible
// label at 45 chars) and placeholder (up to 100 chars) to give the
// applicant more context than the label alone; label itself stays the
// full original wording, used later on the reviewers' embed.
function buildModalPayload(certKey, cert) {
  return {
    type: 9,
    data: {
      custom_id: 'eoi:modal:' + certKey,
      title: cert.label.slice(0, 45),
      components: cert.questions.slice(0, 5).map((q) => ({
        type: 1,
        components: [{
          type: 4,
          custom_id: q.id,
          label: (q.modalLabel || q.label).slice(0, 45),
          placeholder: q.placeholder ? q.placeholder.slice(0, 100) : undefined,
          style: q.style === 'short' ? 1 : 2,
          required: !!q.required,
          max_length: 1000
        }]
      }))
    }
  };
}

function extractModalAnswers(interactionData) {
  const answers = {};
  (interactionData.components || []).forEach((row) => {
    (row.components || []).forEach((c) => { answers[c.custom_id] = c.value; });
  });
  return answers;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  const rawBody = await getRawBody(req);
  const signature = req.headers['x-signature-ed25519'];
  const timestamp = req.headers['x-signature-timestamp'];
  const publicKey = process.env.DISCORD_PUBLIC_KEY;

  if (!verifyDiscordRequest(publicKey, signature, timestamp, rawBody)) {
    return res.status(401).send('Bad request signature');
  }

  let interaction;
  try {
    interaction = JSON.parse(rawBody);
  } catch (e) {
    return res.status(400).send('Bad JSON');
  }

  const guildId = process.env.DISCORD_GUILD_ID;
  const botToken = process.env.DISCORD_BOT_TOKEN;

  // PING — Discord sends this to verify the endpoint when it's first
  // saved in the Developer Portal, and periodically after that.
  if (interaction.type === 1) {
    return res.status(200).json({ type: 1 });
  }

  // Message component: either the "Make a selection" dropdown, or an
  // Accept/Deny button on a posted application.
  if (interaction.type === 3) {
    const customId = interaction.data.custom_id || '';

    if (customId === 'eoi:select') {
      const certKey = (interaction.data.values || [])[0];
      const cert = CERTIFICATIONS[certKey];
      if (!cert) {
        return res.status(200).json({
          type: 4,
          data: { content: 'That certification is no longer available.', flags: 64 }
        });
      }
      return res.status(200).json(buildModalPayload(certKey, cert));
    }

    if (customId.startsWith('eoi:accept:') || customId.startsWith('eoi:deny:')) {
      const parts = customId.split(':');
      const action = parts[1];
      const certKey = parts[2];
      const applicantId = parts[3];
      const cert = CERTIFICATIONS[certKey];
      const clickerRoles = (interaction.member && interaction.member.roles) || [];
      const clickerName = (interaction.member && interaction.member.user && interaction.member.user.username) || 'someone';

      const allowed = await isApprover(clickerRoles, guildId, botToken);
      if (!allowed) {
        return res.status(200).json({
          type: 4,
          data: { content: 'You do not have permission to review this application.', flags: 64 }
        });
      }

      const original = interaction.message || {};
      const baseEmbed = (original.embeds && original.embeds[0]) || {};

      if (action === 'accept' && cert && (cert.discordRoleId || cert.discordRoleName)) {
        try {
          if (cert.discordRoleId) {
            await addMemberRole(guildId, applicantId, cert.discordRoleId, botToken);
          } else {
            const roles = await fetchGuildRoles(guildId, botToken);
            const role = roles.find((r) => r.name.toLowerCase() === cert.discordRoleName.toLowerCase());
            if (role) await addMemberRole(guildId, applicantId, role.id, botToken);
            else console.error('interactions: no server role named "' + cert.discordRoleName + '"');
          }
        } catch (e) {
          console.error('interactions: role grant failed:', e);
        }
      }

      // Notify the applicant by DM on acceptance. A one-off notification,
      // not a conversation — see sendDirectMessage in _lib/discord.js.
      // Never blocks the review outcome: a closed-DMs applicant or a
      // blocked bot just means the notification silently fails.
      if (action === 'accept' && applicantId) {
        try {
          await sendDirectMessage(applicantId, botToken, {
            embeds: [{
              title: (cert ? cert.label : 'Certification') + ' — Application Accepted',
              description: 'Your application for **' + (cert ? cert.label : 'this certification') + '** has been accepted.',
              color: 0x2f8f5b
            }]
          });
        } catch (e) {
          console.error('interactions: could not DM applicant about acceptance:', e);
        }
      }

      const statusLine = action === 'accept'
        ? `✅ **Accepted** by ${clickerName}`
        : `❌ **Denied** by ${clickerName}`;
      const updatedEmbed = {
        ...baseEmbed,
        color: action === 'accept' ? 0x2f8f5b : 0xe06a5f,
        fields: [...(baseEmbed.fields || []), { name: '\u200b', value: statusLine }]
      };

      return res.status(200).json({
        type: 7,
        data: { embeds: [updatedEmbed], components: [] }
      });
    }

    return res.status(200).json({ type: 6 });
  }

  // Modal submit — the applicant finished the popup form.
  if (interaction.type === 5) {
    const customId = interaction.data.custom_id || '';
    if (customId.startsWith('eoi:modal:')) {
      const certKey = customId.slice('eoi:modal:'.length);
      const cert = CERTIFICATIONS[certKey];
      const answers = extractModalAnswers(interaction.data);
      const applicant = interaction.member && interaction.member.user;
      const applicantId = applicant ? applicant.id : null;
      const applicantName = applicant ? (applicant.global_name || applicant.username) : 'Unknown';

      if (cert) {
        const fields = cert.questions.map((q) => ({
          name: q.label.slice(0, 256),
          value: (answers[q.id] || '—').slice(0, 1024)
        }));
        if (!cert.reviewChannelId || cert.reviewChannelId === 'REPLACE_ME_REVIEW_CHANNEL_ID') {
          console.error('interactions: "' + certKey + '" has no reviewChannelId set in eoiConfig.js — application not posted');
        } else {
          try {
            await sendChannelPayload(cert.reviewChannelId, botToken, {
              embeds: [{
                title: cert.label + ' — Application',
                description: `Applicant: <@${applicantId}> (${applicantName})`,
                color: 0x3b82f6,
                fields
              }],
              components: [{
                type: 1,
                components: [
                  { type: 2, style: 3, label: 'Accept', custom_id: `eoi:accept:${certKey}:${applicantId}` },
                  { type: 2, style: 4, label: 'Deny', custom_id: `eoi:deny:${certKey}:${applicantId}` }
                ]
              }]
            });
          } catch (e) {
            console.error('interactions: could not post application to review channel:', e);
          }
        }
      }

      return res.status(200).json({
        type: 4,
        data: { content: 'Your application has been submitted for review.', flags: 64 }
      });
    }
    return res.status(200).json({ type: 4, data: { content: 'Submitted.', flags: 64 } });
  }

  return res.status(200).json({ type: 6 });
};
