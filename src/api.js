export async function apiRequest(path, { method = 'GET', body, headers = {} } = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Unable to connect right now. Please try again shortly.');
  }

  let data;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok) {
    throw new Error(data?.error?.message || `Request failed (${response.status}).`);
  }
  return data;
}
