const Matter = window.Matter;
if (!Matter) {
  throw new Error('Matter.js failed to load. Check that vendor/matter.min.js is served correctly.');
}

const { Engine, World, Bodies, Body, Events, Sleeping } = Matter;

const VERSION = '0.3.1';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const scoreEl = document.getElementById('score');
const currentPreviewCanvas = document.getElementById('current-preview');
const nextPreviewCanvas = document.getElementById('next-preview');
const restartBtn = document.getElementById('restart');
const versionEl = document.getElementById('version');
const tiltEnableBtn = document.getElementById('tilt-enable');
const tiltCalibrateBtn = document.getElementById('tilt-calibrate');
const tiltStatusEl = document.getElementById('tilt-status');
const onlineRankingEl = document.getElementById('ranking-online');
const localRankingEl = document.getElementById('ranking-local');
const nicknameEl = document.getElementById('nickname');
const rankingRefreshBtn = document.getElementById('ranking-refresh');
const onlineStatusEl = document.getElementById('online-status');
const myRankEl = document.getElementById('my-rank');

const previewCtxCurrent = currentPreviewCanvas.getContext('2d');
const previewCtxNext = nextPreviewCanvas.getContext('2d');

const WIDTH = canvas.width;
const HEIGHT = canvas.height;

const WALL_MARGIN = Math.round(WIDTH * 0.14);
const TOP_LINE = Math.round(HEIGHT * 0.17);
const FLOOR_PADDING = Math.round(HEIGHT * 0.06);
const BUCKET_SCALE = 0.80;
const BUCKET_HEIGHT = Math.round((HEIGHT - TOP_LINE - FLOOR_PADDING) * BUCKET_SCALE);

const bounds = {
  left: WALL_MARGIN,
  right: WIDTH - WALL_MARGIN,
  floor: TOP_LINE + BUCKET_HEIGHT,
  topLine: TOP_LINE
};

const FRUITS = [
  { name: 'さくらんぼ', radius: 14, color: '#ff3355', accent: '#ffd1dc', score: 2 },
  { name: 'いちご', radius: 18, color: '#e11d48', accent: '#ffe4e6', score: 4 },
  { name: 'ぶどう', radius: 22, color: '#7c3aed', accent: '#ddd6fe', score: 8 },
  { name: 'かき', radius: 28, color: '#fb923c', accent: '#fed7aa', score: 12 },
  { name: 'みかん', radius: 34, color: '#f59e0b', accent: '#fde68a', score: 18 },
  { name: 'りんご', radius: 40, color: '#ef4444', accent: '#fee2e2', score: 26 },
  { name: 'なし', radius: 48, color: '#84cc16', accent: '#ecfccb', score: 40 },
  { name: 'もも', radius: 56, color: '#fb7185', accent: '#ffe4e6', score: 60 },
  { name: 'スイカ', radius: 70, color: '#16a34a', accent: '#bbf7d0', score: 90 }
];

const FIXED_STEP_MS = 1000 / 60;
const MAX_ACCUMULATED_MS = 250;
const GAMEOVER_TIME = 220; // ms above line while sleeping
const MERGE_DISTANCE_EPS = 0.6;
const CONTACT_MERGE_TTL_MS = 180;

const basePool = [0, 0, 1, 1, 2, 2, 3, 4];

let engine = null;
let walls = [];
let fruitById = new Map();
let pendingMerges = [];
let recentContacts = new Map();

let heldFruit = null;
let heldType = 0;
let nextType = 0;
let spawnX = WIDTH / 2;
let score = 0;
let gameOver = false;

let accumulatorMs = 0;
let lastTime = 0;
let lastPreviewHeld = null;
let lastPreviewNext = null;
let suppressClickUntil = 0;
let touchActive = false;
let tiltEnabled = false;
let tiltTargetX = 0;
let tiltListenerAttached = false;
let scoreRecorded = false;

const BASE_GRAVITY_Y = 1.25;
const TILT_MAX_DEG = 35;
const TILT_DEADZONE_DEG = 3.5;
const TILT_MAX_GX = 0.95;
const TILT_SMOOTHING = 0.18;
const TILT_LOCK_MS_AFTER_DROP = 450;
const TILT_WAKE_THRESHOLD = 0.03;

let tiltLockUntil = 0;
let tiltHasCalibration = false;
let tiltNeutralScreenX = 0;
let tiltNeutralScreenY = 0;
let tiltLastScreenX = 0;
let tiltLastScreenY = 0;
let lastAppliedGX = 0;
let lastAppliedGY = BASE_GRAVITY_Y;

const SCORE_HISTORY_KEY = 'suika-drop:scores';
const SCORE_HISTORY_LIMIT = 10;
let scoreHistory = [];
const DEVICE_ID_KEY = 'suika-drop:deviceId';
const NICKNAME_KEY = 'suika-drop:nickname';
const API_BASE_KEY = 'suika-drop:apiBase';

// Set your Cloudflare Worker URL here, or set it in localStorage as `suika-drop:apiBase`.
const DEFAULT_API_BASE = 'https://suikadrop.haruka-fujisawa.workers.dev';

function randomBaseFruit() {
  return basePool[Math.floor(Math.random() * basePool.length)];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function setSpawnXFromClientPoint(clientX) {
  const rect = canvas.getBoundingClientRect();
  const x = (clientX - rect.left) * (WIDTH / rect.width);
  spawnX = clamp(x, bounds.left + 16, bounds.right - 16);
  if (heldFruit) heldFruit.x = spawnX;
}

function setupWorld() {
  engine = Engine.create({
    positionIterations: 10,
    velocityIterations: 8,
    constraintIterations: 2
  });
  engine.enableSleeping = true;
  engine.gravity.y = BASE_GRAVITY_Y;
  engine.gravity.scale = 0.001;
  engine.gravity.x = 0;
  lastAppliedGX = 0;
  lastAppliedGY = BASE_GRAVITY_Y;

  walls = [];
  fruitById = new Map();
  pendingMerges = [];
  recentContacts = new Map();

  const thickness = 28;
  const wallHeight = (bounds.floor - bounds.topLine) + thickness;
  const wallY = (bounds.topLine + bounds.floor) / 2;

  const leftWall = Bodies.rectangle(bounds.left - thickness / 2, wallY, thickness, wallHeight, {
    isStatic: true,
    restitution: 0.02,
    friction: 0.0,
    frictionStatic: 0.0,
    label: 'wall'
  });
  const rightWall = Bodies.rectangle(bounds.right + thickness / 2, wallY, thickness, wallHeight, {
    isStatic: true,
    restitution: 0.02,
    friction: 0.0,
    frictionStatic: 0.0,
    label: 'wall'
  });
  const floor = Bodies.rectangle(WIDTH / 2, bounds.floor + thickness / 2, (bounds.right - bounds.left) + thickness * 2, thickness, {
    isStatic: true,
    restitution: 0.02,
    friction: 0.12,
    frictionStatic: 0.45,
    label: 'floor'
  });

  walls.push(leftWall, rightWall, floor);
  World.add(engine.world, walls);

  // Catch very brief “tap” contacts (e.g., rolling along a slope) so they still merge.
  Events.off(engine, 'collisionStart');
  Events.on(engine, 'collisionStart', event => {
    for (const pair of event.pairs) {
      const a = pair.bodyA;
      const b = pair.bodyB;
      const ia = a?.plugin?.suika;
      const ib = b?.plugin?.suika;
      if (!ia || !ib) continue;
      if (ia.type !== ib.type) continue;
      if (ia.merging || ib.merging) continue;

      const lo = Math.min(a.id, b.id);
      const hi = Math.max(a.id, b.id);
      recentContacts.set(`${lo}:${hi}`, CONTACT_MERGE_TTL_MS);
    }
  });
}

function loadScoreHistory() {
  try {
    const raw = localStorage.getItem(SCORE_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(x => ({
        score: Number(x?.score) || 0,
        at: typeof x?.at === 'string' ? x.at : null
      }))
      .filter(x => Number.isFinite(x.score));
  } catch {
    return [];
  }
}

function saveScoreHistory(list) {
  try {
    localStorage.setItem(SCORE_HISTORY_KEY, JSON.stringify(list));
  } catch {
    // ignore (private mode etc.)
  }
}

function recordScoreOnce() {
  if (scoreRecorded) return;
  scoreRecorded = true;

  scoreHistory.unshift({ score, at: new Date().toISOString() });
  scoreHistory = scoreHistory.slice(0, SCORE_HISTORY_LIMIT);
  saveScoreHistory(scoreHistory);
  renderLocalRanking();
}

function formatRankMeta(isoString) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function setOnlineStatus(text) {
  if (!onlineStatusEl) return;
  onlineStatusEl.textContent = text;
}

function setMyRankText(text) {
  if (!myRankEl) return;
  myRankEl.textContent = text;
}

function getOrCreateDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (id && /^[a-zA-Z0-9-]{8,64}$/.test(id)) return id;
  id = (crypto?.randomUUID ? crypto.randomUUID() : `dev-${Math.random().toString(16).slice(2)}-${Date.now()}`);
  localStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}

function getNickname() {
  const stored = localStorage.getItem(NICKNAME_KEY);
  if (stored && stored.trim()) return stored.trim().slice(0, 16);
  const suffix = Math.random().toString(16).slice(2, 6).toUpperCase();
  const name = `Player-${suffix}`;
  localStorage.setItem(NICKNAME_KEY, name);
  return name;
}

function setNickname(name) {
  const trimmed = String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, 16);
  localStorage.setItem(NICKNAME_KEY, trimmed || 'Player');
}

function getApiBase() {
  return (localStorage.getItem(API_BASE_KEY) || DEFAULT_API_BASE || '').replace(/\/+$/, '');
}

async function fetchJson(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function submitScoreOnline() {
  const apiBase = getApiBase();
  if (!apiBase) return;
  const deviceId = getOrCreateDeviceId();
  const nickname = getNickname();
  await fetchJson(`${apiBase}/api/score`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId, nickname, score, clientVersion: VERSION })
  });
}

function renderOnlineRanking(items) {
  if (!onlineRankingEl) return;
  onlineRankingEl.innerHTML = '';
  if (!items?.length) {
    const li = document.createElement('li');
    li.textContent = 'まだ投稿がありません';
    onlineRankingEl.appendChild(li);
    return;
  }
  for (const item of items) {
    const li = document.createElement('li');
    const nameSpan = document.createElement('span');
    nameSpan.className = 'rank-score';
    nameSpan.textContent = `${item.rank}. ${item.nickname}`;

    const scoreSpan = document.createElement('span');
    scoreSpan.className = 'rank-meta';
    scoreSpan.textContent = Number(item.score).toLocaleString('ja-JP');

    li.appendChild(nameSpan);
    li.appendChild(scoreSpan);
    onlineRankingEl.appendChild(li);
  }
}

async function refreshOnlineRanking() {
  const apiBase = getApiBase();
  if (!apiBase) {
    setOnlineStatus('オンライン未設定（API URLが必要）');
    return;
  }

  setOnlineStatus('更新中…');
  setMyRankText('');
  try {
    const ranking = await fetchJson(`${apiBase}/api/ranking?limit=50`, { method: 'GET' });
    renderOnlineRanking(ranking.items || []);
    setOnlineStatus(`今日: ${ranking.day}`);

    const deviceId = getOrCreateDeviceId();
    const me = await fetchJson(`${apiBase}/api/me?day=${encodeURIComponent(ranking.day)}&deviceId=${encodeURIComponent(deviceId)}`, { method: 'GET' });
    if (me?.me?.rank) {
      setMyRankText(`あなた: ${me.me.rank}位（${Number(me.me.score).toLocaleString('ja-JP')}）`);
    } else {
      setMyRankText('あなた: 未投稿');
    }
  } catch (e) {
    setOnlineStatus(`更新失敗: ${String(e.message || e)}`);
  }
}

function renderLocalRanking() {
  if (!localRankingEl) return;
  const ranked = scoreHistory.slice(0, SCORE_HISTORY_LIMIT).slice().sort((a, b) => b.score - a.score);
  localRankingEl.innerHTML = '';

  if (!ranked.length) {
    const li = document.createElement('li');
    li.textContent = 'まだ記録がありません';
    localRankingEl.appendChild(li);
    return;
  }

  for (const item of ranked) {
    const li = document.createElement('li');
    const scoreSpan = document.createElement('span');
    scoreSpan.className = 'rank-score';
    scoreSpan.textContent = item.score.toLocaleString('ja-JP');

    const metaSpan = document.createElement('span');
    metaSpan.className = 'rank-meta';
    metaSpan.textContent = formatRankMeta(item.at);

    li.appendChild(scoreSpan);
    li.appendChild(metaSpan);
    localRankingEl.appendChild(li);
  }
}

function createFruitBody(type, x, y) {
  const r = FRUITS[type].radius;
  const body = Bodies.circle(x, y, r, {
    restitution: 0.02,
    friction: 0.08,
    frictionStatic: 0.22,
    frictionAir: 0.006,
    density: 0.0015,
    label: 'fruit'
  });

  body.plugin = body.plugin || {};
  body.plugin.suika = {
    type,
    r,
    merging: false,
    aboveLineMs: 0
  };

  fruitById.set(body.id, body);
  return body;
}

function removeFruitBody(body) {
  if (!body) return;
  fruitById.delete(body.id);
  World.remove(engine.world, body);
}

function resetGame() {
  score = 0;
  gameOver = false;
  accumulatorMs = 0;
  scoreRecorded = false;

  setupWorld();

  tiltTargetX = 0;
  tiltLockUntil = performance.now() + 250;

  heldType = randomBaseFruit();
  nextType = randomBaseFruit();
  spawnX = WIDTH / 2;
  heldFruit = { type: heldType, x: spawnX, y: bounds.topLine - 44, r: FRUITS[heldType].radius };

  lastPreviewHeld = null;
  lastPreviewNext = null;
  lastTime = performance.now();
}

function handleInputPosition(evt) {
  setSpawnXFromClientPoint(evt.clientX);
}

function canDropHere(candidate) {
  for (const body of fruitById.values()) {
    const info = body.plugin?.suika;
    if (!info) continue;
    const dx = body.position.x - candidate.x;
    const dy = body.position.y - candidate.y;
    const distSq = dx * dx + dy * dy;
    const minDist = info.r + candidate.r + 6;
    if (distSq < minDist * minDist) return false;
  }
  return true;
}

function dropFruit() {
  if (gameOver || !heldFruit) return;
  if (!canDropHere(heldFruit)) return;

  const body = createFruitBody(heldFruit.type, heldFruit.x, heldFruit.y);
  World.add(engine.world, body);

  if (tiltEnabled) {
    tiltLockUntil = performance.now() + TILT_LOCK_MS_AFTER_DROP;
  }

  heldType = nextType;
  nextType = randomBaseFruit();
  heldFruit = { type: heldType, x: spawnX, y: bounds.topLine - 44, r: FRUITS[heldType].radius };
}

function processMerges() {
  if (!pendingMerges.length) return;

  const merges = pendingMerges;
  pendingMerges = [];

  for (const [idA, idB, type] of merges) {
    const a = fruitById.get(idA);
    const b = fruitById.get(idB);
    if (!a || !b) continue;
    if (!a.plugin?.suika || !b.plugin?.suika) continue;
    if (a.plugin.suika.type !== type || b.plugin.suika.type !== type) continue;

    const next = type + 1;
    if (!FRUITS[next]) {
      // Final merge: when two watermelons meet, award points and remove them.
      const lastType = FRUITS.length - 1;
      if (type === lastType) {
        removeFruitBody(a);
        removeFruitBody(b);
        score += FRUITS[type].score;
        continue;
      }

      a.plugin.suika.merging = false;
      b.plugin.suika.merging = false;
      continue;
    }

    const mx = (a.position.x + b.position.x) / 2;
    const my = (a.position.y + b.position.y) / 2;
    const mvx = (a.velocity.x + b.velocity.x) / 2;
    const mvy = (a.velocity.y + b.velocity.y) / 2;

    removeFruitBody(a);
    removeFruitBody(b);

    const merged = createFruitBody(next, mx, my);
    World.add(engine.world, merged);
    Body.setVelocity(merged, { x: mvx, y: mvy });

    score += FRUITS[next].score;
  }
}

function findMerges() {
  const bodies = Array.from(fruitById.values());
  const used = new Set();
  const merges = [];

  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    const ia = a.plugin?.suika;
    if (!ia) continue;
    if (ia.merging) continue;
    if (used.has(a.id)) continue;

    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j];
      const ib = b.plugin?.suika;
      if (!ib) continue;
      if (ib.merging) continue;
      if (used.has(b.id)) continue;
      if (ib.type !== ia.type) continue;

      const dx = b.position.x - a.position.x;
      const dy = b.position.y - a.position.y;
      const target = ia.r + ib.r + MERGE_DISTANCE_EPS;
      if ((dx * dx + dy * dy) > target * target) continue;

      ia.merging = true;
      ib.merging = true;
      used.add(a.id);
      used.add(b.id);
      merges.push([a.id, b.id, ia.type]);
      break;
    }
  }

  if (merges.length) pendingMerges.push(...merges);
}

function mergeFromRecentContacts(stepMs) {
  if (!recentContacts.size) return;

  for (const [key, ttl] of recentContacts.entries()) {
    const nextTtl = ttl - stepMs;
    if (nextTtl <= 0) {
      recentContacts.delete(key);
      continue;
    }
    recentContacts.set(key, nextTtl);

    const [aIdStr, bIdStr] = key.split(':');
    const a = fruitById.get(Number(aIdStr));
    const b = fruitById.get(Number(bIdStr));
    if (!a || !b) {
      recentContacts.delete(key);
      continue;
    }

    const ia = a.plugin?.suika;
    const ib = b.plugin?.suika;
    if (!ia || !ib) {
      recentContacts.delete(key);
      continue;
    }
    if (ia.type !== ib.type) {
      recentContacts.delete(key);
      continue;
    }
    if (ia.merging || ib.merging) {
      recentContacts.delete(key);
      continue;
    }

    ia.merging = true;
    ib.merging = true;
    pendingMerges.push([a.id, b.id, ia.type]);
    recentContacts.delete(key);
  }
}

function updateGameOver(stepMs) {
  if (gameOver) return;

  for (const body of fruitById.values()) {
    const info = body.plugin?.suika;
    if (!info) continue;

    const above = (body.position.y - info.r) < bounds.topLine;
    if (!above) {
      info.aboveLineMs = 0;
      continue;
    }

    const settled = body.isSleeping;
    if (!settled) {
      info.aboveLineMs = 0;
      continue;
    }

    info.aboveLineMs += stepMs;
    if (info.aboveLineMs >= GAMEOVER_TIME) {
      gameOver = true;
      break;
    }
  }
}

function stepSimulation(stepMs) {
  if (gameOver) return;
  applyTiltGravity();
  Engine.update(engine, stepMs);
  // 1) collisionStart-derived contacts (handles very brief touches)
  // 2) distance-based scan (handles dense stacks / sleeping pairs)
  mergeFromRecentContacts(stepMs);
  findMerges();
  processMerges();
  updateGameOver(stepMs);
  if (gameOver) {
    recordScoreOnce();
    submitScoreOnline()
      .catch(e => setOnlineStatus(`投稿失敗: ${String(e.message || e)}`))
      .finally(() => refreshOnlineRanking());
  }
}

function draw() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);

  // Bucket fill
  ctx.save();
  ctx.fillStyle = '#0ea5e9';
  ctx.globalAlpha = 0.07;
  ctx.fillRect(bounds.left, bounds.topLine, bounds.right - bounds.left, bounds.floor - bounds.topLine);
  ctx.restore();

  // Bucket outline
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(bounds.left, bounds.topLine);
  ctx.lineTo(bounds.left, bounds.floor);
  ctx.lineTo(bounds.right, bounds.floor);
  ctx.lineTo(bounds.right, bounds.topLine);
  ctx.stroke();

  // Top line
  ctx.strokeStyle = '#ec4899';
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 6]);
  ctx.beginPath();
  ctx.moveTo(bounds.left - 8, bounds.topLine);
  ctx.lineTo(bounds.right + 8, bounds.topLine);
  ctx.stroke();
  ctx.setLineDash([]);

  for (const body of fruitById.values()) {
    const info = body.plugin?.suika;
    if (!info) continue;
    drawFruitVisual(ctx, body.position.x, body.position.y, info.r, info.type, { ghost: false });
  }

  if (heldFruit && !gameOver) {
    drawFruitVisual(ctx, heldFruit.x, heldFruit.y, heldFruit.r, heldFruit.type, { ghost: true });
  }

  if (gameOver) {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = '24px Manrope, sans-serif';
    ctx.fillText('ゲームオーバー', WIDTH / 2, HEIGHT / 2 - 12);
    ctx.font = '16px Manrope, sans-serif';
    ctx.fillText('リスタートを押して再挑戦', WIDTH / 2, HEIGHT / 2 + 16);
  }
}

function loop(timestamp) {
  const dtMs = Math.min(timestamp - lastTime, 1000 / 30);
  lastTime = timestamp;

  accumulatorMs = Math.min(accumulatorMs + dtMs, MAX_ACCUMULATED_MS);
  while (accumulatorMs >= FIXED_STEP_MS) {
    stepSimulation(FIXED_STEP_MS);
    accumulatorMs -= FIXED_STEP_MS;
  }

  draw();
  updateUI();
  requestAnimationFrame(loop);
}

function drawPreview(previewCtx, type) {
  const w = previewCtx.canvas.width;
  const h = previewCtx.canvas.height;
  previewCtx.clearRect(0, 0, w, h);
  const radius = Math.min(w, h) * 0.33;
  drawFruitVisual(previewCtx, w / 2, h / 2 + 2, radius, type, { ghost: false });
}

function updateUI() {
  scoreEl.textContent = score.toLocaleString('ja-JP');

  if (versionEl && !versionEl.textContent) {
    versionEl.textContent = `v${VERSION}`;
  }

  if (lastPreviewHeld !== heldType) {
    currentPreviewCanvas.title = FRUITS[heldType]?.name ?? '';
    drawPreview(previewCtxCurrent, heldType);
    lastPreviewHeld = heldType;
  }

  if (lastPreviewNext !== nextType) {
    nextPreviewCanvas.title = FRUITS[nextType]?.name ?? '';
    drawPreview(previewCtxNext, nextType);
    lastPreviewNext = nextType;
  }
}

function drawFruitVisual(context, x, y, radius, type, { ghost = false } = {}) {
  const { color, accent } = FRUITS[type];
  const alpha = ghost ? 0.45 : 1;

  context.save();
  context.translate(x, y);
  context.globalAlpha = alpha;

  const gradient = context.createRadialGradient(-radius / 3, -radius / 3, radius / 6, 0, 0, radius);
  gradient.addColorStop(0, accent);
  gradient.addColorStop(1, color);

  context.fillStyle = gradient;
  context.beginPath();
  context.arc(0, 0, radius, 0, Math.PI * 2);
  context.fill();

  context.save();
  context.beginPath();
  context.arc(0, 0, radius, 0, Math.PI * 2);
  context.clip();
  drawPatternByType(context, type, radius, ghost);
  context.restore();

  context.globalAlpha = ghost ? alpha * 0.5 : 0.7;
  context.fillStyle = '#fff';
  context.beginPath();
  context.ellipse(-radius / 3, -radius / 3, radius / 3, radius / 4, Math.PI / 6, 0, Math.PI * 2);
  context.fill();

  context.globalAlpha = ghost ? alpha : 1;
  context.strokeStyle = 'rgba(15, 23, 42, 0.25)';
  context.lineWidth = ghost ? 1 : 2;
  context.stroke();

  context.restore();
}

function drawPatternByType(context, type, radius, ghost) {
  if (ghost) return;

  context.save();
  context.globalAlpha *= 0.55;

  switch (type) {
    case 0: { // cherry
      context.globalAlpha *= 0.9;
      context.strokeStyle = 'rgba(15, 23, 42, 0.35)';
      context.lineWidth = Math.max(2, radius * 0.12);
      context.beginPath();
      context.moveTo(-radius * 0.1, -radius * 0.85);
      context.quadraticCurveTo(-radius * 0.25, -radius * 0.55, -radius * 0.2, -radius * 0.2);
      context.stroke();
      context.fillStyle = 'rgba(34, 197, 94, 0.65)';
      context.beginPath();
      context.ellipse(radius * 0.25, -radius * 0.75, radius * 0.22, radius * 0.14, -0.6, 0, Math.PI * 2);
      context.fill();
      break;
    }
    case 1: { // strawberry seeds
      context.fillStyle = 'rgba(250, 204, 21, 0.75)';
      const seeds = 8;
      for (let i = 0; i < seeds; i++) {
        const angle = (i / seeds) * Math.PI * 2 + 0.4;
        const rr = radius * 0.55;
        const sx = Math.cos(angle) * rr;
        const sy = Math.sin(angle) * rr * 0.85;
        context.beginPath();
        context.ellipse(sx, sy, radius * 0.09, radius * 0.06, angle, 0, Math.PI * 2);
        context.fill();
      }
      context.fillStyle = 'rgba(34, 197, 94, 0.55)';
      context.beginPath();
      context.ellipse(0, -radius * 0.78, radius * 0.3, radius * 0.16, 0, 0, Math.PI * 2);
      context.fill();
      break;
    }
    case 2: { // grape speckles (deterministic)
      context.fillStyle = 'rgba(255, 255, 255, 0.18)';
      const goldenAngle = 2.399963229728653; // radians
      for (let i = 0; i < 18; i++) {
        const a = i * goldenAngle;
        const t = ((i % 9) + 1) / 10;
        const rr = t * radius * 0.9;
        context.beginPath();
        context.arc(Math.cos(a) * rr, Math.sin(a) * rr, radius * 0.07, 0, Math.PI * 2);
        context.fill();
      }
      break;
    }
    case 3: { // persimmon calyx
      context.fillStyle = 'rgba(34, 197, 94, 0.55)';
      context.beginPath();
      context.moveTo(0, -radius * 0.92);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        context.lineTo(Math.cos(a) * radius * 0.32, -radius * 0.6 + Math.sin(a) * radius * 0.22);
      }
      context.closePath();
      context.fill();
      break;
    }
    case 4: { // orange dimples
      context.fillStyle = 'rgba(15, 23, 42, 0.10)';
      const dots = 12;
      for (let i = 0; i < dots; i++) {
        const angle = (i / dots) * Math.PI * 2;
        const rr = radius * 0.55;
        context.beginPath();
        context.arc(Math.cos(angle) * rr, Math.sin(angle) * rr, radius * 0.07, 0, Math.PI * 2);
        context.fill();
      }
      break;
    }
    case 5: { // apple stem + leaf
      context.strokeStyle = 'rgba(15, 23, 42, 0.35)';
      context.lineWidth = Math.max(2, radius * 0.1);
      context.beginPath();
      context.moveTo(0, -radius * 0.88);
      context.quadraticCurveTo(radius * 0.08, -radius * 0.65, 0, -radius * 0.5);
      context.stroke();
      context.fillStyle = 'rgba(34, 197, 94, 0.6)';
      context.beginPath();
      context.ellipse(radius * 0.25, -radius * 0.74, radius * 0.24, radius * 0.14, -0.5, 0, Math.PI * 2);
      context.fill();
      break;
    }
    case 6: { // pear stripe
      context.strokeStyle = 'rgba(15, 23, 42, 0.10)';
      context.lineWidth = Math.max(2, radius * 0.08);
      context.beginPath();
      context.moveTo(-radius * 0.4, -radius * 0.2);
      context.quadraticCurveTo(0, radius * 0.45, radius * 0.45, radius * 0.2);
      context.stroke();
      break;
    }
    case 7: { // peach split line
      context.strokeStyle = 'rgba(15, 23, 42, 0.14)';
      context.lineWidth = Math.max(2, radius * 0.07);
      context.beginPath();
      context.moveTo(0, -radius * 0.9);
      context.quadraticCurveTo(-radius * 0.15, -radius * 0.2, 0, radius * 0.75);
      context.stroke();
      break;
    }
    case 8: { // watermelon stripes + rind ring
      context.strokeStyle = 'rgba(6, 95, 70, 0.38)';
      context.lineWidth = Math.max(2, radius * 0.09);
      const stripes = 7;
      for (let i = 0; i < stripes; i++) {
        const t = (i / (stripes - 1)) * 2 - 1;
        const x = t * radius * 0.75;
        context.beginPath();
        context.ellipse(x, 0, radius * 0.12, radius * 0.9, 0, 0, Math.PI * 2);
        context.stroke();
      }
      context.strokeStyle = 'rgba(187, 247, 208, 0.8)';
      context.lineWidth = Math.max(2, radius * 0.08);
      context.beginPath();
      context.arc(0, 0, radius * 0.92, 0, Math.PI * 2);
      context.stroke();
      break;
    }
    default:
      break;
  }

  context.restore();
}

function clampSigned(value, maxAbs) {
  return Math.max(-maxAbs, Math.min(maxAbs, value));
}

function applyDeadzone(value, deadzone) {
  const abs = Math.abs(value);
  if (abs <= deadzone) return 0;
  return Math.sign(value) * (abs - deadzone);
}

function getScreenOrientationAngle() {
  const angle = window.screen?.orientation?.angle;
  if (typeof angle === 'number') return angle;
  const legacy = window.orientation;
  if (typeof legacy === 'number') return legacy;
  return 0;
}

function onDeviceOrientation(evt) {
  if (!tiltEnabled) return;

  const beta = typeof evt.beta === 'number' ? evt.beta : 0; // front-back
  const gamma = typeof evt.gamma === 'number' ? evt.gamma : 0; // left-right

  const angle = getScreenOrientationAngle();
  let screenX = gamma;
  let screenY = beta;
  if (angle === 90) {
    screenX = -beta;
    screenY = gamma;
  } else if (angle === -90 || angle === 270) {
    screenX = beta;
    screenY = -gamma;
  } else if (angle === 180) {
    screenX = -gamma;
    screenY = -beta;
  }

  tiltLastScreenX = screenX;
  tiltLastScreenY = screenY;

  if (!tiltHasCalibration) {
    tiltNeutralScreenX = screenX;
    tiltNeutralScreenY = screenY;
    tiltHasCalibration = true;
    setTiltStatus('有効（基準セット）');
  }

  const dx = applyDeadzone(screenX - tiltNeutralScreenX, TILT_DEADZONE_DEG);

  const nx = clampSigned(dx / TILT_MAX_DEG, 1);

  tiltTargetX = nx * TILT_MAX_GX;
}

function applyTiltGravity() {
  if (!engine) return;
  if (!tiltEnabled) {
    engine.gravity.x = 0;
    engine.gravity.y = BASE_GRAVITY_Y;
    return;
  }

  const now = performance.now();
  const locked = now < tiltLockUntil;
  const targetX = locked ? 0 : (tiltHasCalibration ? tiltTargetX : 0);

  const currentX = engine.gravity.x || 0;
  const nextX = currentX + (targetX - currentX) * TILT_SMOOTHING;

  engine.gravity.x = nextX;
  engine.gravity.y = BASE_GRAVITY_Y;

  const delta = Math.abs(nextX - lastAppliedGX);
  if (delta > TILT_WAKE_THRESHOLD) {
    for (const body of fruitById.values()) {
      if (body.isSleeping) Sleeping.set(body, false);
    }
    lastAppliedGX = nextX;
    lastAppliedGY = BASE_GRAVITY_Y;
  }
}

function setTiltStatus(text) {
  if (!tiltStatusEl) return;
  tiltStatusEl.textContent = text;
}

function setupTiltUI() {
  if (!tiltEnableBtn) return;

  const supported = typeof window.DeviceOrientationEvent !== 'undefined';
  if (!supported) {
    tiltEnableBtn.style.display = 'none';
    setTiltStatus('傾きセンサー未対応');
    return;
  }

  function updateTiltButton() {
    tiltEnableBtn.textContent = tiltEnabled ? '傾き操作を無効化' : '傾き操作を有効化';
    if (tiltCalibrateBtn) {
      tiltCalibrateBtn.disabled = !tiltEnabled;
    }
  }

  function disableTilt() {
    tiltEnabled = false;
    tiltTargetX = 0;
    tiltLockUntil = performance.now() + 200;
    tiltHasCalibration = false;
    if (engine) {
      engine.gravity.x = 0;
      engine.gravity.y = BASE_GRAVITY_Y;
    }
    if (tiltListenerAttached) {
      window.removeEventListener('deviceorientation', onDeviceOrientation);
      tiltListenerAttached = false;
    }
    setTiltStatus('無効');
    updateTiltButton();
  }

  if (tiltCalibrateBtn) {
    tiltCalibrateBtn.addEventListener('click', () => {
      if (!tiltEnabled || !tiltHasCalibration) {
        setTiltStatus('有効化してから基準をセットしてください');
        return;
      }
      tiltNeutralScreenX = tiltLastScreenX;
      tiltNeutralScreenY = tiltLastScreenY;
      tiltLockUntil = performance.now() + 200;
      setTiltStatus('有効（基準リセット）');
    });
  }

  tiltEnableBtn.addEventListener('click', async () => {
    if (tiltEnabled) {
      disableTilt();
      return;
    }

    try {
      const DO = window.DeviceOrientationEvent;
      if (typeof DO.requestPermission === 'function') {
        setTiltStatus('許可をリクエスト中…');
        const result = await DO.requestPermission();
        if (result !== 'granted') {
          setTiltStatus('許可されませんでした');
          disableTilt();
          return;
        }
      }

      if (!tiltListenerAttached) {
        window.addEventListener('deviceorientation', onDeviceOrientation, { passive: true });
        tiltListenerAttached = true;
      }

      tiltEnabled = true;
      tiltHasCalibration = false;
      tiltLockUntil = performance.now() + 250;
      setTiltStatus('有効化中…（端末を持ちやすい角度で固定してください）');
      updateTiltButton();
    } catch (e) {
      setTiltStatus('有効化に失敗');
      console.error(e);
      disableTilt();
    }
  });

  setTiltStatus('無効');
  updateTiltButton();
}

canvas.addEventListener('mousemove', handleInputPosition);

// Touch UX: drag (swipe) to aim, and drop on finger release.
canvas.addEventListener('touchstart', evt => {
  if (!evt.touches.length) return;
  touchActive = true;
  setSpawnXFromClientPoint(evt.touches[0].clientX);
  evt.preventDefault();
}, { passive: false });

canvas.addEventListener('touchmove', evt => {
  if (!touchActive || !evt.touches.length) return;
  setSpawnXFromClientPoint(evt.touches[0].clientX);
  evt.preventDefault();
}, { passive: false });

canvas.addEventListener('touchend', evt => {
  if (!touchActive) return;
  touchActive = false;
  suppressClickUntil = performance.now() + 500;
  evt.preventDefault();
  dropFruit();
}, { passive: false });

canvas.addEventListener('touchcancel', () => {
  touchActive = false;
}, { passive: true });

canvas.addEventListener('click', () => {
  if (performance.now() < suppressClickUntil) return;
  dropFruit();
});
document.addEventListener('keydown', evt => {
  if (evt.code === 'Space') {
    evt.preventDefault();
    dropFruit();
  } else if (evt.code === 'KeyR') {
    resetGame();
  }
});

restartBtn.addEventListener('click', resetGame);

resetGame();
setupTiltUI();
scoreHistory = loadScoreHistory();
renderLocalRanking();

if (nicknameEl) {
  nicknameEl.value = getNickname();
  nicknameEl.addEventListener('change', () => {
    setNickname(nicknameEl.value);
    nicknameEl.value = getNickname();
  });
}

if (rankingRefreshBtn) {
  rankingRefreshBtn.addEventListener('click', () => refreshOnlineRanking());
}

refreshOnlineRanking();
requestAnimationFrame(loop);
