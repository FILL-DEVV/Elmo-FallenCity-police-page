const crypto = require('crypto');

const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET environment variable is not set');
  return s;
}

function base64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64urlDecode(input) {
  input = input.replace(/-/g, '+').replace(/_/g, '/');
  while (input.length % 4) input += '=';
  return Buffer.from(input, 'base64').toString('utf8');
}

function sign(payloadObj) {
  const payload = base64url(JSON.stringify(payloadObj));
  const sig = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verify(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
  const sigBuf = Buffer.from(sig, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  let data;
  try { data = JSON.parse(base64urlDecode(payload)); } catch { return null; }
  if (!data.exp || Date.now() > data.exp) return null;
  return data;
}

function makeSessionCookie(payloadObj) {
  const data = { ...payloadObj, exp: Date.now() + MAX_AGE_SECONDS * 1000 };
  const token = sign(data);
  return `session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_SECONDS}`;
}

function clearSessionCookie() {
  return `session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

function getSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  return verify(cookies.session);
}

module.exports = { makeSessionCookie, clearSessionCookie, getSession, parseCookies };
