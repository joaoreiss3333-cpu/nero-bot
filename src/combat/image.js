const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { COLUMNS, ROWS, MAX_HP, MAX_MANA, MAX_ENERGY, MOVES_PER_TURN } = require('./config');
const { DIRECTIONS, formatCoord } = require('./grid');
const { currentPlayer, checkStep } = require('./battle');

// Medidas lógicas da imagem. Ela é desenhada em resolução dobrada (SCALE) para ficar nítida
// quando o Discord a reduz. As casas são mais largas que altas para a imagem não ficar muito
// comprida (o Discord reduz imagens altas).
const SCALE = 2;
const CELL_W = 90;
const CELL_H = 56;
const MAP_W = COLUMNS.length * CELL_W;
const MAP_H = ROWS * CELL_H;
const PANEL_H = 262;
const W = MAP_W;
const H = MAP_H + PANEL_H;

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

const cellOrigin = ({ col, row }) => ({ x: col * CELL_W, y: row * CELL_H });
const cellCenter = pos => {
  const o = cellOrigin(pos);
  return { x: o.x + CELL_W / 2, y: o.y + CELL_H / 2 };
};

// Terreno gerado proceduralmente (sempre igual) + grade + coordenada em cada casa.
// Desenhado uma vez só.
let backgroundCache = null;
function background() {
  if (backgroundCache) return backgroundCache;
  const canvas = createCanvas(MAP_W * SCALE, MAP_H * SCALE);
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);
  const rng = mulberry32(7);

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLUMNS.length; c++) {
      const o = cellOrigin({ col: c, row: r });
      ctx.fillStyle = `hsl(${92 + rng() * 22}, ${34 + rng() * 12}%, ${26 + rng() * 9}%)`;
      ctx.fillRect(o.x, o.y, CELL_W, CELL_H);
    }
  }
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = rng() < 0.5 ? 'rgba(15,45,12,0.28)' : 'rgba(150,200,95,0.18)';
    ctx.fillRect(rng() * MAP_W, rng() * MAP_H, 2 + rng() * 4, 1 + rng() * 2);
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1;
  for (let c = 0; c <= COLUMNS.length; c++) {
    ctx.beginPath(); ctx.moveTo(c * CELL_W, 0); ctx.lineTo(c * CELL_W, MAP_H); ctx.stroke();
  }
  for (let r = 0; r <= ROWS; r++) {
    ctx.beginPath(); ctx.moveTo(0, r * CELL_H); ctx.lineTo(MAP_W, r * CELL_H); ctx.stroke();
  }

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLUMNS.length; c++) drawCoordLabel(ctx, { col: c, row: r });
  }

  return (backgroundCache = canvas);
}

// Coordenada da casa (ex: C3) no canto superior direito
function drawCoordLabel(ctx, pos) {
  ctx.save();
  ctx.font = `bold 14px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 3;
  ctx.fillText(formatCoord(pos), (pos.col + 1) * CELL_W - 6, pos.row * CELL_H + 4);
  ctx.restore();
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
  const R = 22;
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

// Barra com o nome do atributo à esquerda e o valor à direita
function drawBar(ctx, x, y, w, h, label, value, max, light, dark) {
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
  ctx.textBaseline = 'middle';
  ctx.font = `bold 14px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText(label, x + 9, y + h / 2 + 1);
  ctx.font = `bold 18px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.fillText(`${value}/${max}`, x + w - 9, y + h / 2 + 1);
  ctx.restore();
}

// Painel embaixo do mapa: um jogador por coluna, e o resumo do turno na última linha
function drawPanel(ctx, battle) {
  const top = MAP_H;
  const placing = battle.phase === 'placement';
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
  ctx.font = `bold 28px ${FONT}`;
  ctx.fillText(placing ? 'POSICIONAMENTO' : `RODADA ${battle.round}`, W / 2, top + 36);

  const colW = (W - 3 * 24) / 2;
  battle.players.forEach((p, i) => {
    const x = 24 + i * (colW + 24);
    const y = top + 60;

    if (cur === p && !battle.over) {
      ctx.fillStyle = 'rgba(255,216,74,0.30)'; // destaca quem está jogando
      ctx.fillRect(x - 8, y - 6, colW + 16, 140);
    }

    ctx.fillStyle = PLAYER_COLORS[i];
    ctx.beginPath(); ctx.arc(x + 10, y + 12, 9, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.stroke();

    ctx.fillStyle = '#3b2410';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `bold 23px ${FONT}`;
    ctx.fillText(fitText(ctx, p.name, colW - 34), x + 28, y + 13);

    drawBar(ctx, x, y + 32, colW, 29, 'VIDA', p.hp, MAX_HP, '#59d24a', '#1f7a1c');
    drawBar(ctx, x, y + 64, colW, 29, 'MANA', p.mana, MAX_MANA, '#4aa8f0', '#1b5aa6');
    drawBar(ctx, x, y + 96, colW, 29, 'ENERGIA', p.energy, MAX_ENERGY, '#f6b73c', '#c46a0a');
  });

  ctx.fillStyle = '#3b2410';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold 21px ${FONT}`;
  if (battle.over) {
    ctx.fillText('BATALHA ENCERRADA', W / 2, top + PANEL_H - 40);
  } else if (placing) {
    // As escolhas ficam escondidas até os dois estarem prontos
    ctx.fillText('Escolham o setor inicial', W / 2, top + PANEL_H - 52);
    ctx.font = `17px ${FONT}`;
    ctx.fillText(battle.players.map(p => `${p.name}: ${p.pos ? 'pronto' : 'aguardando'}`).join('   •   '), W / 2, top + PANEL_H - 28);
  } else {
    const t = battle.turn;
    const attack = t.queuedAttack ? `preparado (${t.queuedAttack.name})` : t.attacked ? 'usado' : 'disponível';
    ctx.fillText(fitText(ctx, `Turno de ${cur.name}`, W - 60), W / 2, top + PANEL_H - 52);
    ctx.font = `17px ${FONT}`;
    ctx.fillText(
      `Movimento: ${t.movesLeft}/${MOVES_PER_TURN}   •   Ataque: ${attack}   •   Bônus: ${t.bonusUsed ? 'usado' : 'disponível'}`,
      W / 2, top + PANEL_H - 28,
    );
  }
}

// Desenha o mapa com os jogadores e, embaixo, o painel de status. Retorna um Buffer PNG.
async function renderBattleImage(battle) {
  const canvas = createCanvas(W * SCALE, H * SCALE);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(background(), 0, 0); // o fundo já está em resolução dobrada
  ctx.scale(SCALE, SCALE);

  if (battle.phase === 'combat') {
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
    battle.players.forEach(p => drawCoordLabel(ctx, p.pos)); // a coordenada fica por cima do token
  }

  ctx.strokeStyle = '#5a3b1a';
  ctx.lineWidth = 4;
  ctx.strokeRect(0, 0, MAP_W, MAP_H);

  drawPanel(ctx, battle);
  return canvas.encode('png');
}

module.exports = { renderBattleImage, loadAvatar };
