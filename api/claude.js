// =============================================================
// Server-side proxy for the Claude API. The browser never sees
// ANTHROPIC_API_KEY and never chooses a system prompt, model, or
// token limit — it only picks a `task` from the map below. Without
// that restriction this endpoint is a free open Claude proxy for
// anyone who finds the URL.
// =============================================================
'use strict';

const ALLOWED_ORIGINS = [
  'https://hayden-delta.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

const MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_INPUT_LENGTH = 4000;

// One system prompt per task. `input` is the only thing the client
// supplies — everything else about the request is fixed here.
const TASKS = {
  polish: {
    system:
      'Rewrite the task line you are given as one specific, actionable line. ' +
      'Preserve any date or time exactly as written, character for character. ' +
      'Return only the rewritten line — no preamble, no quotes, no explanation.',
    maxTokens: 200,
  },
  briefing: {
    system:
      'You write a short morning briefing for one person. You will get a JSON block ' +
      'of their overnight and planned data. Write 2 to 4 plain sentences, second ' +
      'person, no headings, no bullet points, no emoji. Lead with what today asks of ' +
      'them, then one honest observation from the numbers. Be specific and use the ' +
      'actual figures. Never scold, never hype, never give medical advice, never ' +
      'suggest restricting food or training through pain. If sleep was short, note it ' +
      'plainly and suggest easing load rather than pushing. Return prose only.',
    maxTokens: 320,
  },
};

module.exports = async function handler(req, res) {
  const origin = req.headers.origin;
  const originAllowed = ALLOWED_ORIGINS.indexOf(origin) !== -1;

  // Vary: Origin so any CDN/browser cache in front of this doesn't
  // serve one caller's CORS headers to another origin.
  res.setHeader('Vary', 'Origin');
  if (originAllowed) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(originAllowed ? 204 : 403).end();
  }
  if (!originAllowed) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  const task = body && body.task;
  const input = body && body.input;
  const taskDef = Object.prototype.hasOwnProperty.call(TASKS, task) ? TASKS[task] : null;

  if (!taskDef) return res.status(400).json({ error: 'Unknown task' });
  if (typeof input !== 'string' || !input.trim()) return res.status(400).json({ error: 'Missing input' });
  if (input.length > MAX_INPUT_LENGTH) return res.status(413).json({ error: 'Input too long' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('claude.js: ANTHROPIC_API_KEY is not set');
    return res.status(502).json({ error: 'Upstream unavailable' });
  }

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: taskDef.maxTokens,
        system: taskDef.system,
        messages: [{ role: 'user', content: input }],
      }),
    });

    if (!upstream.ok) {
      // Log upstream's own error body for debugging, but never hand it
      // to the client — it can leak account/billing details.
      const errText = await upstream.text().catch(() => '');
      console.error('claude.js: upstream error', upstream.status, errText);
      return res.status(502).json({ error: 'Upstream error' });
    }

    const data = await upstream.json();
    const text = (data && data.content && data.content[0] && data.content[0].text) || '';
    if (!text.trim()) {
      console.error('claude.js: upstream returned no text', JSON.stringify(data));
      return res.status(502).json({ error: 'Upstream error' });
    }
    return res.status(200).json({ text: text.trim() });
  } catch (e) {
    console.error('claude.js: request to upstream failed', e);
    return res.status(502).json({ error: 'Upstream error' });
  }
};
