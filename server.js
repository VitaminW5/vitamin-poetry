'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const SOURCE_DATA_DIR = path.join(ROOT, 'data');
const DATA_DIR = process.env.VITAMIN_DATA_DIR ? path.resolve(process.env.VITAMIN_DATA_DIR) : SOURCE_DATA_DIR;

function ensureDataFile(name) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const target = path.join(DATA_DIR, name);
  if (!fs.existsSync(target)) {
    fs.copyFileSync(path.join(SOURCE_DATA_DIR, name), target);
  }
  return target;
}

const POEMS_FILE = ensureDataFile('poems.json');
const SITE_FILE = ensureDataFile('site.json');
const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.VITAMIN_ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.VITAMIN_SESSION_SECRET || (ADMIN_PASSWORD ? crypto.createHash('sha256').update(ADMIN_PASSWORD + ':vitamin').digest('hex') : crypto.randomBytes(32).toString('hex'));
const MAX_BODY = 2 * 1024 * 1024;
const COOKIE_SECURE = process.env.NODE_ENV === 'production';
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const loginAttempts = new Map();

const collectionMeta = {
  '微言小谈': { slug: 'weiyan', kind: '古体诗词' },
  '乱章杂句': { slug: 'luanzhang', kind: '歌词' },
  '未成曲调': { slug: 'weicheng', kind: '现代诗' }
};

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function writeJsonAtomic(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}
function json(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
function text(res, status, body, type = 'text/plain; charset=utf-8', headers = {}) {
  res.writeHead(status, { 'Content-Type': type, ...headers });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Payload too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        e.statusCode = 400;
        reject(e);
      }
    });
    req.on('error', reject);
  });
}
function cookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  raw.split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}
function signSession(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}
function verifySession(token) {
  if (!token || !token.includes('.')) return false;
  const [data, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    return payload.role === 'admin' && payload.exp > Date.now();
  } catch (_) { return false; }
}
function isAdmin(req) {
  return verifySession(cookies(req).vitamin_session);
}
function requireAdmin(req, res) {
  if (!isAdmin(req)) {
    json(res, 401, { error: '未登录或登录已失效' });
    return false;
  }
  return true;
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}
function loginAllowed(req) {
  const now = Date.now();
  const ip = clientIp(req);
  const recent = (loginAttempts.get(ip) || []).filter(t => now - t < LOGIN_WINDOW_MS);
  loginAttempts.set(ip, recent);
  return recent.length < LOGIN_MAX_ATTEMPTS;
}
function recordLoginFailure(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const recent = (loginAttempts.get(ip) || []).filter(t => now - t < LOGIN_WINDOW_MS);
  recent.push(now);
  loginAttempts.set(ip, recent);
}
function clearLoginFailures(req) {
  loginAttempts.delete(clientIp(req));
}
function cookieSecuritySuffix() {
  return COOKIE_SECURE ? '; Secure' : '';
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}
function sanitizePoemInput(input, existing = {}) {
  const title = String(input.title ?? existing.title ?? '').trim().slice(0, 120);
  const collection = String(input.collection ?? existing.collection ?? '未成曲调');
  if (!collectionMeta[collection]) throw Object.assign(new Error('无效文集'), { statusCode: 400 });
  const meta = collectionMeta[collection];
  return {
    ...existing,
    title,
    collection,
    collectionSlug: meta.slug,
    kind: meta.kind,
    content: String(input.content ?? existing.content ?? '').replace(/\r\n/g, '\n').slice(0, 100000),
    dateLabel: String(input.dateLabel ?? existing.dateLabel ?? '时间未考').trim().slice(0, 60) || '时间未考',
    poster: String(input.poster ?? existing.poster ?? '').trim(),
    background: String(input.background ?? existing.background ?? '').trim(),
    published: Boolean(input.published ?? existing.published ?? false),
    featured: Boolean(input.featured ?? existing.featured ?? false),
    note: String(input.note ?? existing.note ?? '').slice(0, 2000)
  };
}
function publicPoem(p) {
  const { note, ...rest } = p;
  return rest;
}
function staticFile(reqPath, res) {
  const normalized = path.normalize(reqPath).replace(/^([.][.][/\\])+/, '');
  const file = path.join(PUBLIC_DIR, normalized);
  if (!file.startsWith(PUBLIC_DIR)) return false;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  const headers = ext === '.webp'
    ? { 'Cache-Control': 'public, max-age=31536000, immutable' }
    : (ext === '.css' || ext === '.js')
      ? { 'Cache-Control': 'no-cache, no-store, must-revalidate' }
      : { 'Cache-Control': 'no-cache' };
  res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream', ...headers });
  fs.createReadStream(file).pipe(res);
  return true;
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  if (req.method === 'GET' && pathname === '/api/site') {
    return json(res, 200, readJson(SITE_FILE));
  }
  if (req.method === 'GET' && pathname === '/api/session') {
    return json(res, 200, { authenticated: isAdmin(req), adminEnabled: Boolean(ADMIN_PASSWORD) });
  }
  if (req.method === 'POST' && pathname === '/api/login') {
    if (!ADMIN_PASSWORD) return json(res, 503, { error: '后台尚未配置密码。请设置 VITAMIN_ADMIN_PASSWORD。' });
    if (!loginAllowed(req)) return json(res, 429, { error: '登录尝试过于频繁，请稍后再试。' });
    const body = await readBody(req);
    if (!safeEqual(body.password || '', ADMIN_PASSWORD)) {
      recordLoginFailure(req);
      return json(res, 401, { error: '密码错误' });
    }
    clearLoginFailures(req);
    const token = signSession({ role: 'admin', exp: Date.now() + 1000 * 60 * 60 * 24 * 7 });
    return json(res, 200, { ok: true }, {
      'Set-Cookie': `vitamin_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${60 * 60 * 24 * 7}${cookieSecuritySuffix()}`
    });
  }
  if (req.method === 'POST' && pathname === '/api/logout') {
    return json(res, 200, { ok: true }, { 'Set-Cookie': `vitamin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${cookieSecuritySuffix()}` });
  }
  if (req.method === 'GET' && pathname === '/api/poems') {
    let poems = readJson(POEMS_FILE).filter(p => p.published);
    const collection = url.searchParams.get('collection');
    if (collection) poems = poems.filter(p => p.collectionSlug === collection || p.collection === collection);
    return json(res, 200, poems.map(publicPoem));
  }
  const pubMatch = pathname.match(/^\/api\/poems\/(\d+)$/);
  if (req.method === 'GET' && pubMatch) {
    const id = Number(pubMatch[1]);
    const p = readJson(POEMS_FILE).find(x => x.id === id && x.published);
    if (!p) return json(res, 404, { error: '作品不存在' });
    return json(res, 200, publicPoem(p));
  }
  if (req.method === 'GET' && pathname === '/api/admin/poems') {
    if (!requireAdmin(req, res)) return;
    return json(res, 200, readJson(POEMS_FILE));
  }
  const adminMatch = pathname.match(/^\/api\/admin\/poems\/(\d+)$/);
  if (req.method === 'PUT' && adminMatch) {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const id = Number(adminMatch[1]);
    const poems = readJson(POEMS_FILE);
    const idx = poems.findIndex(p => p.id === id);
    if (idx < 0) return json(res, 404, { error: '作品不存在' });
    poems[idx] = { ...sanitizePoemInput(body, poems[idx]), id, slug: poems[idx].slug || String(id).padStart(2, '0') };
    writeJsonAtomic(POEMS_FILE, poems);
    return json(res, 200, poems[idx]);
  }
  if (req.method === 'POST' && pathname === '/api/admin/poems') {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const poems = readJson(POEMS_FILE);
    const id = poems.reduce((m, p) => Math.max(m, p.id), 0) + 1;
    const poem = {
      id,
      slug: String(id).padStart(2, '0'),
      ...sanitizePoemInput(body, { published: false, featured: false, dateLabel: '时间未考' })
    };
    if (!poem.title || !poem.content) return json(res, 400, { error: '标题和正文不能为空' });
    poems.push(poem);
    writeJsonAtomic(POEMS_FILE, poems);
    return json(res, 201, poem);
  }
  return json(res, 404, { error: 'API not found' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/health') return text(res, 200, 'ok');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (url.pathname !== '/' && staticFile(url.pathname.slice(1), res)) return;
    // SPA fallback
    const index = path.join(PUBLIC_DIR, 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    fs.createReadStream(index).pipe(res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, err.statusCode || 500, { error: err.statusCode ? err.message : '服务器内部错误' });
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log(`\n维生素 · 个人文学网站`);
  console.log(`http://localhost:${PORT}`);
  console.log(`数据目录：${DATA_DIR}`);
  console.log(ADMIN_PASSWORD ? '后台登录：已启用' : '后台登录：未启用（请设置 VITAMIN_ADMIN_PASSWORD）');
  console.log('');
});
