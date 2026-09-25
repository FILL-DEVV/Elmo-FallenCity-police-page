// Talks to Supabase's PostgREST API directly with the service_role key.
// This key bypasses Row Level Security, which is exactly why it must
// only ever be used here (server-side) and never sent to the browser.
function getConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  return { url, key };
}

// Same reasoning as discordFetch in _lib/discord.js: retries a couple of
// times on NETWORK-level failures only (the TypeError fetch() throws for
// connection problems — never for an actual HTTP error response, which
// resolves normally with res.ok === false). Serverless functions can go
// idle between invocations while a pooled keep-alive connection to
// Supabase's edge is silently closed on the far side; the next reuse
// attempt then fails at the socket level before any request reaches
// Supabase at all. Without this, that shows up as an EOI lookup, role
// grant, or log write silently doing nothing.
async function fetchWithRetry(url, options, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetch(url, options);
    } catch (e) {
      if (attempt === retries) throw e;
      console.error('sbFetch: network error on attempt ' + (attempt + 1) + ' of ' + (retries + 1) + ', retrying:', e.message || e);
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
}

async function sbFetch(path, { method = 'GET', body, extraHeaders = {} } = {}) {
  const { url, key } = getConfig();
  const res = await fetchWithRetry(`${url}/rest/v1${path}`, {
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
