// Вхід за паролем. Пароль — секрет PASSWORD у Cloudflare (Worker → Settings → Variables and Secrets).
// Після входу пристрій отримує cookie на рік.

const COOKIE = 'notes_auth';
const PUBLIC = new Set(['/manifest.webmanifest', '/icon-v4-180.png', '/icon-v4-512.png', '/favicon.ico']);

async function token(env) {
  const data = new TextEncoder().encode('my-notices:' + env.PASSWORD);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function getCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

// Повертає Response, якщо треба показати вхід, або null, якщо доступ є.
export async function checkAuth(request, env) {
  const url = new URL(request.url);
  if (PUBLIC.has(url.pathname)) return null;

  if (!env.PASSWORD) {
    return page('Пароль ще не задано. Додайте секрет PASSWORD у Cloudflare: Worker → Settings → Variables and Secrets.', false);
  }
  const good = await token(env);

  if (url.pathname === '/login' && request.method === 'POST') {
    const form = await request.formData();
    if ((form.get('password') || '') === env.PASSWORD) {
      return new Response(null, {
        status: 303,
        headers: {
          Location: '/',
          'Set-Cookie': `${COOKIE}=${good}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`,
        },
      });
    }
    return page('Неправильний пароль', true, 401);
  }

  if (getCookie(request, COOKIE) === good) return null;

  if (url.pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'auth' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  return page('', true, 401);
}

function page(message, form, status = 200) {
  const html = `<!doctype html><html lang="uk"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#121316"><meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Нотатки">
<link rel="apple-touch-icon" href="/icon-v4-180.png"><link rel="manifest" href="/manifest.webmanifest">
<title>Нотатки</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#121316;color:#eceef2;font:16px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:24px}
.box{width:100%;max-width:340px;text-align:center}img{width:84px;height:84px;border-radius:20px}
h1{font-size:22px;margin:14px 0 22px}p{color:#ff6b6b;min-height:1.4em}
input{width:100%;font-size:17px;padding:14px 16px;border-radius:14px;border:1px solid #2e3036;background:#1c1d21;color:inherit;outline:none}
input:focus{border-color:#f2c14e}button{margin-top:12px;width:100%;font-size:17px;font-weight:600;padding:14px;border:0;border-radius:14px;background:#f2c14e;color:#1a1400}
</style></head><body><div class="box"><img src="/icon-v4-180.png" alt=""><h1>Нотатки</h1>
${form ? `<form method="post" action="/login"><input type="password" name="password" placeholder="Пароль" autocomplete="current-password" autofocus><button>Увійти</button></form>` : ''}
<p>${message}</p></div></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
