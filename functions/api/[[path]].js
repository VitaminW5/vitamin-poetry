import { SITE, SEED_POEMS } from '../_lib/seed.js';

const COLLECTION_META = {
  '微言小谈': { slug: 'weiyan', kind: '古体诗词' },
  '乱章杂句': { slug: 'luanzhang', kind: '歌词' },
  '未成曲调': { slug: 'weicheng', kind: '现代诗' }
};

const enc = new TextEncoder();
const dec = new TextDecoder();
const SESSION_COOKIE = '__Host-vitamin_session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_MAX_AGE = 24 * 60 * 60;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers
    }
  });
}

function parseCookies(request) {
  const out = {};
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function bytesToBase64Url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signSession(secret, payload) {
  const data = bytesToBase64Url(enc.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
  return `${data}.${bytesToBase64Url(sig)}`;
}

async function verifySession(secret, token) {
  if (!secret || !token || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  try {
    const key = await hmacKey(secret);
    const ok = await crypto.subtle.verify('HMAC', key, base64UrlToBytes(sig), enc.encode(data));
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(base64UrlToBytes(data)));
    if (payload.role !== 'admin' || Number(payload.exp) <= Date.now() || !payload.csrf) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

async function getAdminSession(request, env) {
  return verifySession(env.VITAMIN_SESSION_SECRET || '', parseCookies(request)[SESSION_COOKIE] || '');
}

async function isAdmin(request, env) {
  return Boolean(await getAdminSession(request, env));
}

function randomToken(bytes = 24) {
  const out = new Uint8Array(bytes);
  crypto.getRandomValues(out);
  return bytesToBase64Url(out);
}

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(text))));
}

async function secureEqualString(a, b) {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  let diff = ha.length ^ hb.length;
  const len = Math.max(ha.length, hb.length);
  for (let i = 0; i < len; i++) diff |= (ha[i % ha.length] ^ hb[i % hb.length]);
  return diff === 0;
}

function validCsrf(request, session) {
  const token = request.headers.get('X-CSRF-Token') || '';
  return Boolean(session?.csrf && token && token === session.csrf);
}

function asPoem(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    published: Boolean(row.published),
    featured: Boolean(row.featured)
  };
}

function publicPoem(p) {
  const { note, updatedAt, ...rest } = p;
  return rest;
}

function sanitize(input, existing = {}) {
  const collection = String(input.collection ?? existing.collection ?? '未成曲调').trim();
  const meta = COLLECTION_META[collection];
  if (!meta) throw new Error('无效文集');
  return {
    title: String(input.title ?? existing.title ?? '').trim().slice(0, 120),
    collection,
    collectionSlug: meta.slug,
    kind: meta.kind,
    content: String(input.content ?? existing.content ?? '').replace(/\r\n/g, '\n').slice(0, 100000),
    dateLabel: String(input.dateLabel ?? existing.dateLabel ?? '时间未考').trim().slice(0, 60) || '时间未考',
    poster: String(input.poster ?? existing.poster ?? '').trim().slice(0, 500),
    background: String(input.background ?? existing.background ?? '').trim().slice(0, 500),
    published: Boolean(input.published ?? existing.published ?? false),
    featured: Boolean(input.featured ?? existing.featured ?? false),
    note: String(input.note ?? existing.note ?? '').slice(0, 2000)
  };
}

async function ensureDb(env) {
  if (!env.DB) return false;

  // D1Database.exec() treats newlines as statement separators, so a multi-line
  // CREATE TABLE can be split into invalid fragments. Execute each complete
  // schema statement independently instead.
  const schemaStatements = [
    `CREATE TABLE IF NOT EXISTS poems (
      id INTEGER PRIMARY KEY,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      collection TEXT NOT NULL,
      collectionSlug TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      dateLabel TEXT NOT NULL DEFAULT '时间未考',
      poster TEXT NOT NULL DEFAULT '',
      background TEXT NOT NULL DEFAULT '',
      published INTEGER NOT NULL DEFAULT 1,
      featured INTEGER NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS login_attempts (
      ip TEXT NOT NULL,
      attempted_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_poems_collection ON poems(collectionSlug)`,
    `CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip, attempted_at)`
  ];

  for (const statement of schemaStatements) {
    await env.DB.prepare(statement).run();
  }
  const seeded = await env.DB.prepare("SELECT value FROM meta WHERE key='seeded_v1'").first();
  if (!seeded) {
    // D1 Free allows at most 50 database queries per Worker invocation and
    // at most 100 bound parameters per SQL statement. One poem uses 13
    // bound values, so seed in groups of 7 poems (91 parameters/query).
    // This turns 97 individual INSERT statements into only 14 INSERTs.
    const cols = '(id,slug,title,collection,collectionSlug,kind,content,dateLabel,poster,background,published,featured,note)';
    const rowPlaceholders = '(?,?,?,?,?,?,?,?,?,?,?,?,?)';
    const chunkSize = 7;
    const seedStatements = [];

    for (let start = 0; start < SEED_POEMS.length; start += chunkSize) {
      const chunk = SEED_POEMS.slice(start, start + chunkSize);
      const valuesSql = chunk.map(() => rowPlaceholders).join(',');
      const params = [];
      for (const p of chunk) {
        params.push(
          p.id,
          p.slug || String(p.id).padStart(2, '0'),
          p.title,
          p.collection,
          p.collectionSlug,
          p.kind,
          p.content,
          p.dateLabel || '时间未考',
          p.poster || '',
          p.background || '',
          p.published ? 1 : 0,
          p.featured ? 1 : 0,
          p.note || ''
        );
      }
      seedStatements.push(
        env.DB.prepare(`INSERT OR IGNORE INTO poems ${cols} VALUES ${valuesSql}`).bind(...params)
      );
    }

    seedStatements.push(
      env.DB.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('seeded_v1','1')")
    );
    await env.DB.batch(seedStatements);
  }
  return true;
}

async function readPoems(env, includeDrafts = false) {
  const seedFallback = () => SEED_POEMS.filter(p => includeDrafts || p.published).map(p => ({ ...p }));
  if (!env.DB) return seedFallback();
  try {
    await ensureDb(env);
    const sql = includeDrafts ? 'SELECT * FROM poems ORDER BY id' : 'SELECT * FROM poems WHERE published=1 ORDER BY id';
    const result = await env.DB.prepare(sql).all();
    return (result.results || []).map(asPoem);
  } catch (err) {
    // Public reading should never be taken offline by a D1 initialization
    // problem. Admin reads still surface the database error so it can be fixed.
    if (!includeDrafts) {
      console.error('D1 public-read fallback:', err);
      return seedFallback();
    }
    throw err;
  }
}

async function readBody(request) {
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > 2 * 1024 * 1024) throw new Error('请求内容过大');
  try { return await request.json(); } catch (_) { throw new Error('请求格式错误'); }
}

function getIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
}

async function loginAllowed(env, ip) {
  if (!env.DB) return true;
  await ensureDb(env);
  const cutoff = Date.now() - 15 * 60 * 1000;
  await env.DB.prepare('DELETE FROM login_attempts WHERE attempted_at < ?').bind(cutoff).run();
  const row = await env.DB.prepare('SELECT COUNT(*) AS c FROM login_attempts WHERE ip=?').bind(ip).first();
  return Number(row?.c || 0) < 5;
}

async function recordLoginFailure(env, ip) {
  if (!env.DB) return;
  await env.DB.prepare('INSERT INTO login_attempts(ip, attempted_at) VALUES(?,?)').bind(ip, Date.now()).run();
}

async function clearLoginFailures(env, ip) {
  if (!env.DB) return;
  await env.DB.prepare('DELETE FROM login_attempts WHERE ip=?').bind(ip).run();
}

function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  return origin === new URL(request.url).origin;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  try {
    if (!['GET', 'HEAD', 'POST', 'PUT', 'OPTIONS'].includes(method)) {
      return json({ error: 'Method not allowed' }, 405, { 'Allow': 'GET, HEAD, POST, PUT, OPTIONS' });
    }
    if (method === 'GET' && path === '/api/site') return json(SITE);

    if (method === 'GET' && path === '/api/session') {
      const adminSession = await getAdminSession(request, env);
      return json(adminSession ? { authenticated: true, csrf: adminSession.csrf } : { authenticated: false });
    }

    if (method === 'POST' && path === '/api/login') {
      if (!sameOrigin(request)) return json({ error: '非法请求来源' }, 403);
      if (!env.DB) return json({ error: '后台数据库尚未绑定，请先在 Cloudflare 绑定 D1。' }, 503);
      if (!env.VITAMIN_ADMIN_PASSWORD || !env.VITAMIN_SESSION_SECRET) {
        return json({ error: '后台尚未配置密码或会话密钥。' }, 503);
      }
      const ip = getIp(request);
      if (!(await loginAllowed(env, ip))) return json({ error: '登录尝试过于频繁，请稍后再试。' }, 429);
      const body = await readBody(request);
      if (!(await secureEqualString(String(body.password || ''), String(env.VITAMIN_ADMIN_PASSWORD)))) {
        await recordLoginFailure(env, ip);
        return json({ error: '密码错误' }, 401);
      }
      await clearLoginFailures(env, ip);
      const csrf = randomToken();
      const now = Date.now();
      const token = await signSession(env.VITAMIN_SESSION_SECRET, { role: 'admin', csrf, iat: now, exp: now + SESSION_TTL_MS });
      return json({ ok: true, csrf }, 200, {
        'Set-Cookie': `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE}; Priority=High`
      });
    }

    if (method === 'POST' && path === '/api/logout') {
      if (!sameOrigin(request)) return json({ error: '非法请求来源' }, 403);
      const adminSession = await getAdminSession(request, env);
      if (adminSession && !validCsrf(request, adminSession)) return json({ error: 'CSRF 校验失败' }, 403);
      return json({ ok: true }, 200, {
        'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0; Priority=High`
      });
    }

    if (method === 'GET' && path === '/api/poems') {
      let list = await readPoems(env, false);
      const collection = url.searchParams.get('collection');
      if (collection) list = list.filter(p => p.collectionSlug === collection || p.collection === collection);
      return json(list.map(publicPoem));
    }

    let m = path.match(/^\/api\/poems\/(\d+)$/);
    if (method === 'GET' && m) {
      const id = Number(m[1]);
      const list = await readPoems(env, false);
      const p = list.find(x => Number(x.id) === id);
      return p ? json(publicPoem(p)) : json({ error: '作品不存在' }, 404);
    }

    if (path.startsWith('/api/admin/')) {
      if (!env.DB) return json({ error: 'D1 数据库尚未绑定。' }, 503);
      const adminSession = await getAdminSession(request, env);
      if (!adminSession) return json({ error: '未登录或登录已失效' }, 401);
      if (!sameOrigin(request)) return json({ error: '非法请求来源' }, 403);
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !validCsrf(request, adminSession)) {
        return json({ error: 'CSRF 校验失败，请刷新后台后重试。' }, 403);
      }
      await ensureDb(env);
    }

    if (method === 'GET' && path === '/api/admin/poems') {
      return json(await readPoems(env, true));
    }

    m = path.match(/^\/api\/admin\/poems\/(\d+)$/);
    if (method === 'PUT' && m) {
      const id = Number(m[1]);
      const current = asPoem(await env.DB.prepare('SELECT * FROM poems WHERE id=?').bind(id).first());
      if (!current) return json({ error: '作品不存在' }, 404);
      const input = sanitize(await readBody(request), current);
      if (!input.title || !input.content) return json({ error: '标题和正文不能为空' }, 400);
      await env.DB.prepare(`UPDATE poems SET title=?,collection=?,collectionSlug=?,kind=?,content=?,dateLabel=?,poster=?,background=?,published=?,featured=?,note=?,updatedAt=CURRENT_TIMESTAMP WHERE id=?`)
        .bind(input.title,input.collection,input.collectionSlug,input.kind,input.content,input.dateLabel,input.poster,input.background,input.published?1:0,input.featured?1:0,input.note,id).run();
      return json(asPoem(await env.DB.prepare('SELECT * FROM poems WHERE id=?').bind(id).first()));
    }

    if (method === 'POST' && path === '/api/admin/poems') {
      const body = await readBody(request);
      const input = sanitize(body, { published: false, featured: false, dateLabel: '时间未考' });
      if (!input.title || !input.content) return json({ error: '标题和正文不能为空' }, 400);
      const row = await env.DB.prepare('SELECT COALESCE(MAX(id),0)+1 AS id FROM poems').first();
      const id = Number(row?.id || 1);
      const slug = String(id).padStart(2, '0');
      await env.DB.prepare(`INSERT INTO poems(id,slug,title,collection,collectionSlug,kind,content,dateLabel,poster,background,published,featured,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(id,slug,input.title,input.collection,input.collectionSlug,input.kind,input.content,input.dateLabel,input.poster,input.background,input.published?1:0,input.featured?1:0,input.note).run();
      return json(asPoem(await env.DB.prepare('SELECT * FROM poems WHERE id=?').bind(id).first()), 201);
    }

    return json({ error: 'API not found' }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: err?.message || '服务器内部错误' }, 500);
  }
}
