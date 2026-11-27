const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

// Fonte de título do site (Lilita One), usada no painel de status
GlobalFonts.registerFromPath(path.join(__dirname, '..', '..', 'assets', 'fonts', 'LilitaOne-Regular.ttf'), 'Lilita One');
const { MOVES_PER_TURN } = require('./config');
const { DIRECTIONS, formatCoord } = require('./grid');
const { currentPlayer, checkStep } = require('./battle');

// Medidas lógicas das imagens, convertidas para pixels reais por SCALE. O mapa e o painel são
// duas imagens separadas, largas e baixas, com o tamanho da referência (~568 px de largura):
// o Discord mostra imagens desse tamanho sem redimensionar.
const SCALE = 568 / 720; // as imagens saem com ~568 px de largura: o Discord as exibe nesse tamanho exato
const px = v => Math.round(v * SCALE); // tamanho lógico -> pixels da imagem
const W = 720; // largura lógica fixa: com mais jogadores o mapa ganha mais casas, e elas ficam menores
const CELL_ASPECT = 1; // altura / largura de cada casa (1 = casas quadradas)

const PLAYER_COLORS = ['#3b8fe0', '#e0453b', '#3fb950', '#e3b341', '#a371f7', '#f778ba', '#39c5cf', '#ff9248'];
const FONT = 'Georgia, "Times New Roman", serif';

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Geometria do mapa de uma batalha: o número de casas vem da batalha, a largura da imagem é fixa
function layoutOf(battle) {
  const { cols, rows } = battle;
  const cellW = W / cols;
  const cellH = cellW * CELL_ASPECT;
  return { cols, rows, cellW, cellH, mapW: W, mapH: rows * cellH };
}

const cellOrigin = (L, { col, row }) => ({ x: col * L.cellW, y: row * L.cellH });
const cellCenter = (L, pos) => {
  const o = cellOrigin(L, pos);
  return { x: o.x + L.cellW / 2, y: o.y + L.cellH / 2 };
};

// Terreno gerado proceduralmente (sempre igual) + grade, com ou sem a coordenada em cada casa.
// Cada combinação de tamanho/coordenadas é desenhada uma vez só.
const backgroundCache = new Map();
function background(L, withLabels) {
  const key = `${L.cols}x${L.rows}:${withLabels}`;
  if (backgroundCache.has(key)) return backgroundCache.get(key);

  const canvas = createCanvas(px(L.mapW), px(L.mapH));
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);
  const rng = mulberry32(7);

  for (let r = 0; r < L.rows; r++) {
    for (let c = 0; c < L.cols; c++) {
      const o = cellOrigin(L, { col: c, row: r });
      ctx.fillStyle = `hsl(${92 + rng() * 22}, ${34 + rng() * 12}%, ${26 + rng() * 9}%)`;
      ctx.fillRect(o.x, o.y, L.cellW + 1, L.cellH + 1);
    }
  }
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = rng() < 0.5 ? 'rgba(15,45,12,0.28)' : 'rgba(150,200,95,0.18)';
    ctx.fillRect(rng() * L.mapW, rng() * L.mapH, 2 + rng() * 4, 1 + rng() * 2);
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1;
  for (let c = 0; c <= L.cols; c++) {
    ctx.beginPath(); ctx.moveTo(c * L.cellW, 0); ctx.lineTo(c * L.cellW, L.mapH); ctx.stroke();
  }
  for (let r = 0; r <= L.rows; r++) {
    ctx.beginPath(); ctx.moveTo(0, r * L.cellH); ctx.lineTo(L.mapW, r * L.cellH); ctx.stroke();
  }

  if (withLabels) {
    for (let r = 0; r < L.rows; r++) {
      for (let c = 0; c < L.cols; c++) drawCoordLabel(ctx, L, { col: c, row: r });
    }
  }

  backgroundCache.set(key, canvas);
  return canvas;
}

// Coordenada da casa (ex: C3) no canto superior direito; a letra encolhe junto com a casa
function drawCoordLabel(ctx, L, pos) {
  const size = Math.max(9, Math.round(L.cellH * 0.29));
  ctx.save();
  ctx.font = `bold ${size}px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 3;
  ctx.fillText(formatCoord(pos), (pos.col + 1) * L.cellW - 4, pos.row * L.cellH + 3);
  ctx.restore();
}

async function loadAvatar(url) {
  try {
    const img = await loadImage(url);
    // Mesmo enquadramento do /perfil: lá o retrato é cortado no centro numa moldura de 304x372; aqui pegamos
    // esse mesmo trecho central e, dele, o quadrado do meio (o token é redondo e não pode esticar a imagem)
    const frame = 304 / 372;
    let w = img.width, h = img.height;
    if (w / h > frame) w = h * frame; else h = w / frame;
    const side = Math.min(w, h);
    const sx = (img.width - side) / 2, sy = (img.height - side) / 2;
    const canvas = createCanvas(Math.round(side), Math.round(side));
    canvas.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, canvas.width, canvas.height);
    return canvas;
  } catch {
    return null; // sem avatar: o token usa a inicial do nome
  }
}

function drawToken(ctx, L, player, index, active) {
  const { x, y } = cellCenter(L, player.pos);
  const R = Math.min(L.cellH, L.cellW) * 0.43; // o token ocupa quase a casa toda e encolhe junto com ela
  const color = PLAYER_COLORS[index % PLAYER_COLORS.length];

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(x + 2, y + R - 2, R * 0.9, R * 0.3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  if (active) {
    ctx.save();
    ctx.shadowColor = '#ffd84a';
    ctx.shadowBlur = 12;
    ctx.strokeStyle = '#ffd84a';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, R + 3, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.clip();
  if (player.avatar) {
    ctx.drawImage(player.avatar, x - R, y - R, R * 2, R * 2);
  } else {
    ctx.fillStyle = '#3a3a44';
    ctx.fillRect(x - R, y - R, R * 2, R * 2);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(R * 1.2)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(player.name.charAt(0).toUpperCase(), x, y + 1);
  }
  ctx.restore();

  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.stroke();
}

// Carneiro de algodão (Ovelha Dorminhoca): ocupa as N×N casas da invocação. Lã em tufos, cara escura e chifres enrolados,
// com o anel tracejado na cor do time do dono
function drawSheep(ctx, L, summon, index) {
  const n = summon.size ?? 1;
  const x = summon.pos.col * L.cellW + (L.cellW * n) / 2;
  const y = summon.pos.row * L.cellH + (L.cellH * n) / 2;
  const R = Math.min(L.cellH, L.cellW) * n * 0.44;
  const color = PLAYER_COLORS[index % PLAYER_COLORS.length];

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(x + 3, y + R * 0.8, R * 0.95, R * 0.28, 0, 0, Math.PI * 2); ctx.fill();

  // Lã: um anel de tufos em volta de um miolo, tudo branco-creme
  ctx.fillStyle = '#f4efe6';
  ctx.strokeStyle = '#cfc6b6';
  ctx.lineWidth = 2;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath(); ctx.arc(x + Math.cos(a) * R * 0.7, y + Math.sin(a) * R * 0.62, R * 0.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  ctx.beginPath(); ctx.ellipse(x, y, R * 0.78, R * 0.7, 0, 0, Math.PI * 2); ctx.fill();

  // Cara e chifres
  const hy = y - R * 0.05;
  ctx.fillStyle = '#4a3b33';
  ctx.beginPath(); ctx.ellipse(x, hy, R * 0.28, R * 0.36, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#d9b77a';
  ctx.lineWidth = Math.max(3, R * 0.09);
  for (const side of [-1, 1]) { // o mesmo chifre enrolado, espelhado de cada lado da cara
    ctx.save();
    ctx.translate(x, hy);
    ctx.scale(side, 1);
    ctx.beginPath(); ctx.arc(R * 0.36, -R * 0.12, R * 0.16, Math.PI * 1.1, Math.PI * 2.6); ctx.stroke();
    ctx.restore();
  }
  // Olhos fechados (dorminhoca)
  ctx.strokeStyle = '#f4efe6';
  ctx.lineWidth = Math.max(2, R * 0.04);
  for (const side of [-1, 1]) {
    ctx.beginPath(); ctx.arc(x + side * R * 0.11, hy - R * 0.02, R * 0.06, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.setLineDash([6, 5]);
  ctx.beginPath(); ctx.arc(x, y, R * 1.02, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

// Ícones próprios das invocações (assets/summons): carregados uma vez e cortados num quadrado, com o rosto mais para cima
const SUMMON_DIR = path.join(__dirname, '..', '..', 'assets', 'summons');
const summonIcons = new Map(); // nome do arquivo -> Promise<canvas | null>
function loadSummonIcon(file) {
  if (!summonIcons.has(file)) {
    summonIcons.set(file, loadImage(path.join(SUMMON_DIR, file)).then(img => {
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) * 0.2; // retrato: puxa o corte para cima, onde fica a cabeça
      const c = createCanvas(Math.round(side), Math.round(side));
      c.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, c.width, c.height);
      return c;
    }).catch(() => null)); // sem o arquivo: cai no desenho padrão
  }
  return summonIcons.get(file);
}

// Invocação com ícone próprio: a imagem num círculo que cobre as N×N casas dela, com o anel tracejado na cor do time
function drawIconSummon(ctx, L, summon, icon, index) {
  const n = summon.size ?? 1;
  const x = summon.pos.col * L.cellW + (L.cellW * n) / 2;
  const y = summon.pos.row * L.cellH + (L.cellH * n) / 2;
  const R = Math.min(L.cellH, L.cellW) * n * (n > 1 ? 0.45 : 0.4);
  const color = PLAYER_COLORS[index % PLAYER_COLORS.length];

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(x + 2, y + R - 2, R * 0.9, R * 0.3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.clip();
  ctx.drawImage(icon, x - R, y - R, R * 2, R * 2);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

// Duplicata Real: um clone do dono, então usa o mesmo ícone dele, sem escurecer (só o anel tracejado mostra que é invocação)
function drawMirrorClone(ctx, L, summon, owner, index) {
  const { x, y } = cellCenter(L, summon.pos);
  const R = Math.min(L.cellH, L.cellW) * 0.4;
  const color = PLAYER_COLORS[index % PLAYER_COLORS.length];

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(x + 2, y + R - 2, R * 0.9, R * 0.3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.clip();
  if (owner?.avatar) {
    ctx.drawImage(owner.avatar, x - R, y - R, R * 2, R * 2);
  } else {
    ctx.fillStyle = '#3a3a44';
    ctx.fillRect(x - R, y - R, R * 2, R * 2);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(R * 1.2)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((owner?.name ?? '?').charAt(0).toUpperCase(), x, y + 1);
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

// Barra de vida embaixo da invocação (verde, amarela ou vermelha conforme o que sobrou), da largura das casas dela,
// com a vida atual escrita por cima
function drawSummonHp(ctx, L, summon) {
  if (!summon.maxHp) return;
  const n = summon.size ?? 1;
  const w = L.cellW * n * (n > 1 ? 0.6 : 0.86);
  const h = Math.max(11, L.cellH * 0.2);
  const x = summon.pos.col * L.cellW + (L.cellW * n - w) / 2;
  const y = (summon.pos.row + n) * L.cellH - h - 2;
  const frac = Math.max(0, summon.hp / summon.maxHp);
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = frac > 0.5 ? '#3fae4c' : frac > 0.25 ? '#c9a22c' : '#c43a31';
  ctx.fillRect(x, y, w * frac, h);
  ctx.font = `bold ${Math.round(h * 0.85)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.fillStyle = '#fff';
  const label = n > 1 ? `${summon.hp}/${summon.maxHp}` : `${summon.hp}`; // casa pequena: só a vida atual, para caber
  ctx.strokeText(label, x + w / 2, y + h / 2 + 1);
  ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  ctx.restore();
}

// Clone invocado: o mesmo rosto do dono, escurecido e com anel tracejado na cor dele, para parecer outra figura no mapa
function drawSummon(ctx, L, summon, owner, index, icon) {
  if (icon) return drawIconSummon(ctx, L, summon, icon, index);
  if (summon.look === 'ovelha') return drawSheep(ctx, L, summon, index);
  if (summon.look === 'espelho') return drawMirrorClone(ctx, L, summon, owner, index);
  const { x, y } = cellCenter(L, summon.pos);
  const R = Math.min(L.cellH, L.cellW) * 0.38;
  const color = PLAYER_COLORS[index % PLAYER_COLORS.length];

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(x + 2, y + R - 2, R * 0.9, R * 0.3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.clip();
  if (owner?.avatar) {
    ctx.drawImage(owner.avatar, x - R, y - R, R * 2, R * 2);
  } else {
    ctx.fillStyle = '#3a3a44';
    ctx.fillRect(x - R, y - R, R * 2, R * 2);
  }
  ctx.fillStyle = 'rgba(20,0,0,0.55)'; // escurece: é uma sombra, não a pessoa
  ctx.fillRect(x - R, y - R, R * 2, R * 2);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  while (text.length > 1 && ctx.measureText(text + '…').width > maxWidth) text = text.slice(0, -1);
  return text + '…';
}

// ---------- Painel de status: mesmo visual do site (pergaminho, contorno de tinta, sombra dura, faixa vermelha) ----------
const INK = '#17121c';
const PARCH = '#f4e7c9';
const PAPER = '#fffaf0';
const GOLD = '#f2b632';
const RED = '#c8342c';
const DISPLAY = `"Lilita One", ${FONT}`;

function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Caixa "cartoon": sombra dura deslocada, preenchimento e contorno grosso de tinta
function inkBox(ctx, x, y, w, h, { r = 12, fill = PAPER, shadow = 5, line = 3 } = {}) {
  if (shadow) {
    ctx.fillStyle = INK;
    roundRectPath(ctx, x + shadow, y + shadow, w, h, r); ctx.fill();
  }
  ctx.fillStyle = fill;
  roundRectPath(ctx, x, y, w, h, r); ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = line;
  ctx.stroke();
}

// Texto com contorno de tinta (estilo título de jogo); width 0 = sem contorno
function inkText(ctx, text, x, y, { size = 22, fill = PAPER, stroke = INK, width = 5, align = 'left' } = {}) {
  ctx.save();
  ctx.font = `${size}px ${DISPLAY}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  if (width) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.strokeText(text, x, y); }
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  ctx.restore();
}

// Ícones das barras (coração, gota, raio), desenhados em vetor num círculo de raio ~r
function iconPath(ctx, kind, cx, cy, r) {
  const s = r * 0.95;
  ctx.beginPath();
  if (kind === 'hp') {
    ctx.moveTo(cx, cy + s * 0.75);
    ctx.bezierCurveTo(cx - s * 1.2, cy - s * 0.05, cx - s * 0.6, cy - s * 0.95, cx, cy - s * 0.35);
    ctx.bezierCurveTo(cx + s * 0.6, cy - s * 0.95, cx + s * 1.2, cy - s * 0.05, cx, cy + s * 0.75);
  } else if (kind === 'mana') {
    ctx.moveTo(cx, cy - s);
    ctx.bezierCurveTo(cx + s * 0.2, cy - s * 0.5, cx + s * 0.7, cy - s * 0.05, cx + s * 0.62, cy + s * 0.35);
    ctx.arc(cx, cy + s * 0.3, s * 0.62, 0.05, Math.PI - 0.05);
    ctx.bezierCurveTo(cx - s * 0.7, cy - s * 0.05, cx - s * 0.2, cy - s * 0.5, cx, cy - s);
  } else {
    const pts = [[0.25, -1], [-0.55, 0.12], [-0.02, 0.12], [-0.25, 1], [0.55, -0.18], [0.02, -0.18]];
    pts.forEach(([a, b], i) => {
      if (i) ctx.lineTo(cx + a * s, cy + b * s); else ctx.moveTo(cx + a * s, cy + b * s);
    });
  }
  ctx.closePath();
}

const BAR_STYLE = {
  hp: { light: '#6fdc5a', dark: '#2c8a2a', badge: '#e04b3f' },
  mana: { light: '#5fb6f5', dark: '#1f5fae', badge: '#2f7fd6' },
  energy: { light: '#ffd25a', dark: '#e08a12', badge: '#f2b632' },
};

// Barra em pílula com o ícone num selo na ponta esquerda e o valor escrito por cima
function drawBar(ctx, kind, x, y, w, h, value, max) {
  const st = BAR_STYLE[kind];
  const r = h / 2;
  ctx.fillStyle = INK;
  roundRectPath(ctx, x + 3, y + 3, w, h, r); ctx.fill();
  ctx.fillStyle = '#3a3040';
  roundRectPath(ctx, x, y, w, h, r); ctx.fill();

  const frac = Math.max(0, Math.min(1, value / max));
  if (frac > 0) {
    ctx.save();
    roundRectPath(ctx, x, y, w, h, r); ctx.clip();
    const fw = Math.max(h, w * frac);
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, st.light); g.addColorStop(1, st.dark);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, fw, h);
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; // brilho em cima
    ctx.fillRect(x, y + 3, fw, h * 0.22);
    ctx.restore();
  }
  roundRectPath(ctx, x, y, w, h, r);
  ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.stroke();

  // selo do ícone
  const br = h * 0.72, bx = x + 2, by = y + h / 2;
  ctx.fillStyle = INK;
  ctx.beginPath(); ctx.arc(bx + 2, by + 2, br, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = PAPER;
  ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.stroke();
  iconPath(ctx, kind, bx, by + (kind === 'mana' ? 1 : 0), br * 0.62);
  ctx.fillStyle = st.badge; ctx.fill();
  ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.stroke();

  inkText(ctx, `${value}/${max}`, x + (w + br) / 2, y + h / 2 + 1, { size: 18, width: 4, align: 'center' });
}

// Retrato redondo do jogador com o anel na cor do time
function drawPortrait(ctx, p, cx, cy, R) {
  ctx.fillStyle = INK;
  ctx.beginPath(); ctx.arc(cx + 3, cy + 3, R + 3, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
  if (p.avatar) ctx.drawImage(p.avatar, cx - R, cy - R, R * 2, R * 2);
  else {
    ctx.fillStyle = '#4a3f55'; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    inkText(ctx, p.name.charAt(0).toUpperCase(), cx, cy + 2, { size: Math.round(R * 1.1), align: 'center', width: 4 });
  }
  ctx.restore();
  ctx.strokeStyle = PLAYER_COLORS[p.team % PLAYER_COLORS.length];
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = INK; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(cx, cy, R + 3, 0, Math.PI * 2); ctx.stroke();
}

// Etiqueta pequena e levemente inclinada (ex: "SUA VEZ"), alinhada pela direita em x
function tag(ctx, text, x, y, fill, color = INK) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.05);
  ctx.font = `15px ${DISPLAY}`;
  const w = ctx.measureText(text).width + 18;
  inkBox(ctx, -w, -13, w, 26, { r: 6, fill, shadow: 3, line: 2.5 });
  ctx.font = `15px ${DISPLAY}`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, -w / 2, 1);
  ctx.restore();
}

// Ficha (chip) do rodapé: rótulo + valor num selo colorido; devolve a largura
function chip(ctx, x, y, { label, value, valueFill = GOLD }, measure = false) {
  ctx.font = `16px ${DISPLAY}`;
  const lw = ctx.measureText(label).width;
  const vw = value ? ctx.measureText(value).width : 0;
  const w = lw + (value ? vw + 30 : 0) + 24;
  if (measure) return w;
  inkBox(ctx, x, y, w, 32, { r: 16, fill: PAPER, shadow: 3, line: 2.5 });
  ctx.font = `16px ${DISPLAY}`;
  ctx.fillStyle = INK; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(label, x + 12, y + 17);
  if (value) {
    const vx = x + lw + 20;
    ctx.fillStyle = valueFill;
    roundRectPath(ctx, vx, y + 5, vw + 16, 22, 11); ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = INK;
    ctx.fillText(value, vx + 8, y + 17);
  }
  return w;
}

// Uma linha de fichas centralizada
function chipRow(ctx, y, items) {
  const gap = 12;
  const widths = items.map(it => chip(ctx, 0, 0, it, true));
  let x = (W - widths.reduce((a, b) => a + b, 0) - gap * (items.length - 1)) / 2;
  items.forEach((it, i) => { chip(ctx, x, y, it); x += widths[i] + gap; });
}

// Altura do painel: faixa de título + um cartão por jogador + rodapé do turno
const HEADER_H = 92;
const CARD_H = 82;
const CARD_GAP = 14;
const footerHeight = battle => (battle.over ? 10 : 56);
const panelHeight = battle => HEADER_H + battle.players.length * (CARD_H + CARD_GAP) + footerHeight(battle) + 8;

// Fundo de pergaminho com retícula de pontinhos e moldura de tinta
function drawPanelFrame(ctx, h) {
  ctx.fillStyle = PARCH;
  ctx.fillRect(0, 0, W, h);
  ctx.fillStyle = 'rgba(120,80,30,0.10)';
  for (let y = 6, row = 0; y < h; y += 12, row++) {
    for (let x = row % 2 ? 6 : 12; x < W; x += 12) {
      ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, W - 8, h - 8);
}

// Faixa vermelha do título, com pontas recortadas e sombra dura
function drawBanner(ctx, text) {
  const y = 20, h = 50, notch = 16;
  ctx.font = `30px ${DISPLAY}`;
  const w = Math.min(W - 60, ctx.measureText(text).width + 110);
  const x = (W - w) / 2;
  const shape = (dx, dy) => {
    ctx.beginPath();
    ctx.moveTo(x + dx, y + dy);
    ctx.lineTo(x + w + dx, y + dy);
    ctx.lineTo(x + w - notch + dx, y + h / 2 + dy);
    ctx.lineTo(x + w + dx, y + h + dy);
    ctx.lineTo(x + dx, y + h + dy);
    ctx.lineTo(x + notch + dx, y + h / 2 + dy);
    ctx.closePath();
  };
  ctx.fillStyle = INK; shape(5, 5); ctx.fill();
  ctx.fillStyle = RED; shape(0, 0); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.16)'; // brilho
  ctx.fillRect(x + notch, y + 4, w - notch * 2, 9);
  ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.lineJoin = 'round'; shape(0, 0); ctx.stroke();
  inkText(ctx, text, W / 2, y + h / 2 + 2, { size: 30, fill: GOLD, width: 6, align: 'center' });
}

// Painel de status: um cartão por jogador (retrato, nome e barras) e, no fim, o resumo do turno
function drawPanel(ctx, battle) {
  const panelH = panelHeight(battle);
  const placing = battle.phase === 'placement';
  const cur = battle.phase === 'combat' ? currentPlayer(battle) : null;

  drawPanelFrame(ctx, panelH);
  drawBanner(ctx, placing ? 'POSICIONAMENTO' : battle.over ? 'BATALHA ENCERRADA' : 'BATALHA EM CAMPO');

  const cardX = 24, cardW = W - 54;
  battle.players.forEach((p, i) => {
    const y = HEADER_H + i * (CARD_H + CARD_GAP);
    const isTurn = cur === p && !battle.over;
    const down = p.hp <= 0;

    ctx.save();
    if (down) ctx.globalAlpha = 0.5; // quem caiu fica apagado
    inkBox(ctx, cardX, y, cardW, CARD_H, { r: 14, fill: isTurn ? '#ffe39a' : PAPER, shadow: 5 });
    ctx.save(); // faixa lateral na cor do time
    roundRectPath(ctx, cardX, y, cardW, CARD_H, 14); ctx.clip();
    ctx.fillStyle = PLAYER_COLORS[p.team % PLAYER_COLORS.length];
    ctx.fillRect(cardX, y, 10, CARD_H);
    ctx.restore();
    roundRectPath(ctx, cardX, y, cardW, CARD_H, 14);
    ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.stroke();

    const R = 27;
    drawPortrait(ctx, p, cardX + 22 + R, y + CARD_H / 2, R);

    const left = cardX + 22 + R * 2 + 16;
    const right = cardX + cardW - 14;
    ctx.font = `23px ${DISPLAY}`;
    inkText(ctx, fitText(ctx, p.name, right - left - 150), left, y + 21, { size: 23, fill: INK, width: 0 });

    const barY = y + 42, barH = 26, gap = 16;
    const bx = left + 14; // espaço para o selo do ícone
    const barW = (right - bx - gap * 2) / 3;
    drawBar(ctx, 'hp', bx, barY, barW, barH, Math.max(0, p.hp), p.maxHp);
    drawBar(ctx, 'mana', bx + barW + gap, barY, barW, barH, p.mana, p.maxMana);
    drawBar(ctx, 'energy', bx + 2 * (barW + gap), barY, barW, barH, p.energy, p.maxEnergy);
    ctx.restore();

    if (isTurn) tag(ctx, 'SUA VEZ', right + 2, y + 18, RED, PAPER);
    else if (down) tag(ctx, 'FORA DE COMBATE', right + 2, y + 18, '#b9b4c0');
    else if (battle.over) tag(ctx, 'VITÓRIA', right + 2, y + 18, GOLD);
    else if (placing) tag(ctx, p.pos ? 'PRONTO' : 'AGUARDANDO', right + 2, y + 18, p.pos ? '#7ed36b' : PAPER);
  });

  if (battle.over) return;
  const footY = HEADER_H + battle.players.length * (CARD_H + CARD_GAP) + 4;
  if (placing) return chipRow(ctx, footY, [{ label: 'Escolham o setor inicial' }]);
  const t = battle.turn;
  const free = '#7ed36b', used = '#c9c3cf';
  if (t.phase === 'move') {
    chipRow(ctx, footY, [
      { label: 'Fase', value: 'MOVIMENTO', valueFill: '#8fd3ff' },
      { label: 'Casas', value: `${t.movesLeft}/${MOVES_PER_TURN}` },
    ]);
  } else {
    const attack = t.queuedAttack ? 'PREPARADO' : t.attacked ? 'USADO' : 'LIVRE';
    chipRow(ctx, footY, [
      { label: 'Fase', value: 'AÇÕES', valueFill: '#ff9a8f' },
      { label: 'Ataque', value: attack, valueFill: t.attacked && !t.queuedAttack ? used : t.queuedAttack ? GOLD : free },
      { label: 'Bônus', value: t.bonusUsed ? 'USADO' : 'LIVRE', valueFill: t.bonusUsed ? used : free },
    ]);
  }
}


// Imagem 1: o mapa com os jogadores. Retorna um Buffer PNG.
async function renderMapImage(battle) {
  const L = layoutOf(battle);
  const canvas = createCanvas(px(L.mapW), px(L.mapH));
  const ctx = canvas.getContext('2d');
  // As coordenadas só aparecem na hora de escolher o setor inicial; depois somem
  ctx.drawImage(background(L, battle.phase === 'placement'), 0, 0);
  ctx.scale(SCALE, SCALE);

  if (battle.phase === 'combat') {
    const cur = currentPlayer(battle);
    if (!battle.over && !battle.pending) {
      // Realça as casas para onde as setas levam
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      for (const dir of Object.keys(DIRECTIONS)) {
        const step = checkStep(battle, cur, dir);
        if (step.error) continue;
        const o = cellOrigin(L, step.dest);
        ctx.fillRect(o.x + 1, o.y + 1, L.cellW - 1, L.cellH - 1);
      }
    }
    for (const s of battle.summons ?? []) {
      const owner = battle.players.find(p => p.id === s.ownerId);
      drawSummon(ctx, L, s, owner, owner?.team ?? 0, s.icon ? await loadSummonIcon(s.icon) : null);
      drawSummonHp(ctx, L, s);
    }
    // A cor do anel é a do time (azul/vermelho); quem caiu sai do mapa
    for (const p of battle.players.filter(q => q.hp > 0)) drawToken(ctx, L, p, p.team, !battle.over && p === cur);
  }

  ctx.strokeStyle = '#5a3b1a';
  ctx.lineWidth = 4;
  ctx.strokeRect(0, 0, L.mapW, L.mapH);
  return canvas.encode('png');
}

// Imagem 2: o painel de status. Retorna um Buffer PNG.
async function renderPanelImage(battle) {
  const canvas = createCanvas(px(W), px(panelHeight(battle)));
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);
  drawPanel(ctx, battle);
  return canvas.encode('png');
}

module.exports = { renderMapImage, renderPanelImage, loadAvatar };
