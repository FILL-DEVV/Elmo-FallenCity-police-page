const { verifyDiscordRequest } = require('../_lib/discordVerify');
const { CERTIFICATIONS } = require('../_lib/eoiConfig');
const { sbFetch } = require('../_lib/supabase');
const { addMemberRole, fetchGuildRoles, deleteThread } = require('../_lib/discord');

// Now handles ONLY the EOI Acknowledge button — applying and staff
// review both moved to the website (see api/eoi/actions.js). Discord
// still needs an Interactions Endpoint for the one remaining bit of UI
// that lives in Discord: the applicant clicking Acknowledge in their
// private thread.
module.exports.config = { api: { bodyParser: false } };

// See the previous, larger version of this file for why raw bytes are
// buffered as a Buffer rather than decoded chunk-by-chunk: doing the
// latter can corrupt a multi-byte UTF-8 character that lands on a chunk
// boundary and breaks signature verification intermittently.
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => { chunks.push(chunk); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function grantCertRole(cert, userId, guildId, botToken) {
  if (!cert || (!cert.discordRoleId && !cert.discordRoleName)) return;
  if (cert.discordRoleId) {
    await addMemberRole(guildId, userId, cert.discordRoleId, botToken);
    return;
  }
  const roles = await fetchGuildRoles(guildId, botToken);
  const role = roles.find((r) => r.name.toLowerCase() === cert.discordRoleName.toLowerCase());
  if (role) await addMemberRole(guildId, userId, role.id, botToken);
  else console.error('interactions: no server role named "' + cert.discordRoleName + '"');
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
    interaction = JSON.parse(rawBody.toString('utf8'));
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

  if (interaction.type === 3) {
    const customId = interaction.data.custom_id || '';

    if (customId.startsWith('eoi:ack:')) {
      const applicationId = customId.slice('eoi:ack:'.length);
      console.log('interactions: ack received for application ' + applicationId);

      // Ack immediately (deferred update), before the Supabase lookup
      // below — that lookup is a network round trip, and running it
      // before responding would risk the same "eats into Discord's
      // 3-second window" problem this app hit before with the
      // Accept/Deny buttons.
      res.status(200).json({ type: 6 });
      console.log('interactions: deferred response sent for ' + applicationId);

      let application;
      try {
        const rows = await sbFetch(`/eoi_applications?id=eq.${encodeURIComponent(applicationId)}&select=*`, {
          extraHeaders: { Prefer: 'return=representation' }
        });
        application = rows && rows[0];
        console.log('interactions: lookup for ' + applicationId + ' returned ' + (application ? 'a row (cert_key=' + application.cert_key + ')' : 'no row'));
      } catch (e) {
        console.error('interactions: could not look up application ' + applicationId + ':', e);
        return;
      }
      if (!application) {
        console.error('interactions: acknowledge click for unknown application ' + applicationId);
        return;
      }

      const clickerId = interaction.member && interaction.member.user && interaction.member.user.id;
      if (clickerId !== application.applicant_id) {
        // Already deferred, so this has to be a followup rather than
        // the initial response — but since the thread stays open for
        // anyone else who can see it, and the real applicant should
        // still be able to acknowledge normally, just log this rather
        // than doing anything to the thread.
        console.error('interactions: acknowledge clicked by ' + clickerId + ', not the applicant ' + application.applicant_id + ' — ignored.');
        return;
      }

      const cert = CERTIFICATIONS[application.cert_key];
      console.log('interactions: granting role for cert_key=' + application.cert_key + ' — config found: ' + !!cert + ', discordRoleId=' + (cert && cert.discordRoleId) + ', discordRoleName=' + (cert && cert.discordRoleName));
      try {
        await grantCertRole(cert, application.applicant_id, guildId, botToken);
        console.log('interactions: role grant call completed without throwing for ' + applicationId);
      } catch (e) {
        console.error('interactions: role grant on acknowledge failed:', e);
      }

      try {
        await sbFetch(`/eoi_applications?id=eq.${encodeURIComponent(applicationId)}`, {
          method: 'PATCH',
          body: { acknowledged_at: Date.now() },
          extraHeaders: { Prefer: 'return=minimal' }
        });
        console.log('interactions: acknowledged_at recorded for ' + applicationId);
      } catch (e) {
        console.error('interactions: could not record acknowledged_at:', e);
      }

      // The thread disappearing IS the confirmation — no message is
      // edited or sent first, since there'd be nothing left to see it.
      try {
        await deleteThread(interaction.channel_id, botToken);
        console.log('interactions: thread deleted for ' + applicationId);
      } catch (e) {
        console.error('interactions: could not delete acknowledgement thread:', e);
      }
      console.log('interactions: ack flow fully completed for ' + applicationId);
      return;
    }

    return res.status(200).json({ type: 6 });
  }

  return res.status(200).json({ type: 6 });
};
