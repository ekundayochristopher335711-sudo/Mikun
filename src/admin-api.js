export async function adminRequest(path, { method = 'GET', body, csrfToken, signal } = {}) {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    signal,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error?.message || `Request failed (${response.status}).`);
    error.code = result.error?.code || 'REQUEST_FAILED';
    error.status = response.status;
    throw error;
  }
  return result;
}
