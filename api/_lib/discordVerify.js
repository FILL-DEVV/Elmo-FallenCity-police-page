const crypto = require('crypto');

// Discord signs every interaction request with Ed25519. This verifies
// that signature using Node's built-in crypto (no external dependency
// needed) by wrapping the raw 32-byte public key in the fixed ASN.1/DER
// header Ed25519 keys use — Node's crypto API only accepts DER/PEM keys,
// not raw bytes, so this prefix is what makes that conversion possible.
const ED25519_DER_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function verifyDiscordRequest(publicKeyHex, signatureHex, timestamp, rawBody) {
  if (!publicKeyHex || !signatureHex || !timestamp) {
    console.error(
      'Signature verification: missing input — publicKey set: ' + !!publicKeyHex +
      ', signature header present: ' + !!signatureHex +
      ', timestamp header present: ' + !!timestamp +
      '. If publicKey is false, DISCORD_PUBLIC_KEY is not set for this deployment/environment.'
    );
    return false;
  }
  try {
    // Trimmed defensively: a trailing newline or space from copy-pasting
    // the public key into an env var silently truncates the hex parse
    // below and makes every signature check fail with no obvious cause.
    publicKeyHex = String(publicKeyHex).trim();
    signatureHex = String(signatureHex).trim();
    timestamp = String(timestamp).trim();
    const publicKeyBytes = Buffer.from(publicKeyHex, 'hex');
    if (publicKeyBytes.length !== 32) {
      console.error('Signature verification: DISCORD_PUBLIC_KEY decoded to ' + publicKeyBytes.length + ' bytes, expected 32 — check the env var value for stray characters or truncation.');
      return false;
    }
    const publicKeyDer = Buffer.concat([ED25519_DER_PREFIX, publicKeyBytes]);
    const publicKey = crypto.createPublicKey({ key: publicKeyDer, format: 'der', type: 'spki' });
    const message = Buffer.from(timestamp + rawBody, 'utf8');
    const signature = Buffer.from(signatureHex, 'hex');
    const ok = crypto.verify(null, message, publicKey, signature);
    if (!ok) console.error('Signature verification: signature did not match — either the wrong public key is set, or the request body was altered in transit.');
    return ok;
  } catch (e) {
    console.error('Signature verification error:', e);
    return false;
  }
}

module.exports = { verifyDiscordRequest };
