// Web Push without payload: the server sends an empty push, the service worker
// then asks /api/push/pending what to show. No payload encryption needed.
// Keys are generated on first use and kept in KV ("push:vapid").

const b64u = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const txt = (s) => b64u(new TextEncoder().encode(s));

export async function vapid(env) {
  let v = await env.KV.get('push:vapid', 'json');
  if (v) return v;
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = b64u(await crypto.subtle.exportKey('raw', pair.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  v = { pub, jwk };
  await env.KV.put('push:vapid', JSON.stringify(v));
  return v;
}

async function jwt(v, aud, sub) {
  const key = await crypto.subtle.importKey('jwk', v.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = txt(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = txt(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub }));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(head + '.' + body));
  return head + '.' + body + '.' + b64u(sig);
}

export async function loadSubs(env) {
  return (await env.KV.get('push:subs', 'json')) || {};
}

// Puts items in every subscription's queue and wakes the devices up.
export async function notify(env, items, origin) {
  const subs = await loadSubs(env);
  const eps = Object.keys(subs);
  if (!eps.length || !items.length) return 0;
  for (const ep of eps) {
    const q = subs[ep].queue || [];
    subs[ep].queue = [...q, ...items].slice(-20);
  }
  await env.KV.put('push:subs', JSON.stringify(subs));
  const v = await vapid(env);
  let sent = 0, changed = false;
  for (const ep of eps) {
    try {
      const token = await jwt(v, new URL(ep).origin, origin);
      const r = await fetch(ep, {
        method: 'POST',
        headers: { Authorization: `vapid t=${token}, k=${v.pub}`, TTL: '600', Urgency: 'high', 'Content-Length': '0' },
      });
      if (r.status === 404 || r.status === 410) { delete subs[ep]; changed = true; }
      else if (r.ok) sent++;
    } catch {}
  }
  if (changed) await env.KV.put('push:subs', JSON.stringify(subs));
  return sent;
}
// Kyiv wall-clock date and minutes since midnight.
export function kyivNow(d = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d).map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
}

const weekday = (date) => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };

// Нагадування нотаток. note.remind — мітка часу першого спрацювання (мс), note.repeat — '' | 'day' | 'week'.
// Повтори рахуються за київським часом (переведення годинника не зсуває нагадування).
// Викликається cron щохвилини; спрацьовує, якщо час настав не більше 15 хв тому.
export async function remindNotes(env, data, origin) {
  const notes = Object.values(data.notes || {}).filter((n) => !n.deleted && n.remind > 0);
  const sentMap = (await env.KV.get('push:sent', 'json')) || {};
  const nowMs = Date.now(), now = kyivNow(new Date(nowMs));
  const fire = [];
  for (const n of notes) {
    let tag = null;
    if (!n.repeat) {
      if (nowMs >= n.remind && nowMs - n.remind <= 15 * 60000) tag = 'once:' + n.remind;
    } else {
      const base = kyivNow(new Date(n.remind));
      const sameDay = n.repeat === 'day' || weekday(now.date) === weekday(base.date);
      if (now.date >= base.date && sameDay && now.min >= base.min && now.min - base.min <= 15) tag = n.repeat + ':' + now.date + ':' + base.min;
    }
    if (tag && sentMap[n.id] !== tag) { sentMap[n.id] = tag; fire.push(n); }
  }
  // прибрати записи про нотатки, яких уже немає
  const alive = new Set(notes.map((n) => n.id));
  let cleaned = false;
  for (const id of Object.keys(sentMap)) if (!alive.has(id)) { delete sentMap[id]; cleaned = true; }
  if (!fire.length && !cleaned) return 0;
  await env.KV.put('push:sent', JSON.stringify(sentMap));
  if (!fire.length) return 0;
  const items = fire.map((n) => {
    const title = n.title.trim() || n.body.replace(/^[\s☐☑]+/, '').split('\n')[0].slice(0, 80) || 'Нотатка';
    const open = (n.body.match(/^\s*☐/gm) || []).length;
    const body = n.title.trim()
      ? (open ? `У списку ${open} невиконаних` : n.body.replace(/[☐☑]\s?/g, '').trim().split('\n').slice(0, 3).join(' · ').slice(0, 140))
      : '';
    return { id: n.id, title, body };
  });
  return notify(env, items, origin);
}
