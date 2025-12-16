const Matter = window.Matter;
if (!Matter) {
  throw new Error('Matter.js failed to load. Check that vendor/matter.min.js is served correctly.');
}

const { Engine, World, Bodies, Body, Events } = Matter;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const scoreEl = document.getElementById('score');
const currentPreviewCanvas = document.getElementById('current-preview');
const nextPreviewCanvas = document.getElementById('next-preview');
const restartBtn = document.getElementById('restart');

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

function randomBaseFruit() {
  return basePool[Math.floor(Math.random() * basePool.length)];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function setupWorld() {
  engine = Engine.create({
    positionIterations: 10,
    velocityIterations: 8,
    constraintIterations: 2
  });
  engine.enableSleeping = true;
  engine.gravity.y = 1.25;
  engine.gravity.scale = 0.001;

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
      if (ia.type >= FRUITS.length - 1) continue;
      if (ia.merging || ib.merging) continue;

      const lo = Math.min(a.id, b.id);
      const hi = Math.max(a.id, b.id);
      recentContacts.set(`${lo}:${hi}`, CONTACT_MERGE_TTL_MS);
    }
  });
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

  setupWorld();

  heldType = randomBaseFruit();
  nextType = randomBaseFruit();
  spawnX = WIDTH / 2;
  heldFruit = { type: heldType, x: spawnX, y: bounds.topLine - 44, r: FRUITS[heldType].radius };

  lastPreviewHeld = null;
  lastPreviewNext = null;
  lastTime = performance.now();
}

function handleInputPosition(evt) {
  const rect = canvas.getBoundingClientRect();
  const x = (evt.clientX - rect.left) * (WIDTH / rect.width);
  spawnX = clamp(x, bounds.left + 16, bounds.right - 16);
  if (heldFruit) heldFruit.x = spawnX;
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
    if (ia.type >= FRUITS.length - 1) continue;

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
    if (ia.type !== ib.type || ia.type >= FRUITS.length - 1) {
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
  Engine.update(engine, stepMs);
  // 1) collisionStart-derived contacts (handles very brief touches)
  // 2) distance-based scan (handles dense stacks / sleeping pairs)
  mergeFromRecentContacts(stepMs);
  findMerges();
  processMerges();
  updateGameOver(stepMs);
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

canvas.addEventListener('mousemove', handleInputPosition);
canvas.addEventListener('touchmove', evt => {
  if (evt.touches.length) handleInputPosition(evt.touches[0]);
}, { passive: true });

canvas.addEventListener('click', dropFruit);
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
requestAnimationFrame(loop);
