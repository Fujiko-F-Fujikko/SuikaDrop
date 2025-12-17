function jsonResponse(body, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { ...init, headers });
}

function getJstDayString(now = new Date()) {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

function clampInt(value, min, max) {
  if (!Number.isFinite(value)) return min;
  const v = Math.trunc(value);
  return Math.max(min, Math.min(max, v));
}

function sanitizeNickname(name) {
  const s = String(name ?? '').trim().replace(/\s+/g, ' ');
  return s.slice(0, 16) || 'Player';
}

function sanitizeDeviceId(id) {
  const s = String(id ?? '').trim();
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(s)) return null;
  return s;
}

function withCors(request, env, response) {
  const origin = request.headers.get('Origin');
  const allowed = new Set([
    env.ALLOWED_ORIGIN,
    'http://localhost:8000',
    'http://127.0.0.1:8000'
  ].filter(Boolean));

  const headers = new Headers(response.headers);
  if (origin && allowed.has(origin)) {
    headers.set('access-control-allow-origin', origin);
    headers.set('vary', 'Origin');
    headers.set('access-control-allow-credentials', 'false');
    headers.set('access-control-allow-headers', 'content-type');
    headers.set('access-control-allow-methods', 'GET,POST,OPTIONS');
    headers.set('access-control-max-age', '86400');
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function handleOptions(request, env) {
  return withCors(request, env, new Response(null, { status: 204 }));
}

async function handlePostScore(request, env) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return jsonResponse({ error: 'content-type must be application/json' }, { status: 415 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid json' }, { status: 400 });
  }

  const deviceId = sanitizeDeviceId(body.deviceId);
  if (!deviceId) return jsonResponse({ error: 'invalid deviceId' }, { status: 400 });

  const nickname = sanitizeNickname(body.nickname);
  const score = clampInt(Number(body.score), 0, 1_000_000_000);
  const clientVersion = String(body.clientVersion ?? '').slice(0, 32);
  const day = getJstDayString(new Date());

  const db = env.DB;
  const existing = await db.prepare(
    'SELECT score, updated_at FROM daily_scores WHERE day=? AND device_id=?'
  ).bind(day, deviceId).first();

  const prevScore = existing?.score ?? null;
  const shouldUpdateScore = prevScore === null || score > prevScore;

  if (prevScore === null) {
    await db.prepare(
      `INSERT INTO daily_scores(day, device_id, nickname, score, client_version, created_at, updated_at)
       VALUES(?,?,?,?,?,datetime('now'),datetime('now'))`
    ).bind(day, deviceId, nickname, score, clientVersion).run();
  } else if (shouldUpdateScore) {
    await db.prepare(
      `UPDATE daily_scores
       SET nickname=?, score=?, client_version=?, updated_at=datetime('now')
       WHERE day=? AND device_id=?`
    ).bind(nickname, score, clientVersion, day, deviceId).run();
  } else {
    // Allow nickname refresh even if score isn't updated.
    await db.prepare(
      `UPDATE daily_scores
       SET nickname=?, client_version=?
       WHERE day=? AND device_id=?`
    ).bind(nickname, clientVersion, day, deviceId).run();
  }

  const bestRow = await db.prepare(
    'SELECT score FROM daily_scores WHERE day=? AND device_id=?'
  ).bind(day, deviceId).first();

  return jsonResponse({
    day,
    accepted: shouldUpdateScore,
    best: bestRow?.score ?? score
  });
}

async function handleGetRanking(request, env, url) {
  const dayParam = url.searchParams.get('day');
  const day = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : getJstDayString(new Date());
  const limit = clampInt(Number(url.searchParams.get('limit')), 1, 100);

  const rows = await env.DB.prepare(
    `SELECT nickname, score, updated_at
     FROM daily_scores
     WHERE day=?
     ORDER BY score DESC, updated_at ASC
     LIMIT ?`
  ).bind(day, limit).all();

  const items = (rows.results || []).map((r, i) => ({
    rank: i + 1,
    nickname: r.nickname,
    score: r.score,
    at: r.updated_at
  }));

  return jsonResponse({ day, items });
}

async function handleGetMe(request, env, url) {
  const deviceId = sanitizeDeviceId(url.searchParams.get('deviceId'));
  if (!deviceId) return jsonResponse({ error: 'invalid deviceId' }, { status: 400 });

  const dayParam = url.searchParams.get('day');
  const day = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : getJstDayString(new Date());

  const me = await env.DB.prepare(
    `SELECT score, updated_at, nickname
     FROM daily_scores
     WHERE day=? AND device_id=?`
  ).bind(day, deviceId).first();
  if (!me) return jsonResponse({ day, me: null });

  const rankRow = await env.DB.prepare(
    `SELECT 1 + COUNT(*) AS rank
     FROM daily_scores
     WHERE day=?
       AND (
         score > ?
         OR (score = ? AND updated_at < ?)
       )`
  ).bind(day, me.score, me.score, me.updated_at).first();

  return jsonResponse({
    day,
    me: {
      rank: rankRow?.rank ?? null,
      nickname: me.nickname,
      score: me.score
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return withCors(request, env, await handleOptions(request, env));
    }

    try {
      let res;
      if (request.method === 'POST' && url.pathname === '/api/score') {
        res = await handlePostScore(request, env);
      } else if (request.method === 'GET' && url.pathname === '/api/ranking') {
        res = await handleGetRanking(request, env, url);
      } else if (request.method === 'GET' && url.pathname === '/api/me') {
        res = await handleGetMe(request, env, url);
      } else if (request.method === 'GET' && url.pathname === '/health') {
        res = jsonResponse({ ok: true });
      } else {
        res = jsonResponse({ error: 'not found' }, { status: 404 });
      }
      return withCors(request, env, res);
    } catch (e) {
      return withCors(request, env, jsonResponse({ error: 'internal error' }, { status: 500 }));
    }
  }
};

