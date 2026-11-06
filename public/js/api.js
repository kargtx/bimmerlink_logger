async function request(url, options = {}) {
  const res = await fetch(url, options);
  let body = null;
  const type = res.headers.get('content-type') || '';
  if (type.includes('application/json')) body = await res.json();
  if (!res.ok) throw new Error((body && body.error) || `Сервер ответил ошибкой ${res.status}.`);
  return body;
}

const json = (method, data) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(data)
});

export const api = {
  listLogs: () => request('/api/logs').then((r) => r.logs),
  getLog: (id) => request(`/api/logs/${id}`),
  uploadLog(file, name) {
    const form = new FormData();
    form.append('name', name || '');
    form.append('logfile', file, file.name);
    return request('/api/logs', { method: 'POST', body: form });
  },
  updateLog: (id, patch) => request(`/api/logs/${id}`, json('PATCH', patch)),
  deleteLog: (id) => request(`/api/logs/${id}`, { method: 'DELETE' }),
  getData(id, channels, { from, to, points } = {}) {
    const q = new URLSearchParams({ ch: channels.join(','), points: String(points || 4000) });
    if (from !== undefined && from !== null) q.set('from', String(from));
    if (to !== undefined && to !== null) q.set('to', String(to));
    return request(`/api/logs/${id}/data?${q}`);
  },
  rawUrl: (id) => `/api/logs/${id}/raw`,
  listPresets: () => request('/api/presets').then((r) => r.presets),
  createPreset: (name, channels) => request('/api/presets', json('POST', { name, channels })),
  deletePreset: (id) => request(`/api/presets/${id}`, { method: 'DELETE' })
};
