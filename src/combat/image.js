const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { MOVES_PER_TURN } = require('./config');
const { DIRECTIONS, formatCoord } = require('./grid');
const { currentPlayer, checkStep } = require('./battle');

// Medidas lógicas das imagens, convertidas para pixels reais por SCALE. O mapa e o painel são
// duas imagens separadas, largas e baixas, com o tamanho da referência (~568 px de largura):
// o Discord mostra imagens desse tamanho sem redimensionar.
const SCALE = 568 / 720; // as imagens saem com ~568 px de largura: o Discord as exibe nesse tamanho exato
const px = v => Math.round(v * SCALE); // tamanho lógico -> pixels da imagem
const W = 720; // largura lógica fixa: com mais jogadores o mapa ganha mais casas, e elas ficam menores
const CELL_ASPECT = 56 / 90; // altura / largura de cada casa

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
    // Retratos da ficha costumam ser retangulares: recorta um quadrado a partir do topo (onde fica o rosto)
    // para o token redondo não esticar a imagem
    if (img.width === img.height) return img;
    const side = Math.min(img.width, img.height);
    const canvas = createCanvas(side, side);
    canvas.getContext('2d').drawImage(img, (img.width - side) / 2, 0, side, side, 0, 0, side, side);
    return canvas;
  } catch {
    return null; // sem avatar: o token usa a inicial do nome
  }
}

function drawToken(ctx, L, player, index, active) {
  const { x, y } = cellCenter(L, player.pos);
  const R = Math.min(22, L.cellH * 0.39, L.cellW * 0.39); // o token encolhe junto com a casa
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
    ctx.font = `bold ${Math.round(R * 1.2)}px ${FONT}`;
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

// Barra com o valor centralizado (o nome do atributo fica no cabeçalho da coluna)
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
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.font = `bold 19px ${FONT}`;
  ctx.fillText(`${value}/${max}`, x + w / 2, y + h / 2 + 1);
  ctx.restore();
}

// Altura do painel: cabeçalho + uma linha por jogador (um embaixo do outro) + resumo do turno
const ROW_H = 52;
const panelHeight = battle => 118 + battle.players.length * ROW_H + (battle.phase === 'placement' ? 70 : 48);

// Painel de status: tabela com um jogador por linha e, no fim, o resumo do turno
function drawPanel(ctx, battle) {
  const top = 0;
  const panelH = panelHeight(battle);
  const placing = battle.phase === 'placement';
  const cur = battle.phase === 'combat' ? currentPlayer(battle) : null;

  ctx.fillStyle = '#e6cf9c';
  ctx.fillRect(0, top, W, panelH);
  ctx.strokeStyle = '#5a3b1a';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, top + 3, W - 6, panelH - 6);
  ctx.strokeStyle = '#b8893a';
  ctx.lineWidth = 2;
  ctx.strokeRect(11, top + 11, W - 22, panelH - 22);

  // Faixa de título
  ctx.fillStyle = '#2b1a0c';
  ctx.fillRect(24, top + 24, W - 48, 48);
  ctx.strokeStyle = '#b8893a';
  ctx.lineWidth = 2;
  ctx.strokeRect(24, top + 24, W - 48, 48);
  ctx.fillStyle = '#f6b73c';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold 29px ${FONT}`;
  ctx.fillText(placing ? 'POSICIONAMENTO' : battle.over ? 'BATALHA ENCERRADA' : 'BATALHA EM CAMPO', W / 2, top + 49);

  // Colunas: o nome do atributo aparece uma vez só, em cima das barras
  const barW = 132;
  const gap = 10;
  const barX0 = W - 26 - 3 * barW - 2 * gap;
  const barX = [barX0, barX0 + barW + gap, barX0 + 2 * (barW + gap)];
  ctx.fillStyle = '#3b2410';
  ctx.font = `bold 16px ${FONT}`;
  ['VIDA', 'MANA', 'ENERGIA'].forEach((label, i) => ctx.fillText(label, barX[i] + barW / 2, top + 96));

  battle.players.forEach((p, i) => {
    const rowTop = top + 112 + i * ROW_H;
    const mid = rowTop + ROW_H / 2;

    if (cur === p && !battle.over) {
      ctx.fillStyle = 'rgba(255,216,74,0.32)'; // destaca quem está jogando
      ctx.fillRect(18, rowTop + 1, W - 36, ROW_H - 2);
    }

    ctx.fillStyle = PLAYER_COLORS[i];
    ctx.beginPath(); ctx.arc(40, mid, 10, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.stroke();

    ctx.fillStyle = '#3b2410';
    ctx.textAlign = 'left';
    ctx.font = `bold 24px ${FONT}`;
    ctx.fillText(fitText(ctx, p.name, barX0 - 62 - 12), 62, mid + 1);

    drawBar(ctx, barX[0], mid - 17, barW, 34, p.hp, p.maxHp, '#59d24a', '#1f7a1c');
    drawBar(ctx, barX[1], mid - 17, barW, 34, p.mana, p.maxMana, '#4aa8f0', '#1b5aa6');
    drawBar(ctx, barX[2], mid - 17, barW, 34, p.energy, p.maxEnergy, '#f6b73c', '#c46a0a');
  });

  const footY = top + 112 + battle.players.length * ROW_H + 18;
  ctx.fillStyle = '#3b2410';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (battle.over) return;
  if (placing) {
    // As escolhas ficam escondidas até os dois estarem prontos
    ctx.font = `bold 21px ${FONT}`;
    ctx.fillText('Escolham o setor inicial', W / 2, footY + 4);
    ctx.font = `17px ${FONT}`;
    ctx.fillText(
      fitText(ctx, battle.players.map(p => `${p.name}: ${p.pos ? 'pronto' : 'aguardando'}`).join('   •   '), W - 60),
      W / 2, footY + 32,
    );
  } else {
    // Primeiro a fase de movimento; depois as ações (ataque e bônus)
    const t = battle.turn;
    const attack = t.queuedAttack ? `preparado (${t.queuedAttack.name})` : t.attacked ? 'usado' : 'disponível';
    ctx.font = `18px ${FONT}`;
    ctx.fillText(
      t.phase === 'move'
        ? `Fase de movimento   •   Casas restantes: ${t.movesLeft}/${MOVES_PER_TURN}`
        : `Fase de ações   •   Ataque: ${attack}   •   Bônus: ${t.bonusUsed ? 'usado' : 'disponível'}`,
      W / 2, footY + 8,
    );
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
    battle.players.forEach((p, i) => drawToken(ctx, L, p, i, !battle.over && p === cur));
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
