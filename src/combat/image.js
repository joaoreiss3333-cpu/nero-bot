const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { COLUMNS, ROWS, MAX_HP, MAX_MANA, MAX_ENERGY, MOVES_PER_TURN } = require('./config');
const { DIRECTIONS } = require('./grid');
const { currentPlayer, checkStep } = require('./battle');

// Medidas lógicas da imagem. Ela é desenhada em resolução dobrada (SCALE) para ficar nítida
// quando o Discord a reduz. O formato é mais largo que alto para o Discord exibi-la maior.
const SCALE = 2;
const CELL_W = 76;
const CELL_H = 54;
const GUTTER = 28; // faixa com as letras/números das coordenadas
const MAP_W = GUTTER + COLUMNS.length * CELL_W + 4;
const MAP_H = GUTTER + ROWS * CELL_H + 4;
const PANEL_H = 272;
const TOTAL_H = MAP_H + PANEL_H;

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

const cellOrigin = ({ col, row }) => ({ x: GUTTER + col * CELL_W, y: GUTTER + row * CELL_H });
const cellCenter = pos => {
  const o = cellOrigin(pos);
  return { x: o.x + CELL_W / 2, y: o.y + CELL_H / 2 };
};

// Terreno gerado proceduralmente (sempre igual) + grade + coordenadas. Desenhado uma vez só.
let backgroundCache = null;
function background() {
  if (backgroundCache) return backgroundCache;
  const canvas = createCanvas(MAP_W * SCALE, MAP_H * SCALE);
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);
  const rng = mulberry32(7);

  ctx.fillStyle = '#2b2118';
  ctx.fillRect(0, 0, MAP_W, MAP_H);

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLUMNS.length; c++) {
      const o = cellOrigin({ col: c, row: r });
      ctx.fillStyle = `hsl(${92 + rng() * 22}, ${34 + rng() * 12}%, ${26 + rng() * 9}%)`;
      ctx.fillRect(o.x, o.y, CELL_W, CELL_H);
    }
  }
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = rng() < 0.5 ? 'rgba(15,45,12,0.28)' : 'rgba(150,200,95,0.18)';
    ctx.fillRect(GUTTER + rng() * (MAP_W - GUTTER), GUTTER + rng() * (MAP_H - GUTTER), 2 + rng() * 4, 1 + rng() * 2);
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1;
  for (let c = 0; c <= COLUMNS.length; c++) {
    const x = GUTTER + c * CELL_W;
    ctx.beginPath(); ctx.moveTo(x, GUTTER); ctx.lineTo(x, GUTTER + ROWS * CELL_H); ctx.stroke();
  }
  for (let r = 0; r <= ROWS; r++) {
    const y = GUTTER + r * CELL_H;
    ctx.beginPath(); ctx.moveTo(GUTTER, y); ctx.lineTo(GUTTER + COLUMNS.length * CELL_W, y); ctx.stroke();
  }

  ctx.fillStyle = '#e8c872';
  ctx.font = `bold 17px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  COLUMNS.forEach((letter, c) => ctx.fillText(letter, GUTTER + c * CELL_W + CELL_W / 2, GUTTER / 2 + 1));
  for (let r = 0; r < ROWS; r++) ctx.fillText(String(r + 1), GUTTER / 2, GUTTER + r * CELL_H + CELL_H / 2);

  ctx.strokeStyle = '#5a3b1a';
  ctx.lineWidth = 3;
  ctx.strokeRect(GUTTER, GUTTER, COLUMNS.length * CELL_W, ROWS * CELL_H);

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
  const R = 24;
  const color = PLAYER_COLORS[index];

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
    ctx.beginPath(); ctx.arc(x, y, R + 5, 0, Math.PI * 2); ctx.stroke();
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
    ctx.font = `bold 26px ${FONT}`;
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
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

  ctx.save();
  ctx.fillStyle = '#fff';
  ctx.shadowColor = '#000';
  ctx.shadowBlur = 3;
  ctx.font = `bold 18px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${value}/${max}`, x + w / 2, y + h / 2 + 1);
  ctx.restore();
}

function drawPanel(ctx, battle) {
  const top = MAP_H;
  const W = MAP_W;
  const cur = battle.phase === 'combat' ? currentPlayer(battle) : null;

  ctx.fillStyle = '#e6cf9c';
  ctx.fillRect(0, top, W, PANEL_H);
  ctx.strokeStyle = '#5a3b1a';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, top + 3, W - 6, PANEL_H - 6);
  ctx.strokeStyle = '#b8893a';
  ctx.lineWidth = 2;
  ctx.strokeRect(11, top + 11, W - 22, PANEL_H - 22);

  ctx.fillStyle = '#3b2410';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold 32px ${FONT}`;
  const placing = battle.phase === 'placement';
  ctx.fillText(placing ? 'POSICIONAMENTO' : `BATALHA EM CAMPO — RODADA ${battle.round}`, W / 2, top + 40);

  const barW = 104;
  const gap = 6;
  const barX0 = W - 3 * barW - 2 * gap - 20;
  const barX = [barX0, barX0 + barW + gap, barX0 + 2 * (barW + gap)];

  ctx.font = `bold 14px ${FONT}`;
  ['VIDA', 'MANA', 'ENERGIA'].forEach((label, i) => ctx.fillText(label, barX[i] + barW / 2, top + 84));

  battle.players.forEach((p, i) => {
    const barH = 34;
    const y = top + 100 + i * 52;
    const mid = y + barH / 2;

    ctx.fillStyle = PLAYER_COLORS[i];
    ctx.beginPath(); ctx.arc(38, mid, 10, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.stroke();

    ctx.fillStyle = '#3b2410';
    ctx.textAlign = 'left';
    ctx.font = `bold 22px ${FONT}`;
    ctx.fillText(fitText(ctx, p.name, barX[0] - 58 - 10), 58, mid);

    drawBar(ctx, barX[0], y, barW, barH, p.hp, MAX_HP, '#59d24a', '#1f7a1c');
    drawBar(ctx, barX[1], y, barW, barH, p.mana, MAX_MANA, '#4aa8f0', '#1b5aa6');
    drawBar(ctx, barX[2], y, barW, barH, p.energy, MAX_ENERGY, '#f6b73c', '#c46a0a');
  });

  ctx.fillStyle = '#3b2410';
  ctx.textAlign = 'center';
  ctx.font = `bold 21px ${FONT}`;
  if (battle.over) {
    ctx.fillText('BATALHA ENCERRADA', W / 2, top + PANEL_H - 44);
  } else if (placing) {
    // As escolhas ficam escondidas até os dois estarem prontos
    ctx.fillText('Cada jogador escolhe seu setor inicial', W / 2, top + PANEL_H - 56);
    ctx.font = `16px ${FONT}`;
    ctx.fillText(
      fitText(ctx, battle.players.map(p => `${p.name}: ${p.pos ? 'pronto' : 'aguardando'}`).join('  •  '), W - 50),
      W / 2, top + PANEL_H - 30,
    );
  } else {
    const t = battle.turn;
    const attack = t.queuedAttack ? `preparado (${t.queuedAttack.name})` : t.attacked ? 'usado' : 'disponível';
    ctx.fillText(fitText(ctx, `Turno de ${cur.name}`, W - 50), W / 2, top + PANEL_H - 56);
    ctx.font = `16px ${FONT}`;
    ctx.fillText(
      `Movimento ${t.movesLeft}/${MOVES_PER_TURN}  •  Ataque: ${attack}  •  Bônus: ${t.bonusUsed ? 'usado' : 'disponível'}`,
      W / 2, top + PANEL_H - 30,
    );
  }
}

// Desenha o mapa com os jogadores e, embaixo, o painel de status. Retorna um Buffer PNG.
async function renderBattleImage(battle) {
  const canvas = createCanvas(MAP_W * SCALE, TOTAL_H * SCALE);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(background(), 0, 0); // o fundo já está em resolução dobrada
  ctx.scale(SCALE, SCALE);

  if (battle.phase === 'placement') {
    drawPanel(ctx, battle); // sem jogadores no mapa até o combate começar
    return canvas.encode('png');
  }

  const cur = currentPlayer(battle);
  if (!battle.over && !battle.pending) {
    // Realça as casas para onde as setas levam
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    for (const dir of Object.keys(DIRECTIONS)) {
      const step = checkStep(battle, cur, dir);
      if (step.error) continue;
      const o = cellOrigin(step.dest);
      ctx.fillRect(o.x + 1, o.y + 1, CELL_W - 1, CELL_H - 1);
    }
  }

  battle.players.forEach((p, i) => drawToken(ctx, p, i, !battle.over && p === cur));
  drawPanel(ctx, battle);
  return canvas.encode('png');
}

module.exports = { renderBattleImage, loadAvatar };
