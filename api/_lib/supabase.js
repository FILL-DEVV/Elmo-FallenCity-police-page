// Talks to Supabase's PostgREST API directly with the service_role key.
// This key bypasses Row Level Security, which is exactly why it must
// only ever be used here (server-side) and never sent to the browser.
function getConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  return { url, key };
}

async function sbFetch(path, { method = 'GET', body, extraHeaders = {} } = {}) {
  const { url, key } = getConfig();
  const res = await fetch(`${url}/rest/v1${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...extraHeaders
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase ${method} ${path} failed: ${res.status} ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

module.exports = { sbFetch };
