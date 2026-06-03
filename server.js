// server.js — ComptaAI backend avec Supabase
const http    = require('http');
const https   = require('https');
const fs      = require('fs');
const path    = require('path');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

const PORT       = process.env.PORT || 3000;
const HTML_FILE  = path.join(__dirname, 'compta-app.html');
const JWT_SECRET = process.env.JWT_SECRET || 'compta-ai-secret-change-me';

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_KEY || ''
);

// ── Helpers ──────────────────────────────────────────────────────────────────
function parseBody(req) {
  return new Promise((res, rej) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { res(JSON.parse(body)); }
      catch { res({}); }
    });
    req.on('error', rej);
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
    const { data } = await supabase.from('users').select('*').eq('id', payload.sub).single();
    return data;
  } catch { return null; }
}

// ── Serveur HTTP ──────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-api-key,anthropic-version');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const url = req.url.split('?')[0];

  // ── HTML ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET' && (url === '/' || url === '/index.html' || !url.startsWith('/api'))) {
    if (!fs.existsSync(HTML_FILE)) { res.writeHead(404); return res.end('compta-app.html introuvable'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(HTML_FILE));
  }

  // ── AUTH: POST /api/auth/register ─────────────────────────────────────────
  if (req.method === 'POST' && url === '/api/auth/register') {
    const body = await parseBody(req);
    const { email, password, nom, prenom, role } = body;
    if (!email || !password || !nom || !prenom) return send(res, 400, { error: 'Champs manquants' });
    const hash = await bcrypt.hash(password, 10);
    const { data, error } = await supabase.from('users')
      .insert({ email: email.toLowerCase(), password: hash, nom, prenom, role: role || 'comptable' })
      .select().single();
    if (error) return send(res, 409, { error: 'Email déjà utilisé' });
    const token = jwt.sign({ sub: data.id }, JWT_SECRET, { expiresIn: '30d' });
    return send(res, 201, { token, user: { id: data.id, email: data.email, nom: data.nom, prenom: data.prenom, role: data.role } });
  }

  // ── AUTH: POST /api/auth/login ────────────────────────────────────────────
  if (req.method === 'POST' && url === '/api/auth/login') {
    const body = await parseBody(req);
    const { email, password } = body;
    const { data: user } = await supabase.from('users').select('*').eq('email', (email||'').toLowerCase()).single();
    if (!user) return send(res, 401, { error: 'Email ou mot de passe incorrect' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return send(res, 401, { error: 'Email ou mot de passe incorrect' });
    const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '30d' });
    return send(res, 200, { token, user: { id: user.id, email: user.email, nom: user.nom, prenom: user.prenom, role: user.role } });
  }

  // ── AUTH: GET /api/auth/me ────────────────────────────────────────────────
  if (req.method === 'GET' && url === '/api/auth/me') {
    const user = await authMiddleware(req);
    if (!user) return send(res, 401, { error: 'Non authentifié' });
    return send(res, 200, { user: { id: user.id, email: user.email, nom: user.nom, prenom: user.prenom, role: user.role } });
  }

  // ── SOCIÉTÉS: GET /api/companies ──────────────────────────────────────────
  if (req.method === 'GET' && url === '/api/companies') {
    const user = await authMiddleware(req);
    if (!user) return send(res, 401, { error: 'Non authentifié' });
    let query;
    if (user.role === 'admin') {
      query = supabase.from('companies').select('*').order('created_at');
    } else {
      const { data: links } = await supabase.from('user_companies').select('company_id').eq('user_id', user.id);
      const ids = (links || []).map(l => l.company_id);
      if (!ids.length) return send(res, 200, []);
      query = supabase.from('companies').select('*').in('id', ids).order('created_at');
    }
    const { data } = await query;
    return send(res, 200, data || []);
  }

  // ── SOCIÉTÉS: POST /api/companies ─────────────────────────────────────────
  if (req.method === 'POST' && url === '/api/companies') {
    const user = await authMiddleware(req);
    if (!user) return send(res, 401, { error: 'Non authentifié' });
    const body = await parseBody(req);
    const { name, ice, ville } = body;
    if (!name) return send(res, 400, { error: 'Nom requis' });
    const { data: company } = await supabase.from('companies')
      .insert({ name, ice, ville, owner_id: user.id })
      .select().single();
    // Affecter automatiquement la société à l'utilisateur créateur
    await supabase.from('user_companies').insert({ user_id: user.id, company_id: company.id });
    return send(res, 201, company);
  }

  // ── SOCIÉTÉS: GET /api/companies/portal/:token ────────────────────────────
  if (req.method === 'GET' && url.startsWith('/api/companies/portal/')) {
    const token = url.split('/').pop();
    const { data } = await supabase.from('companies').select('id,name').eq('portal_token', token).single();
    if (!data) return send(res, 404, { error: 'Lien invalide' });
    return send(res, 200, data);
  }

  // ── FACTURES: GET /api/factures?company_id=xxx ────────────────────────────
  if (req.method === 'GET' && url === '/api/factures') {
    const user = await authMiddleware(req);
    if (!user) return send(res, 401, { error: 'Non authentifié' });
    const params = new URLSearchParams(req.url.split('?')[1] || '');
    const companyId = params.get('company_id');
    if (!companyId) return send(res, 400, { error: 'company_id requis' });
    const { data } = await supabase.from('factures').select('*')
      .eq('company_id', companyId).order('date_facture', { ascending: false });
    return send(res, 200, data || []);
  }

  // ── FACTURES: POST /api/factures ──────────────────────────────────────────
  if (req.method === 'POST' && url === '/api/factures') {
    const user = await authMiddleware(req);
    if (!user) return send(res, 401, { error: 'Non authentifié' });
    const body = await parseBody(req);
    const { data, error } = await supabase.from('factures').insert(body).select().single();
    if (error) return send(res, 400, { error: error.message });
    return send(res, 201, data);
  }

  // ── TRANSACTIONS: GET /api/transactions?company_id=xxx ────────────────────
  if (req.method === 'GET' && url === '/api/transactions') {
    const user = await authMiddleware(req);
    if (!user) return send(res, 401, { error: 'Non authentifié' });
    const params = new URLSearchParams(req.url.split('?')[1] || '');
    const companyId = params.get('company_id');
    const { data } = await supabase.from('transactions').select('*')
      .eq('company_id', companyId).order('date_operation', { ascending: false });
    return send(res, 200, data || []);
  }

  // ── TRANSACTIONS: POST /api/transactions ──────────────────────────────────
  if (req.method === 'POST' && url === '/api/transactions') {
    const user = await authMiddleware(req);
    if (!user) return send(res, 401, { error: 'Non authentifié' });
    const body = await parseBody(req);
    const rows = Array.isArray(body) ? body : [body];
    const { data, error } = await supabase.from('transactions').insert(rows).select();
    if (error) return send(res, 400, { error: error.message });
    return send(res, 201, data);
  }

  // ── UTILISATEURS: GET /api/users (admin seulement) ────────────────────────
  if (req.method === 'GET' && url === '/api/users') {
    const user = await authMiddleware(req);
    if (!user || user.role !== 'admin') return send(res, 403, { error: 'Admin requis' });
    const { data } = await supabase.from('users').select('id,email,nom,prenom,role,created_at').order('created_at');
    return send(res, 200, data || []);
  }

  // ── UTILISATEURS: POST /api/users/companies (affecter société) ────────────
  if (req.method === 'POST' && url === '/api/users/companies') {
    const user = await authMiddleware(req);
    if (!user || user.role !== 'admin') return send(res, 403, { error: 'Admin requis' });
    const body = await parseBody(req);
    await supabase.from('user_companies').upsert({ user_id: body.user_id, company_id: body.company_id });
    return send(res, 200, { ok: true });
  }

  // ── PROXY ANTHROPIC: POST /api/messages ───────────────────────────────────
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

  // ── DÉPÔT CLIENT: POST /api/portal/upload ────────────────────────────────
  if (req.method === 'POST' && url === '/api/portal/upload') {
    const body = await parseBody(req);
    const { company_id, files } = body;
    if (!company_id || !files) return send(res, 400, { error: 'Données manquantes' });
    const docs = files.map(f => ({ company_id, original_name: f.name, status: 'pending', from_client: true }));
    const { data } = await supabase.from('documents').insert(docs).select();
    return send(res, 201, { message: 'Documents reçus', count: data.length });
  }

  // ── STATS: GET /api/stats?company_id=xxx ──────────────────────────────────
  if (req.method === 'GET' && url === '/api/stats') {
    const user = await authMiddleware(req);
    if (!user) return send(res, 401, { error: 'Non authentifié' });
    const params = new URLSearchParams(req.url.split('?')[1] || '');
    const companyId = params.get('company_id');
    const [factures, transactions] = await Promise.all([
      supabase.from('factures').select('montant_ht,montant_tva,montant_ttc,categorie').eq('company_id', companyId),
      supabase.from('transactions').select('montant,type_mouvement').eq('company_id', companyId),
    ]);
    const f = factures.data || [];
    const t = transactions.data || [];
    return send(res, 200, {
      nb_factures:  f.length,
      total_ht:     f.reduce((s, x) => s + (+x.montant_ht  || 0), 0),
      total_tva:    f.reduce((s, x) => s + (+x.montant_tva || 0), 0),
      total_ttc:    f.reduce((s, x) => s + (+x.montant_ttc || 0), 0),
      nb_transactions: t.length,
    });
  }

  send(res, 404, { error: 'Route inconnue' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`ComptaAI démarré sur le port ${PORT}`);
});
