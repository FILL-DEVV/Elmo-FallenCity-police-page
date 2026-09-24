const crypto = require('crypto');

// Discord signs every interaction request with Ed25519. This verifies
// that signature using Node's built-in crypto (no external dependency
// needed) by wrapping the raw 32-byte public key in the fixed ASN.1/DER
// header Ed25519 keys use — Node's crypto API only accepts DER/PEM keys,
// not raw bytes, so this prefix is what makes that conversion possible.
const ED25519_DER_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function verifyDiscordRequest(publicKeyHex, signatureHex, timestamp, rawBody) {
  if (!publicKeyHex || !signatureHex || !timestamp) return false;
  try {
    const publicKeyDer = Buffer.concat([ED25519_DER_PREFIX, Buffer.from(publicKeyHex, 'hex')]);
    const publicKey = crypto.createPublicKey({ key: publicKeyDer, format: 'der', type: 'spki' });
    const message = Buffer.from(timestamp + rawBody, 'utf8');
    const signature = Buffer.from(signatureHex, 'hex');
    return crypto.verify(null, message, publicKey, signature);
  } catch (e) {
    console.error('Signature verification error:', e);
    return false;
  }
}

module.exports = { verifyDiscordRequest };
