import { checkAuth } from './auth.js';
import { vapid, loadSubs, notify, remindNotes } from './push.js';

// Дані: один ключ `notes` у KV: { notes: {id: нотатка}, settings: {theme, updated} }
// Нотатка: { id, title, body, pinned, color, remind, repeat, deleted, created, updated }
// remind — мітка часу нагадування (мс, 0 = без сповіщення), repeat — '' | 'day' | 'week'
const KEY = 'notes';
const THEMES = ['graphite', 'racing', 'red', 'navy', 'purple', 'light', 'mono'];
const COLORS = ['', 'red', 'orange', 'yellow', 'green', 'blue', 'purple'];
const DAY = 86400000;
const REPEATS = ['', 'day', 'week'];
const SITE = 'https://my-notices.yuraandrushenk.workers.dev';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

async function load(env) {
  const data = (await env.KV.get(KEY, 'json')) || {};
  return { notes: data.notes || {}, settings: data.settings || { theme: 'graphite', updated: 0 } };
}

function cleanNote(n) {
  if (!n || typeof n.id !== 'string' || n.id.length > 64) return null;
  return {
    id: n.id,
    title: String(n.title || '').slice(0, 300),
    body: String(n.body || '').slice(0, 100000),
    pinned: !!n.pinned,
    color: COLORS.includes(n.color) ? n.color : '',
    remind: Math.max(0, Number(n.remind) || 0),
    repeat: REPEATS.includes(n.repeat) ? n.repeat : '',
    deleted: !!n.deleted,
    created: Number(n.created) || Date.now(),
    updated: Number(n.updated) || Date.now(),
  };
}

function cleanSettings(s) {
  return { theme: THEMES.includes(s?.theme) ? s.theme : 'graphite', updated: Number(s?.updated) || Date.now() };
}

async function pushApi(request, env, url) {
  if (url.pathname === '/api/push/key') return new Response((await vapid(env)).pub, { headers: { 'Cache-Control': 'no-store' } });
  if (url.pathname === '/api/push/pending') {
    // service worker забирає текст сповіщень (сам push порожній)
    const ep = url.searchParams.get('ep') || '';
    const subs = await loadSubs(env);
    const q = (subs[ep] && subs[ep].queue) || [];
    if (q.length) { subs[ep].queue = []; await env.KV.put('push:subs', JSON.stringify(subs)); }
    return json(q);
  }
  if (url.pathname === '/api/push/status') return json({ devices: Object.keys(await loadSubs(env)).length });
  if (request.method !== 'POST' || request.headers.get('Origin') !== url.origin) return json({ error: 'origin' }, 403);
  if (url.pathname === '/api/push/subscribe') {
    const sub = await request.json().catch(() => null);
    if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint)) return json({ error: 'sub' }, 400);
    const subs = await loadSubs(env);
    subs[sub.endpoint] = { queue: (subs[sub.endpoint] && subs[sub.endpoint].queue) || [], added: Date.now() };
    await env.KV.put('push:subs', JSON.stringify(subs));
    return json({ ok: true });
  }
  if (url.pathname === '/api/push/test') {
    const sent = await notify(env, [{ id: 'test-' + Date.now(), title: 'Тестове сповіщення ✓', body: 'Нагадування з нотаток приходитимуть так' }], url.origin);
    return json({ ok: true, sent });
  }
  return json({ error: 'not found' }, 404);
}

async function api(request, env, url) {
  if (url.pathname.startsWith('/api/push/')) {
    try { return await pushApi(request, env, url); } catch { return json({ error: 'push unavailable' }, 503); }
  }
  if (url.pathname !== '/api/data') return json({ error: 'not found' }, 404);
  const data = await load(env);

  if (request.method === 'POST') {
    let changes;
    try { changes = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
    if (!Array.isArray(changes)) return json({ error: 'array expected' }, 400);

    for (const ch of changes.slice(0, 500)) {
      if (ch?.type === 'note') {
        const n = cleanNote(ch.item);
        if (!n) continue;
        const old = data.notes[n.id];
        // приймаємо зміну лише якщо вона не старіша за збережену (два телефони одночасно)
        if (!old || n.updated >= old.updated) data.notes[n.id] = n;
      } else if (ch?.type === 'settings') {
        const s = cleanSettings(ch.item);
        if (s.updated >= (data.settings.updated || 0)) data.settings = s;
      }
    }
    // прибирання: видалені старші 30 днів
    const now = Date.now();
    for (const [id, n] of Object.entries(data.notes)) {
      if (n.deleted && now - n.updated > 30 * DAY) delete data.notes[id];
    }
    await env.KV.put(KEY, JSON.stringify(data));
  }
  return json(data);
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(load(env).then((data) => remindNotes(env, data, env.SITE_URL || SITE)));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    const denied = await checkAuth(request, env);
    if (denied) return denied;

    if (url.pathname.startsWith('/api/')) return api(request, env, url);

    let res = await env.ASSETS.fetch(request);
    if (res.status === 404 && url.pathname === '/apple-touch-icon-precomposed.png') res = await env.ASSETS.fetch(new Request(new URL('/apple-touch-icon.png', url), request));
    const type = res.headers.get('Content-Type') || '';
    if (type.includes('text/html') || type.includes('manifest')) {
      const out = new Response(res.body, res);
      out.headers.set('Cache-Control', 'no-cache');
      return out;
    }
    return res;
  },
};
