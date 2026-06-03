// server.js — ComptaAI backend avec Supabase
const http    = require('http');
const https   = require('https');
const fs      = require('fs');
const path    = require('path');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');

const PORT       = process.env.PORT || 3000;
const HTML_FILE  = path.join(__dirname, 'compta-app.html');
const JWT_SECRET = process.env.JWT_SECRET || 'compta-ai-secret-change-me';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

// ── Helper Supabase REST direct (sans SDK) ───────────────────────────────────
async function supaFetch(method, table, opts = {}) {
  const { filter, body, select } = opts;
  let url = `${SUPABASE_URL}/rest/v1/${table}`;
  const params = [];
  if (select) params.push(`select=${select}`);
  if (filter) params.push(filter);
  if (params.length) url += '?' + params.join('&');

  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Prefer': method === 'POST' ? 'return=representation' : '',
      },
    };
    if (bodyStr) options.headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ data: parsed, status: res.statusCode });
        } catch {
          resolve({ data: data, status: res.statusCode });
        }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function parseBody(req) {
  return new Promise((res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { try { res(JSON.parse(body)); } catch { res({}); } });
  });
}

function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

async function authMiddleware(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(h.slice(7), JWT_SECRET);
    const { data } = await supaFetch('GET', 'users', { filter: `id=eq.${payload.sub}` });
    return Array.isArray(data) && data.length ? data[0] : null;
  } catch { return null; }
}

// ── Serveur HTTP ──────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-api-key,anthropic-version');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const url = req.url.split('?')[0];

  // ── HTML ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET' && (url === '/' || !url.startsWith('/api'))) {
    if (!fs.existsSync(HTML_FILE)) { res.writeHead(404); return res.end('compta-app.html introuvable'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(HTML_FILE));
  }

  // ── POST /api/auth/register ───────────────────────────────────────────────
  if (req.method === 'POST' && url === '/api/auth/register') {
    const body = await parseBody(req);
    const { email, password, nom, prenom, role } = body;
    if (!email || !password || !nom || !prenom) return send(res, 400, { error: 'Champs manquants' });
    const hash = await bcrypt.hash(password, 10);
    const { data, status } = await supaFetch('POST', 'users', {
      body: { email: email.toLowerCase(), password: hash, nom, prenom, role: role || 'comptable' }
    });
    if (status !== 201) return send(res, 409, { error: 'Email déjà utilisé' });
    const user = Array.isArray(data) ? data[0] : data;
    const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '30d' });
    return send(res, 201, { token, user: { id: user.id, email: user.email, nom: user.nom, prenom: user.prenom, role: user.role } });
  }

  // ── POST /api/auth/login ──────────────────────────────────────────────────
  if (req.method === 'POST' && url === '/api/auth/login') {
    const body = await parseBody(req);
    const { email, password } = body;
    const { data } = await supaFetch('GET', 'users', { filter: `email=eq.${(email||'').toLowerCase()}` });
    const user = Array.isArray(data) && data.length ? data[0] : null;
    if (!user) return send(res, 401, { error: 'Email ou mot de passe incorrect' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return send(res, 401, { error: 'Email ou mot de passe incorrect' });
    const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '30d' });
    return send(res, 200, { token, user: { id: user.id, email: user.email, nom: user.nom, prenom: user.prenom, role: user.role } });
  }

  // ── GET /api/auth/me ──────────────────────────────────────────────────────
  if (req.method === 'GET' && url === '/api/auth/me') {
    const user = await authMiddleware(req);
    if (!user) return send(res, 401, { error: 'Non authentifié' });
    return send(res, 200, { user: { id: user.id, email: user.email, nom: user.nom, prenom: user.prenom, role: user.role } });
  }

  // ── GET /api/companies ────────────────────────────────────────────────────
  if (req.method === 'GET' && url === '/api/companies') {
    const user = await authMiddleware(req);
    if (!user) return send(res, 401, { error: 'Non authentifié' });
    let result;
    if (user.role === 'admin') {
      result = await supaFetch('GET', 'companies', { filter: 'order=created_at' });
    } else {
      const links = await supaFetch('GET', 'user_companies', { filter: `user_id=eq.${user.id}` });
      const ids = (links.data || []).map(l => l.company_id);
      if (!ids.length) return send(res, 200, []);
      result = await supaFetch('GET', 'companies', { filter: `id=in.(${ids.join(',')})` });
    }
    return send(res, 200, result.data || []);
  }

  // ── POST /api/companies ───────────────────────────────────────────────────
  if (req.method === 'POST' && url === '/api/companies') {
    const user = await authMiddleware(req);
    if (!user) return send(res, 401, { error: 'Non authentifié' });
    const body = await parseBody(req);
    const { name, ice, ville } = body;
    if (!name) return send(res, 400, { error: 'Nom requis' });
    const { data } = await supaFetch('POST', 'companies', { body: { name, ice, ville, owner_id: user.id } });
    const company = Array.isArray(data) ? data[0] : data;
    await supaFetch('POST', 'user_companies', { body: { user_id: user.id, company_id: company.id } });
    return send(res, 201, company);
  }

  // ── GET /api/companies/portal/:token ─────────────────────────────────────
  if (req.method === 'GET' && url.startsWith('/api/companies/portal/')) {
    const token = url.split('/').pop();
    const { data } = await supaFetch('GET', 'companies', { filter: `portal_token=eq.${token}&select=id,name` });
    const company = Array.isArray(data) && data.length ? data[0] : null;
    if (!company) return send(res, 404, { error: 'Lien invalide' });
    return send(res, 200, company);
  }

  // ── GET /api/factures ─────────────────────────────────────────────────────
  if (req.method === 'GET' && url === '/api/factures') {
    const user = await authMiddleware(req);
    if (!user) return send(res, 401, { error: 'Non authentifié' });
    const params = new URLSearchParams(req.url.split('?')[1] || '');
    const companyId = params.get('company_id');
    if (!companyId) return send(res, 400, { error: 'company_id requis' });
    const { data } = await supaFetch('GET', 'factures', { filter: `company_id=eq.${companyId}&order=date_facture.desc` });
    return send(res, 200, data || []);
  }

  // ── POST /api/factures ────────────────────────────────────────────────────
  if (req.method === 'POST' && url === '/api/factures') {
    const user = await authMiddleware(req);
    if (!user) return send(res, 401, { error: 'Non authentifié' });
    const body = await parseBody(req);
    const { data } = await supaFetch('POST', 'factures', { body });
    return send(res, 201, Array.isArray(data) ? data[0] : data);
  }

  // ── GET /api/transactions ─────────────────────────────────────────────────
  if (req.method === 'GET' && url === '/api/transactions') {
    const user = await authMiddleware(req);
    if (!user) return send(res, 401, { error: 'Non authentifié' });
    const params = new URLSearchParams(req.url.split('?')[1] || '');
    const companyId = params.get('company_id');
    const { data } = await supaFetch('GET', 'transactions', { filter: `company_id=eq.${companyId}&order=date_operation.desc` });
    return send(res, 200, data || []);
  }

  // ── POST /api/transactions ────────────────────────────────────────────────
  if (req.method === 'POST' && url === '/api/transactions') {
    const user = await authMiddleware(req);
    if (!user) return send(res, 401, { error: 'Non authentifié' });
    const body = await parseBody(req);
    const rows = Array.isArray(body) ? body : [body];
    const { data } = await supaFetch('POST', 'transactions', { body: rows });
    return send(res, 201, data);
  }

  // ── GET /api/users ────────────────────────────────────────────────────────
  if (req.method === 'GET' && url === '/api/users') {
    const user = await authMiddleware(req);
    if (!user || user.role !== 'admin') return send(res, 403, { error: 'Admin requis' });
    const { data } = await supaFetch('GET', 'users', { select: 'id,email,nom,prenom,role,created_at' });
    return send(res, 200, data || []);
  }

  // ── POST /api/portal/upload ───────────────────────────────────────────────
  if (req.method === 'POST' && url === '/api/portal/upload') {
    const body = await parseBody(req);
    const { company_id, files } = body;
    if (!company_id || !files) return send(res, 400, { error: 'Données manquantes' });
    const docs = files.map(f => ({ company_id, original_name: f.name, status: 'pending', from_client: true }));
    await supaFetch('POST', 'documents', { body: docs });
    return send(res, 201, { message: 'Documents reçus', count: files.length });
  }

  // ── POST /api/messages (proxy Anthropic) ─────────────────────────────────
  if (req.method === 'POST' && url === '/api/messages') {
    const user = await authMiddleware(req);
    if (!user) return send(res, 401, { error: 'Non authentifié' });
    const apiKey = req.headers['x-api-key'] || '';
    if (!apiKey.startsWith('sk-ant-')) return send(res, 401, { error: 'Clé API Anthropic invalide' });
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const options = {
        hostname: 'api.anthropic.com', port: 443,
        path: '/v1/messages', method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body),
        },
      };
      const pr = https.request(options, (pres) => {
        let rb = '';
        pres.on('data', c => rb += c);
        pres.on('end', () => {
          res.writeHead(pres.statusCode, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(rb);
        });
      });
      pr.on('error', e => send(res, 502, { error: e.message }));
      pr.write(body); pr.end();
    });
    return;
  }

  // ── Health check ──────────────────────────────────────────────────────────
  if (url === '/health') {
    return send(res, 200, { status: 'ok', supabase: !!SUPABASE_URL, uptime: process.uptime() });
  }

  send(res, 404, { error: 'Route inconnue: ' + url });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`NEOEXPERT ComptaAI démarré sur le port ${PORT}`);
  console.log(`Supabase URL: ${SUPABASE_URL ? '✓ configurée' : '✗ manquante'}`);
  console.log(`Supabase Key: ${SUPABASE_KEY ? '✓ configurée' : '✗ manquante'}`);
});
