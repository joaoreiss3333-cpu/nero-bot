const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { COLUMNS, ROWS, MAX_HP, MAX_MANA, MAX_ENERGY, MOVES_PER_TURN } = require('./config');
const { DIRECTIONS } = require('./grid');
const { currentPlayer, checkStep } = require('./battle');

const CELL = 76;
const GUTTER = 28; // faixa com as letras/números das coordenadas
const MAP_W = GUTTER + COLUMNS.length * CELL + 4;
const MAP_H = GUTTER + ROWS * CELL + 4;
const PANEL_H = 214;

const PLAYER_COLORS = ['#3b8fe0', '#e0453b'];
const FONT = 'Georgia, "Times New Roman", serif';

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cellCenter = ({ col, row }) => ({ x: GUTTER + col * CELL + CELL / 2, y: GUTTER + row * CELL + CELL / 2 });

// Terreno gerado proceduralmente (sempre igual) + grade + coordenadas. Desenhado uma vez só.
let backgroundCache = null;
function background() {
  if (backgroundCache) return backgroundCache;
  const canvas = createCanvas(MAP_W, MAP_H);
  const ctx = canvas.getContext('2d');
  const rng = mulberry32(7);

  ctx.fillStyle = '#2b2118';
  ctx.fillRect(0, 0, MAP_W, MAP_H);

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLUMNS.length; c++) {
      ctx.fillStyle = `hsl(${92 + rng() * 22}, ${34 + rng() * 12}%, ${26 + rng() * 9}%)`;
      ctx.fillRect(GUTTER + c * CELL, GUTTER + r * CELL, CELL, CELL);
    }
  }
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = rng() < 0.5 ? 'rgba(15,45,12,0.28)' : 'rgba(150,200,95,0.18)';
    ctx.fillRect(GUTTER + rng() * (MAP_W - GUTTER), GUTTER + rng() * (MAP_H - GUTTER), 2 + rng() * 4, 1 + rng() * 2);
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1;
  for (let c = 0; c <= COLUMNS.length; c++) {
    ctx.beginPath(); ctx.moveTo(GUTTER + c * CELL + 0.5, GUTTER); ctx.lineTo(GUTTER + c * CELL + 0.5, GUTTER + ROWS * CELL); ctx.stroke();
  }
  for (let r = 0; r <= ROWS; r++) {
    ctx.beginPath(); ctx.moveTo(GUTTER, GUTTER + r * CELL + 0.5); ctx.lineTo(GUTTER + COLUMNS.length * CELL, GUTTER + r * CELL + 0.5); ctx.stroke();
  }

  ctx.fillStyle = '#e8c872';
  ctx.font = `bold 15px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  COLUMNS.forEach((letter, c) => ctx.fillText(letter, GUTTER + c * CELL + CELL / 2, GUTTER / 2));
  for (let r = 0; r < ROWS; r++) ctx.fillText(String(r + 1), GUTTER / 2, GUTTER + r * CELL + CELL / 2);

  ctx.strokeStyle = '#5a3b1a';
  ctx.lineWidth = 3;
  ctx.strokeRect(GUTTER, GUTTER, COLUMNS.length * CELL, ROWS * CELL);

  return (backgroundCache = canvas);
}

async function loadAvatar(url) {
  try {
    return await loadImage(url);
  } catch {
    return null; // sem avatar: o token usa a inicial do nome
  }
}

function drawToken(ctx, player, index, active) {
  const { x, y } = cellCenter(player.pos);
  const R = 28;
  const color = PLAYER_COLORS[index];

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(x + 2, y + R - 2, R * 0.9, R * 0.35, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  if (active) {
    ctx.save();
    ctx.shadowColor = '#ffd84a';
    ctx.shadowBlur = 14;
    ctx.strokeStyle = '#ffd84a';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, R + 6, 0, Math.PI * 2); ctx.stroke();
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
    ctx.font = `bold 30px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(player.name.charAt(0).toUpperCase(), x, y + 1);
  }
  ctx.restore();

  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.stroke();
}

function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  while (text.length > 1 && ctx.measureText(text + '…').width > maxWidth) text = text.slice(0, -1);
  return text + '…';
}

function drawBar(ctx, x, y, w, h, value, max, light, dark) {
  ctx.fillStyle = '#1b1410';
  ctx.fillRect(x, y, w, h);
  const fillW = Math.max(0, Math.round((w - 4) * (value / max)));
  const grad = ctx.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, light);
  grad.addColorStop(1, dark);
  ctx.fillStyle = grad;
  ctx.fillRect(x + 2, y + 2, fillW, h - 4);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  ctx.save();
  ctx.fillStyle = '#fff';
  ctx.shadowColor = '#000';
  ctx.shadowBlur = 3;
  ctx.font = `bold 13px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${value}/${max}`, x + w / 2, y + h / 2 + 1);
  ctx.restore();
}

function drawPanel(ctx, battle) {
  const top = MAP_H;
  const W = MAP_W;
  const cur = currentPlayer(battle);

  ctx.fillStyle = '#e6cf9c';
  ctx.fillRect(0, top, W, PANEL_H);
  ctx.strokeStyle = '#5a3b1a';
  ctx.lineWidth = 5;
  ctx.strokeRect(2.5, top + 2.5, W - 5, PANEL_H - 5);
  ctx.strokeStyle = '#b8893a';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(9.5, top + 9.5, W - 19, PANEL_H - 19);

  ctx.fillStyle = '#3b2410';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold 24px ${FONT}`;
  ctx.fillText(`BATALHA EM CAMPO — RODADA ${battle.round}`, W / 2, top + 32);

  const barW = 124;
  const barX = [W - 3 * barW - 2 * 10 - 22, 0, 0];
  barX[1] = barX[0] + barW + 10;
  barX[2] = barX[1] + barW + 10;

  ctx.font = `bold 12px ${FONT}`;
  ['VIDA', 'MANA', 'ENERGIA'].forEach((label, i) => ctx.fillText(label, barX[i] + barW / 2, top + 62));

  battle.players.forEach((p, i) => {
    const y = top + 74 + i * 40;
    const mid = y + 11;

    ctx.fillStyle = PLAYER_COLORS[i];
    ctx.beginPath(); ctx.arc(30, mid, 8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke();

    ctx.fillStyle = '#3b2410';
    ctx.textAlign = 'left';
    ctx.font = `bold 18px ${FONT}`;
    ctx.fillText(fitText(ctx, p.name, barX[0] - 56), 48, mid);

    drawBar(ctx, barX[0], y, barW, 22, p.hp, MAX_HP, '#59d24a', '#1f7a1c');
    drawBar(ctx, barX[1], y, barW, 22, p.mana, MAX_MANA, '#4aa8f0', '#1b5aa6');
    drawBar(ctx, barX[2], y, barW, 22, p.energy, MAX_ENERGY, '#f6b73c', '#c46a0a');
  });

  ctx.fillStyle = '#3b2410';
  ctx.textAlign = 'center';
  ctx.font = `bold 15px ${FONT}`;
  if (battle.over) {
    ctx.fillText('BATALHA ENCERRADA', W / 2, top + PANEL_H - 36);
  } else {
    const t = battle.turn;
    const attack = t.queuedAttack ? `preparado (${t.queuedAttack.name})` : t.attacked ? 'usado' : 'disponível';
    ctx.fillText(fitText(ctx, `Turno de ${cur.name}`, W - 40), W / 2, top + PANEL_H - 48);
    ctx.font = `13px ${FONT}`;
    ctx.fillText(
      `Movimento ${t.movesLeft}/${MOVES_PER_TURN}  •  Ataque: ${attack}  •  Bônus: ${t.bonusUsed ? 'usado' : 'disponível'}`,
      W / 2, top + PANEL_H - 26,
    );
  }
}

// Desenha o mapa com os jogadores e, embaixo, o painel de status. Retorna um Buffer PNG.
async function renderBattleImage(battle) {
  const canvas = createCanvas(MAP_W, MAP_H + PANEL_H);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(background(), 0, 0);

  const cur = currentPlayer(battle);
  if (!battle.over && !battle.pending) {
    // Realça as casas para onde as setas levam
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    for (const dir of Object.keys(DIRECTIONS)) {
      const step = checkStep(battle, cur, dir);
      if (step.error) continue;
      ctx.fillRect(GUTTER + step.dest.col * CELL + 1, GUTTER + step.dest.row * CELL + 1, CELL - 1, CELL - 1);
    }
  }

  battle.players.forEach((p, i) => drawToken(ctx, p, i, !battle.over && p === cur));
  drawPanel(ctx, battle);
  return canvas.encode('png');
}

module.exports = { renderBattleImage, loadAvatar };
