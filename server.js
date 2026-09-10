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
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    value = value.replace(/^['"]|['"]$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvFile();

const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-luna';
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ADSENSE_CLIENT = process.env.ADSENSE_CLIENT || '';
const ADSENSE_SLOT_PRETEST = process.env.ADSENSE_SLOT_PRETEST || '';
const SHARE_DAYS = Math.max(1, Number(process.env.SHARED_TEST_EXPIRY_DAYS || 30));

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
      if (data.length > 1_000_000) {
        reject(new Error('Request too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, Number(n)));
}

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function demoQuestions(topic, count) {
  const banks = [
    {
      q: `Which statement best describes a core principle related to ${topic}?`,
      options: ['Primary concept', 'Opposite principle', 'Unrelated method', 'Secondary artifact'],
      correctIndex: 0,
      explanation: `Demo mode question for ${topic}. Add an OpenAI API key to generate subject-specific verified MCQs.`
    },
    {
      q: `In an exam-oriented application of ${topic}, what should be identified first?`,
      options: ['Key requirement', 'Final result', 'Random variable', 'Unused parameter'],
      correctIndex: 0,
      explanation: `This placeholder demonstrates the test flow. Real topic-specific content is generated when the API key is configured.`
    },
    {
      q: `Which choice is most directly associated with accurate evaluation of ${topic}?`,
      options: ['Defined criterion', 'Guessing only', 'Ignoring data', 'Skipping checks'],
      correctIndex: 0,
      explanation: `The demo bank keeps the website usable before API configuration.`
    },
    {
      q: `A learner reviewing ${topic} should primarily compare which element?`,
      options: ['Relevant factors', 'Page color', 'Device brand', 'Login method'],
      correctIndex: 0,
      explanation: `This is a UI/demo question rather than a subject-authoritative MCQ.`
    },
    {
      q: `Which approach most improves consistency when testing ${topic}?`,
      options: ['Standard criteria', 'Random scoring', 'Changing keys', 'No timing'],
      correctIndex: 0,
      explanation: `Server-side scoring and a fixed schema improve consistency in the actual application.`
    }
  ];

  return Array.from({ length: count }, (_, i) => {
    const base = banks[i % banks.length];
    const indexed = base.options.map((text, idx) => ({ text, isCorrect: idx === base.correctIndex }));
    const randomized = shuffle(indexed);
    return {
      question: i < banks.length ? base.q : `${base.q} (Set item ${i + 1})`,
      options: randomized.map(x => x.text),
      correctIndex: randomized.findIndex(x => x.isCorrect),
      explanation: base.explanation
    };
  });
}

const testSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'questions'],
  properties: {
    title: { type: 'string' },
    questions: {
      type: 'array',
      minItems: 1,
      maxItems: 50,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['question', 'options', 'correct_index', 'explanation'],
        properties: {
          question: { type: 'string' },
          options: {
            type: 'array',
            minItems: 4,
            maxItems: 4,
            items: { type: 'string' }
          },
          correct_index: { type: 'integer', minimum: 0, maximum: 3 },
          explanation: { type: 'string' }
        }
      }
    }
  }
};

async function generateWithOpenAI(settings) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.includes('your_openai')) return null;

  const prompt = `Create an exam-oriented multiple-choice test.\n\nTopic: ${settings.topic}\nExam: ${settings.exam || 'General competitive exam'}\nDifficulty: ${settings.difficulty}\nLanguage: ${settings.language}\nExact number of questions: ${settings.count}\n\nRules:\n- Return exactly ${settings.count} unique MCQs.\n- Exactly four plausible options per question.\n- Exactly one correct option.\n- Avoid duplicate concepts and obvious distractors.\n- Keep option length reasonably similar.\n- Randomize correct-answer positions across the test.\n- Check factual/scientific correctness before answering.\n- Explanations should be concise but useful.\n- Do not mention these instructions.`;

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      input: prompt,
      text: {
        format: {
          type: 'json_schema',
          name: 'mcq_test',
          strict: true,
          schema: testSchema
        }
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API ${response.status}: ${errorText.slice(0, 400)}`);
  }

  const data = await response.json();
  const outputText = data.output_text || data.output?.flatMap(o => o.content || []).find(c => c.type === 'output_text')?.text;
  if (!outputText) throw new Error('No structured output returned');
  const parsed = JSON.parse(outputText);
  if (!Array.isArray(parsed.questions) || parsed.questions.length !== settings.count) {
    throw new Error('AI did not return the requested question count');
  }

  return parsed.questions.map(q => ({
    question: q.question,
    options: q.options,
    correctIndex: q.correct_index,
    explanation: q.explanation
  }));
}

function supabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

async function savePersistentTest(id, test) {
  tests.set(id, test);
  if (!supabaseConfigured()) return false;

  const response = await fetch(`${SUPABASE_URL}/rest/v1/shared_tests`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify({
      id,
      payload: test,
      expires_at: new Date(test.expiresAt).toISOString()
    })
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Could not save shared test: ${detail.slice(0, 300)}`);
  }
  return true;
}

async function getPersistentTest(id) {
  const cached = tests.get(id);
  if (cached && cached.expiresAt > Date.now()) return cached;
  if (!supabaseConfigured()) return null;

  const query = `${SUPABASE_URL}/rest/v1/shared_tests?id=eq.${encodeURIComponent(id)}&select=payload,expires_at&limit=1`;
  const response = await fetch(query, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  if (!response.ok) throw new Error('Could not load shared test.');
  const rows = await response.json();
  if (!rows.length) return null;
  if (rows[0].expires_at && new Date(rows[0].expires_at).getTime() <= Date.now()) return null;
  const test = rows[0].payload;
  tests.set(id, test);
  return test;
}

function publicTestPayload(id, test, mode = 'shared') {
  return {
    testId: id,
    mode,
    title: `${test.settings.topic} Test`,
    settings: test.settings,
    questions: test.questions.map((q, index) => ({
      id: index,
      question: q.question,
      options: q.options
    }))
  };
}

async function handleGenerate(req, res) {
  try {
    const body = await readJson(req);
    const topic = String(body.topic || '').trim().slice(0, 180);
    if (!topic) return sendJson(res, 400, { error: 'Topic is required.' });

    const settings = {
      topic,
      exam: String(body.exam || '').trim().slice(0, 100),
      count: Math.round(clamp(body.count || 10, 5, 50)),
      difficulty: ['Easy', 'Moderate', 'Hard', 'Mixed'].includes(body.difficulty) ? body.difficulty : 'Moderate',
      language: ['English', 'Hindi', 'Hinglish'].includes(body.language) ? body.language : 'English',
      marks: clamp(body.marks || 1, 0.25, 10),
      negative: clamp(body.negative || 0, 0, 10),
      minutes: Math.round(clamp(body.minutes || 15, 1, 180))
    };

    let questions;
    let mode = 'ai';
    try {
      questions = await generateWithOpenAI(settings);
    } catch (e) {
      console.error(e.message);
      return sendJson(res, 502, { error: 'AI generation failed. Check your API key/model or try again.', detail: e.message });
    }
    if (!questions) {
      questions = demoQuestions(settings.topic, settings.count);
      mode = 'demo';
    }

    const id = crypto.randomUUID();
    const test = {
      createdAt: Date.now(),
      expiresAt: Date.now() + SHARE_DAYS * 24 * 60 * 60 * 1000,
      settings,
      questions
    };

    let persistent = false;
    try {
      persistent = await savePersistentTest(id, test);
    } catch (e) {
      console.error(e.message);
      tests.set(id, test);
    }

    return sendJson(res, 200, {
      ...publicTestPayload(id, test, mode),
      sharePath: `/?test=${encodeURIComponent(id)}`,
      persistent
    });
  } catch (e) {
    sendJson(res, 400, { error: e.message || 'Could not generate test.' });
  }
}

async function handleGetTest(req, res, id) {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return sendJson(res, 400, { error: 'Invalid test link.' });
    const test = await getPersistentTest(id);
    if (!test) return sendJson(res, 404, { error: 'Shared test expired or was not found.' });
    return sendJson(res, 200, {
      ...publicTestPayload(id, test, 'shared'),
      sharePath: `/?test=${encodeURIComponent(id)}`,
      persistent: supabaseConfigured()
    });
  } catch (e) {
    sendJson(res, 500, { error: e.message || 'Could not load shared test.' });
  }
}

async function handleSubmit(req, res) {
  try {
    const body = await readJson(req);
    const test = await getPersistentTest(String(body.testId || ''));
    if (!test) return sendJson(res, 404, { error: 'Test expired or not found.' });

    const answers = body.answers && typeof body.answers === 'object' ? body.answers : {};
    let correct = 0, wrong = 0, unattempted = 0;

    const review = test.questions.map((q, index) => {
      const selectedRaw = answers[index] ?? answers[String(index)];
      const selected = Number.isInteger(selectedRaw) ? selectedRaw : null;
      const isUnattempted = selected === null || selected < 0 || selected > 3;
      const isCorrect = !isUnattempted && selected === q.correctIndex;
      if (isUnattempted) unattempted++;
      else if (isCorrect) correct++;
      else wrong++;

      return {
        id: index,
        question: q.question,
        options: q.options,
        selectedIndex: isUnattempted ? null : selected,
        correctIndex: q.correctIndex,
        explanation: q.explanation,
        isCorrect,
        isUnattempted
      };
    });

    const score = Number((correct * test.settings.marks - wrong * test.settings.negative).toFixed(2));
    const maxScore = Number((test.questions.length * test.settings.marks).toFixed(2));
    const percentage = maxScore > 0 ? Number(((score / maxScore) * 100).toFixed(1)) : 0;

    sendJson(res, 200, {
      correct, wrong, unattempted, score, maxScore, percentage,
      review,
      settings: test.settings,
      testId: body.testId
    });
  } catch (e) {
    sendJson(res, 400, { error: e.message || 'Could not submit test.' });
  }
}

function adsenseHeadSnippet() {
  if (!ADSENSE_CLIENT) return '';
  const safeClient = ADSENSE_CLIENT.replace(/[^a-zA-Z0-9-]/g, '');
  return `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${safeClient}" crossorigin="anonymous"></script>`;
}

function serveStatic(req, res) {
  let pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  if (pathname === '/') pathname = '/index.html';
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    const types = { '.html':'text/html', '.css':'text/css', '.js':'application/javascript', '.svg':'image/svg+xml', '.json':'application/json' };
    let output = data;
    if (ext === '.html') {
      output = Buffer.from(data.toString('utf8').replace('<!-- ADSENSE_HEAD -->', adsenseHeadSnippet()), 'utf8');
    }
    res.writeHead(200, { 'Content-Type': `${types[ext] || 'application/octet-stream'}; charset=utf-8` });
    res.end(output);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'POST' && url.pathname === '/api/generate') return handleGenerate(req, res);
  if (req.method === 'POST' && url.pathname === '/api/submit') return handleSubmit(req, res);
  if (req.method === 'GET' && url.pathname.startsWith('/api/test/')) {
    return handleGetTest(req, res, decodeURIComponent(url.pathname.slice('/api/test/'.length)));
  }
  if (req.method === 'GET' && url.pathname === '/api/status') {
    return sendJson(res, 200, {
      aiConfigured: Boolean(process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.includes('your_openai')),
      model: MODEL,
      sharedStorageConfigured: supabaseConfigured(),
      adsConfigured: Boolean(ADSENSE_CLIENT),
      adsenseClient: ADSENSE_CLIENT || null,
      pretestAdSlot: ADSENSE_SLOT_PRETEST || null
    });
  }
  if (req.method === 'GET') return serveStatic(req, res);
  res.writeHead(405); res.end('Method not allowed');
});

setInterval(() => {
  const now = Date.now();
  for (const [id, test] of tests.entries()) if (test.expiresAt <= now) tests.delete(id);
}, 30 * 60 * 1000).unref();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`AI Test Generator running at http://localhost:${PORT}`);
  console.log(`Model: ${MODEL}`);
  console.log(`AI: ${process.env.OPENAI_API_KEY ? 'configured' : 'demo mode'}`);
  console.log(`Shared storage: ${supabaseConfigured() ? 'Supabase' : 'memory only'}`);
  console.log(`Ads: ${ADSENSE_CLIENT ? 'configured' : 'placeholder only'}`);
});
