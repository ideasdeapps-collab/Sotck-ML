/**
 * fetch + parse that never surfaces a raw "JSON.parse: unexpected character"
 * error. A route protected by Vercel Deployment Protection, a 500 rendered as
 * an HTML error page, or an SSO redirect all return HTML, and calling
 * response.json() on those throws a message that says nothing useful.
 */
export async function fetchJson<T = any>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { cache: 'no-store', ...init });
  const raw = await response.text();
  const contentType = response.headers.get('content-type') || '';

  if (!contentType.includes('application/json')) {
    const looksLikeHtml = raw.trimStart().startsWith('<');

    if (looksLikeHtml && (response.status === 401 || response.status === 403 || response.redirected)) {
      throw new Error('API blocked by Deployment Protection — open the preview while signed in to Vercel');
    }

    if (response.status === 404) {
      throw new Error(`API route not found (404): ${input} — it was not included in the deployment`);
    }

    throw new Error(
      looksLikeHtml
        ? `API returned HTML instead of JSON (HTTP ${response.status}) — the route crashed`
        : `Unexpected response from ${input} (HTTP ${response.status})`
    );
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Malformed JSON from ${input} (HTTP ${response.status})`);
  }
}
