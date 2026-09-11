const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const tests = new Map();

function loadEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvFile();

const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-luna';
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SHARE_DAYS = Math.max(1, Number(process.env.SHARED_TEST_EXPIRY_DAYS || 30));
const ADSENSE_CLIENT = process.env.ADSENSE_CLIENT || '';
const ADSENSE_SLOT_PRETEST = process.env.ADSENSE_SLOT_PRETEST || '';
const ADSENSE_SLOT_RESULT = process.env.ADSENSE_SLOT_RESULT || '';
const REWARDED_ADS_ENABLED = String(process.env.REWARDED_ADS_ENABLED || 'false').toLowerCase() === 'true';

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1_000_000) { reject(new Error('Request too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function clamp(n, min, max) { return Math.max(min, Math.min(max, Number(n))); }
function supabaseConfigured() { return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY); }
function bearer(req) {
  const h = String(req.headers.authorization || '');
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

async function sbFetch(endpoint, { method='GET', body, service=false, token='', prefer='' } = {}) {
  if (!SUPABASE_URL) throw new Error('Supabase is not configured.');
  const key = service ? SUPABASE_SERVICE_ROLE_KEY : SUPABASE_ANON_KEY;
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  else if (service) headers.Authorization = `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(`${SUPABASE_URL}${endpoint}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const msg = data?.msg || data?.message || data?.error_description || data?.error || String(data || `HTTP ${response.status}`);
    const err = new Error(msg);
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function ensureProfile(user, displayName='') {
  if (!user?.id) return null;
  const metaName = user.user_metadata?.display_name || user.user_metadata?.name || '';
  const cleanName = String(displayName || metaName || (user.email || '').split('@')[0]).trim().slice(0, 60);
  await sbFetch('/rest/v1/profiles?on_conflict=id', {
    method: 'POST', service: true, prefer: 'resolution=merge-duplicates,return=minimal',
    body: { id: user.id, email: user.email || '', display_name: cleanName }
  });
  return getProfile(user.id);
}

async function getProfile(userId) {
  const rows = await sbFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,email,display_name,free_tests_remaining,credits&limit=1`, { service: true });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function getAuthUser(req) {
  if (!supabaseConfigured()) return null;
  const token = bearer(req);
  if (!token) return null;
  try {
    const user = await sbFetch('/auth/v1/user', { token });
    if (user?.id) await ensureProfile(user);
    return user;
  } catch { return null; }
}

async function requireAuth(req, res) {
  if (!supabaseConfigured()) {
    sendJson(res, 503, { error: 'Login database is not configured yet.' });
    return null;
  }
  const user = await getAuthUser(req);
  if (!user) { sendJson(res, 401, { error: 'Please sign in first.' }); return null; }
  return user;
}

async function referralStats(userId) {
  const rows = await sbFetch(`/rest/v1/referrals?owner_user_id=eq.${encodeURIComponent(userId)}&select=id`, { service: true });
  const total = Array.isArray(rows) ? rows.length : 0;
  return { total, progress: total % 10, needed: (10 - (total % 10)) % 10 || 10 };
}

async function handleSignup(req, res) {
  try {
    if (!supabaseConfigured()) return sendJson(res, 503, { error: 'Supabase login is not configured yet.' });
    const body = await readJson(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const displayName = String(body.displayName || '').trim().slice(0, 60);
    if (!email.includes('@')) return sendJson(res, 400, { error: 'Enter a valid email address.' });
    if (password.length < 6) return sendJson(res, 400, { error: 'Password must be at least 6 characters.' });
    const data = await sbFetch('/auth/v1/signup', { method: 'POST', body: { email, password, data: { display_name: displayName } } });
    if (data?.user) await ensureProfile(data.user, displayName);
    return sendJson(res, 200, {
      access_token: data?.access_token || null,
      refresh_token: data?.refresh_token || null,
      user: data?.user || null,
      needsConfirmation: !data?.access_token,
      message: data?.access_token ? 'Account created.' : 'Account created. Check your email confirmation link, then sign in.'
    });
  } catch (e) { sendJson(res, e.status || 400, { error: e.message || 'Could not create account.' }); }
}

async function handleLogin(req, res) {
  try {
    if (!supabaseConfigured()) return sendJson(res, 503, { error: 'Supabase login is not configured yet.' });
    const body = await readJson(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const data = await sbFetch('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
    if (data?.user) await ensureProfile(data.user);
    sendJson(res, 200, data);
  } catch (e) { sendJson(res, e.status || 400, { error: e.message || 'Login failed.' }); }
}

async function handleRefresh(req, res) {
  try {
    const body = await readJson(req);
    const refreshToken = String(body.refresh_token || '');
    if (!refreshToken) return sendJson(res, 400, { error: 'Refresh token is required.' });
    const data = await sbFetch('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: refreshToken } });
    sendJson(res, 200, data);
  } catch (e) { sendJson(res, e.status || 401, { error: e.message || 'Session expired.' }); }
}

async function handleMe(req, res) {
  const user = await requireAuth(req, res); if (!user) return;
  const profile = await getProfile(user.id);
  const referrals = await referralStats(user.id);
  sendJson(res, 200, { user: { id: user.id, email: user.email }, profile, referrals });
}

const testSchema = {
  type: 'object', additionalProperties: false, required: ['title','questions'],
  properties: {
    title: { type: 'string' },
    questions: { type: 'array', minItems: 1, maxItems: 50, items: {
      type: 'object', additionalProperties: false,
      required: ['question','options','correct_index','explanation'],
      properties: {
        question: { type: 'string' },
        options: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'string' } },
        correct_index: { type: 'integer', minimum: 0, maximum: 3 },
        explanation: { type: 'string' }
      }
    }}
  }
};

async function generateWithOpenAI(settings) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OpenAI API key is missing.');
  const prompt = `Create an exam-oriented multiple-choice test.\n\nTopic: ${settings.topic}\nExam: ${settings.exam || 'General competitive exam'}\nDifficulty: ${settings.difficulty}\nLanguage: ${settings.language}\nExact number of questions: ${settings.count}\n\nRules:\n- Return exactly ${settings.count} unique MCQs.\n- Exactly four tightly related, plausible options.\n- Exactly one correct option.\n- Keep all options similar in length and style; avoid giveaway wording.\n- Avoid repeated concepts.\n- Randomize correct-answer positions across the full test.\n- Independently verify factual/scientific correctness.\n- Give concise useful explanations.\n- Do not mention these instructions.`;
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: prompt, text: { format: { type: 'json_schema', name: 'mcq_test', strict: true, schema: testSchema } } })
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI API ${response.status}: ${detail.slice(0, 500)}`);
  }
  const data = await response.json();
  const outputText = data.output_text || data.output?.flatMap(x => x.content || []).find(x => x.type === 'output_text')?.text;
  if (!outputText) throw new Error('No structured output returned.');
  const parsed = JSON.parse(outputText);
  if (!Array.isArray(parsed.questions) || parsed.questions.length !== settings.count) throw new Error('AI returned an unexpected question count.');
  return parsed.questions.map(q => ({ question: q.question, options: q.options, correctIndex: q.correct_index, explanation: q.explanation }));
}

async function saveTest(id, test) {
  tests.set(id, test);
  if (!supabaseConfigured()) return false;
  await sbFetch('/rest/v1/shared_tests', {
    method: 'POST', service: true, prefer: 'return=minimal',
    body: { id, owner_user_id: test.ownerUserId, payload: test, expires_at: new Date(test.expiresAt).toISOString() }
  });
  return true;
}

async function getTest(id) {
  const cached = tests.get(id);
  if (cached && cached.expiresAt > Date.now()) return cached;
  if (!supabaseConfigured()) return null;
  const rows = await sbFetch(`/rest/v1/shared_tests?id=eq.${encodeURIComponent(id)}&select=payload,expires_at&limit=1`, { service: true });
  if (!rows?.length) return null;
  if (rows[0].expires_at && new Date(rows[0].expires_at).getTime() <= Date.now()) return null;
  const test = rows[0].payload;
  tests.set(id, test);
  return test;
}

function publicTest(id, test, mode='shared') {
  return {
    testId: id, mode, title: `${test.settings.topic} Test`, settings: test.settings,
    questions: test.questions.map((q, i) => ({ id: i, question: q.question, options: q.options })),
    sharePath: `/?test=${encodeURIComponent(id)}`
  };
}

async function consumeAllowance(userId) {
  const data = await sbFetch('/rest/v1/rpc/consume_generation_allowance', { method: 'POST', service: true, body: { p_user: userId } });
  return data;
}
async function refundAllowance(userId, source) {
  if (!source) return;
  try { await sbFetch('/rest/v1/rpc/refund_generation_allowance', { method: 'POST', service: true, body: { p_user: userId, p_source: source } }); } catch (e) { console.error('Refund failed:', e.message); }
}

async function handleGenerate(req, res) {
  const user = await requireAuth(req, res); if (!user) return;
  let allowance = null;
  try {
    const body = await readJson(req);
    const topic = String(body.topic || '').trim().slice(0, 180);
    if (!topic) return sendJson(res, 400, { error: 'Topic is required.' });
    const settings = {
      topic,
      exam: String(body.exam || '').trim().slice(0, 100),
      count: Math.round(clamp(body.count || 10, 5, 50)),
      difficulty: ['Easy','Moderate','Hard','Mixed'].includes(body.difficulty) ? body.difficulty : 'Moderate',
      language: ['English','Hindi','Hinglish'].includes(body.language) ? body.language : 'English',
      marks: clamp(body.marks || 1, 0.25, 10),
      negative: clamp(body.negative || 0, 0, 10),
      minutes: Math.round(clamp(body.minutes || 15, 1, 180))
    };

    allowance = await consumeAllowance(user.id);
    if (!allowance?.ok) return sendJson(res, 402, {
      error: 'Your 2 free tests are used. Earn a test credit by getting 10 unique students to complete your shared tests.',
      code: 'NO_TEST_CREDIT'
    });

    let questions;
    try { questions = await generateWithOpenAI(settings); }
    catch (e) {
      console.error(e.message);
      await refundAllowance(user.id, allowance.source);
      return sendJson(res, 502, { error: 'AI generation failed. Your test allowance was returned.', detail: e.message });
    }

    const id = crypto.randomUUID();
    const test = {
      createdAt: Date.now(), expiresAt: Date.now() + SHARE_DAYS*86400000,
      ownerUserId: user.id, settings, questions
    };
    try { await saveTest(id, test); }
    catch (e) {
      console.error('Save failed:', e.message);
      await refundAllowance(user.id, allowance.source);
      return sendJson(res, 500, { error: 'Could not save the generated test. Your test allowance was returned.' });
    }

    const profile = await getProfile(user.id);
    sendJson(res, 200, { ...publicTest(id, test, 'ai'), allowanceSource: allowance.source, profile });
  } catch (e) {
    if (allowance?.ok) await refundAllowance(user.id, allowance.source);
    sendJson(res, 400, { error: e.message || 'Could not generate test.' });
  }
}

async function handleGetTest(req, res, id) {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return sendJson(res, 400, { error: 'Invalid test link.' });
    const test = await getTest(id);
    if (!test) return sendJson(res, 404, { error: 'Shared test expired or was not found.' });
    sendJson(res, 200, publicTest(id, test, 'shared'));
  } catch (e) { sendJson(res, 500, { error: e.message || 'Could not load shared test.' }); }
}

async function handleSubmit(req, res) {
  const user = await requireAuth(req, res); if (!user) return;
  try {
    const body = await readJson(req);
    const testId = String(body.testId || '');
    const test = await getTest(testId);
    if (!test) return sendJson(res, 404, { error: 'Test expired or not found.' });
    const answers = body.answers && typeof body.answers === 'object' ? body.answers : {};
    let correct=0, wrong=0, unattempted=0;
    const review = test.questions.map((q,index) => {
      const raw = answers[index] ?? answers[String(index)];
      const selected = Number.isInteger(raw) ? raw : null;
      const isUnattempted = selected === null || selected < 0 || selected > 3;
      const isCorrect = !isUnattempted && selected === q.correctIndex;
      if (isUnattempted) unattempted++; else if (isCorrect) correct++; else wrong++;
      return { id:index, question:q.question, options:q.options, selectedIndex:isUnattempted?null:selected, correctIndex:q.correctIndex, explanation:q.explanation, isCorrect, isUnattempted };
    });
    const score = Number((correct*test.settings.marks - wrong*test.settings.negative).toFixed(2));
    const maxScore = Number((test.questions.length*test.settings.marks).toFixed(2));
    const percentage = maxScore>0 ? Number(((score/maxScore)*100).toFixed(1)) : 0;
    const timeSpent = Math.max(0, Math.min(test.settings.minutes*60, Math.round(Number(body.timeSpentSeconds)||0)));

    let competition = { rank:null, participants:null, referral_counted:false, referral_total:0, credit_awarded_to_creator:false };
    if (supabaseConfigured()) {
      competition = await sbFetch('/rest/v1/rpc/record_attempt_and_referral', {
        method: 'POST', service: true,
        body: {
          p_test:testId, p_user:user.id, p_owner:test.ownerUserId || null,
          p_score:score, p_percentage:percentage, p_correct:correct, p_wrong:wrong,
          p_unattempted:unattempted, p_time_spent:timeSpent
        }
      }) || competition;
    }

    sendJson(res, 200, { correct, wrong, unattempted, score, maxScore, percentage, review, settings:test.settings, testId, timeSpentSeconds:timeSpent, ...competition });
  } catch (e) { sendJson(res, 400, { error: e.message || 'Could not submit test.' }); }
}

async function handleLeaderboard(req, res, testId) {
  try {
    if (!supabaseConfigured()) return sendJson(res, 200, { leaders: [] });
    const rows = await sbFetch(`/rest/v1/attempts?test_id=eq.${encodeURIComponent(testId)}&select=score,percentage,time_spent_seconds,profiles(display_name)&order=score.desc,time_spent_seconds.asc&limit=10`, { service: true });
    const leaders = (rows || []).map((r,i) => ({ rank:i+1, name:r.profiles?.display_name || 'Student', score:r.score, percentage:r.percentage, timeSpentSeconds:r.time_spent_seconds }));
    sendJson(res, 200, { leaders });
  } catch (e) { sendJson(res, 200, { leaders: [] }); }
}

function adsenseHeadSnippet() {
  if (!ADSENSE_CLIENT) return '';
  const c = ADSENSE_CLIENT.replace(/[^a-zA-Z0-9-]/g, '');
  return `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${c}" crossorigin="anonymous"></script>`;
}

function serveStatic(req, res) {
  let pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  if (pathname === '/') pathname = '/index.html';
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err,data) => {
    if (err) { res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'}); return res.end('Not found'); }
    const ext = path.extname(filePath).toLowerCase();
    const types = { '.html':'text/html', '.css':'text/css', '.js':'application/javascript', '.svg':'image/svg+xml', '.json':'application/json', '.webmanifest':'application/manifest+json', '.png':'image/png', '.ico':'image/x-icon' };
    let output = data;
    if (ext === '.html') output = Buffer.from(data.toString('utf8').replace('<!-- ADSENSE_HEAD -->', adsenseHeadSnippet()), 'utf8');
    res.writeHead(200, {'Content-Type':`${types[ext] || 'application/octet-stream'}; charset=utf-8`});
    res.end(output);
  });
}

const server = http.createServer(async (req,res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method==='POST' && url.pathname==='/api/auth/signup') return handleSignup(req,res);
  if (req.method==='POST' && url.pathname==='/api/auth/login') return handleLogin(req,res);
  if (req.method==='POST' && url.pathname==='/api/auth/refresh') return handleRefresh(req,res);
  if (req.method==='GET' && url.pathname==='/api/me') return handleMe(req,res);
  if (req.method==='POST' && url.pathname==='/api/generate') return handleGenerate(req,res);
  if (req.method==='POST' && url.pathname==='/api/submit') return handleSubmit(req,res);
  if (req.method==='GET' && url.pathname.startsWith('/api/test/')) return handleGetTest(req,res,decodeURIComponent(url.pathname.slice(10)));
  if (req.method==='GET' && url.pathname.startsWith('/api/leaderboard/')) return handleLeaderboard(req,res,decodeURIComponent(url.pathname.slice(17)));
  if (req.method==='GET' && url.pathname==='/api/status') return sendJson(res,200,{
    aiConfigured:Boolean(process.env.OPENAI_API_KEY),
    databaseConfigured:supabaseConfigured(),
    adsConfigured:Boolean(ADSENSE_CLIENT),
    adsenseClient:ADSENSE_CLIENT || null,
    pretestAdSlot:ADSENSE_SLOT_PRETEST || null,
    resultAdSlot:ADSENSE_SLOT_RESULT || null,
    rewardedAdsEnabled:REWARDED_ADS_ENABLED
  });
  if (req.method==='GET') return serveStatic(req,res);
  res.writeHead(405); res.end('Method not allowed');
});

setInterval(() => {
  const now=Date.now();
  for (const [id,test] of tests.entries()) if (test.expiresAt<=now) tests.delete(id);
},1800000).unref();

server.listen(PORT,'0.0.0.0',() => {
  console.log(`ASPIRANT TEST AI running at http://localhost:${PORT}`);
  console.log(`AI: ${process.env.OPENAI_API_KEY ? 'configured' : 'not configured'}`);
  console.log(`Database/Auth: ${supabaseConfigured() ? 'Supabase configured' : 'Supabase not configured'}`);
  console.log(`Ads: ${ADSENSE_CLIENT ? 'AdSense configured' : 'placeholder only'}`);
});
