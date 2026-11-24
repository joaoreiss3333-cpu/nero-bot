// Imagem do /perfil: uma "página de grimório" (fundo escuro, moldura dourada, círculo mágico e o
// trevo de cinco folhas) com a foto do personagem, o grimório, nome, idade, nível e atributos.
const { createCanvas } = require('@napi-rs/canvas');
const { ATTRIBUTES } = require('./progression');
const { ATTRIBUTE_CAP } = require('./config');

const W = 1000;
const H = 620;
const FONT = '"Garamond", "Palatino Linotype", "Book Antiqua", Georgia, serif';

const GOLD = '#d9b45a';
const GOLD_LIGHT = '#f3dc9a';
const GOLD_DARK = '#8a6a22';
const TEXT = '#efe6d2';
const MUTED = '#a89c82';

// Atributos na ordem em que aparecem, em dois grupos
const GROUPS = [
  { title: 'FÍSICOS', keys: ['forca', 'destreza', 'resistencia', 'inteligencia', 'armasBrancas'], light: '#f08a3c', dark: '#a8321f' },
  { title: 'MÁGICOS', keys: ['magiaOfensiva', 'magiaDefensiva', 'magiaSuplementar'], light: '#a98bff', dark: '#4a3aa8' },
];

function goldGradient(ctx, x0, y0, x1, y1) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, GOLD_LIGHT);
  g.addColorStop(0.5, GOLD);
  g.addColorStop(1, GOLD_DARK);
  return g;
}

// Trevo de cinco folhas (o símbolo do anti-magia) com a ponta de cada folha no centro
function cloverPath(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = (i * 72 - 90) * (Math.PI / 180);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a + Math.PI / 2);
    const k = 0.7; // largura da folha (menor = folhas mais separadas)
    ctx.moveTo(0, -0.14 * r);
    ctx.bezierCurveTo(-0.1 * k * r, -0.35 * r, -0.95 * k * r, -0.55 * r, -0.55 * k * r, -0.93 * r);
    ctx.bezierCurveTo(-0.3 * k * r, -1.1 * r, -0.04 * k * r, -0.95 * r, 0, -0.74 * r);
    ctx.bezierCurveTo(0.04 * k * r, -0.95 * r, 0.3 * k * r, -1.1 * r, 0.55 * k * r, -0.93 * r);
    ctx.bezierCurveTo(0.95 * k * r, -0.55 * r, 0.1 * k * r, -0.35 * r, 0, -0.14 * r);
    ctx.restore();
  }
}

function drawClover(ctx, cx, cy, r, { fill, stroke, lineWidth = 1 }) {
  cloverPath(ctx, cx, cy, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
}

function background(ctx) {
  const bg = ctx.createRadialGradient(W * 0.4, H * 0.45, 40, W * 0.5, H * 0.5, W * 0.75);
  bg.addColorStop(0, '#241a35');
  bg.addColorStop(0.55, '#130d20');
  bg.addColorStop(1, '#06040b');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // grão de couro/pergaminho
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 2500; i++) {
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(255,230,170,0.035)' : 'rgba(0,0,0,0.18)';
    ctx.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1 + rnd() * 2);
  }

  // trevo gigante apagado atrás dos atributos
  drawClover(ctx, 700, 350, 330, { fill: 'rgba(217,180,90,0.045)' });
  drawClover(ctx, 700, 350, 330, { stroke: 'rgba(217,180,90,0.10)', lineWidth: 2 });

  // círculo mágico atrás do retrato
  ctx.save();
  ctx.translate(199, 250);
  ctx.strokeStyle = 'rgba(217,180,90,0.22)';
  for (const [r, w] of [[250, 2], [236, 1], [175, 1.5]]) {
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.lineWidth = 1;
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const long = i % 6 === 0;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * (long ? 226 : 232), Math.sin(a) * (long ? 226 : 232));
    ctx.lineTo(Math.cos(a) * 250, Math.sin(a) * 250);
    ctx.stroke();
  }
  for (const rot of [0, Math.PI]) { // dois triângulos formando uma estrela de seis pontas
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = rot + (i / 3) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * 175; const y = Math.sin(a) * 175;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.stroke();
  }
  ctx.restore();
}

// Moldura dupla dourada com um trevo em cada canto
function border(ctx) {
  ctx.strokeStyle = goldGradient(ctx, 0, 0, W, H);
  ctx.lineWidth = 4;
  ctx.strokeRect(12, 12, W - 24, H - 24);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(22, 22, W - 44, H - 44);
  for (const [x, y] of [[22, 22], [W - 22, 22], [22, H - 22], [W - 22, H - 22]]) {
    ctx.fillStyle = '#130d20';
    ctx.beginPath(); ctx.arc(x, y, 15, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = GOLD; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 15, 0, Math.PI * 2); ctx.stroke();
    drawClover(ctx, x, y, 11, { fill: GOLD });
  }
}

// Desenha `img` preenchendo o retângulo (como object-fit: cover), centralizada
function drawCover(ctx, img, x, y, w, h) {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function archPath(ctx, x, y, w, h) {
  const r = w / 2;
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.arc(x + r, y + r, r, Math.PI, 0);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}

// Retrato do personagem numa moldura em arco
function drawPortrait(ctx, img, x, y, w, h) {
  ctx.save();
  archPath(ctx, x, y, w, h);
  ctx.clip();
  if (img) {
    ctx.fillStyle = '#0b0712';
    ctx.fillRect(x, y, w, h);
    drawCover(ctx, img, x, y, w, h);
  } else {
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, '#2a2040'); g.addColorStop(1, '#0d0816');
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    drawClover(ctx, x + w / 2, y + h / 2, 90, { fill: 'rgba(217,180,90,0.18)' });
  }
  // sombra suave embaixo para a moldura "afundar" a foto
  const shade = ctx.createLinearGradient(x, y + h * 0.7, x, y + h);
  shade.addColorStop(0, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = shade; ctx.fillRect(x, y, w, h);
  ctx.restore();

  archPath(ctx, x, y, w, h);
  ctx.strokeStyle = goldGradient(ctx, x, y, x + w, y + h);
  ctx.lineWidth = 6; ctx.stroke();
  archPath(ctx, x + 8, y + 8, w - 16, h - 16);
  ctx.strokeStyle = 'rgba(217,180,90,0.45)';
  ctx.lineWidth = 1.5; ctx.stroke();
}

// Grimório: um livro de lado (lombada à esquerda). Com imagem, ela vira a capa; sem imagem, capa de couro lisa (o trevo do grimório virá de um sistema próprio, depois).
function drawGrimoire(ctx, img, x, y, w, h) {
  const spine = 14;
  ctx.save();
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.clip();
  if (img) {
    ctx.fillStyle = '#0b0712'; ctx.fillRect(x, y, w, h);
    drawCover(ctx, img, x, y, w, h);
  } else {
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, '#3a2a55'); g.addColorStop(1, '#170f26');
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(217,180,90,0.55)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(x + spine + 8, y + 8, w - spine - 16, h - 16);
  }
  // lombada
  const sg = ctx.createLinearGradient(x, 0, x + spine, 0);
  sg.addColorStop(0, 'rgba(0,0,0,0.65)'); sg.addColorStop(0.6, 'rgba(255,255,255,0.10)'); sg.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = sg; ctx.fillRect(x, y, spine, h);
  ctx.restore();

  ctx.beginPath(); ctx.roundRect(x, y, w, h, 6);
  ctx.strokeStyle = goldGradient(ctx, x, y, x + w, y + h);
  ctx.lineWidth = 4; ctx.stroke();
  for (const cy of [y + h * 0.22, y + h * 0.78]) { // tiras douradas da lombada
    ctx.fillStyle = GOLD;
    ctx.fillRect(x, cy - 2, spine, 4);
  }
}

function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  while (text.length > 1 && ctx.measureText(`${text}…`).width > maxWidth) text = text.slice(0, -1);
  return `${text}…`;
}

// Linha com texto no centro e filetes dourados dos lados
function ornamentLine(ctx, x0, x1, y, label) {
  ctx.font = `bold 17px ${FONT}`;
  ctx.letterSpacing = '4px';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const tw = ctx.measureText(label).width;
  const cx = (x0 + x1) / 2;
  ctx.strokeStyle = 'rgba(217,180,90,0.6)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(cx - tw / 2 - 18, y); ctx.moveTo(cx + tw / 2 + 18, y); ctx.lineTo(x1, y); ctx.stroke();
  ctx.fillStyle = GOLD;
  ctx.fillText(label, cx + 2, y + 1);
  ctx.letterSpacing = '0px';
}

function drawAttributeRow(ctx, label, value, y, group) {
  const x = 392;
  const barX = 620;
  const barW = 290;
  const barH = 16;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `600 23px ${FONT}`;
  ctx.fillStyle = TEXT;
  ctx.fillText(label, x, y);

  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath(); ctx.roundRect(barX, y - barH / 2, barW, barH, 8); ctx.fill();
  const fill = Math.max(0, Math.min(1, value / ATTRIBUTE_CAP)) * barW;
  if (fill > 0) {
    const g = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    g.addColorStop(0, group.dark); g.addColorStop(1, group.light);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.roundRect(barX, y - barH / 2, Math.max(fill, barH), barH, 8); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(217,180,90,0.5)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(barX, y - barH / 2, barW, barH, 8); ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; // marcas de 10 em 10
  for (let i = 1; i < 10; i++) {
    const tx = barX + (barW * i) / 10;
    ctx.beginPath(); ctx.moveTo(tx, y - barH / 2 + 3); ctx.lineTo(tx, y + barH / 2 - 3); ctx.stroke();
  }

  ctx.textAlign = 'right';
  ctx.font = `bold 26px ${FONT}`;
  ctx.fillStyle = GOLD_LIGHT;
  ctx.fillText(String(value), 962 - 4, y + 1);
}

function drawLevelBadge(ctx, cx, cy, level) {
  const r = 56;
  const rg = ctx.createRadialGradient(cx, cy, 6, cx, cy, r);
  rg.addColorStop(0, '#2c2046'); rg.addColorStop(1, '#0d0816');
  ctx.fillStyle = rg;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  drawClover(ctx, cx, cy + 6, 46, { fill: 'rgba(217,180,90,0.14)' });
  ctx.strokeStyle = goldGradient(ctx, cx - r, cy - r, cx + r, cy + r); ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(217,180,90,0.55)';
  ctx.beginPath(); ctx.arc(cx, cy, r - 8, 0, Math.PI * 2); ctx.stroke();

  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `bold 14px ${FONT}`; ctx.letterSpacing = '3px';
  ctx.fillStyle = MUTED;
  ctx.fillText('NÍVEL', cx + 1, cy - 25);
  ctx.letterSpacing = '0px';
  ctx.font = `bold 46px ${FONT}`;
  ctx.fillStyle = goldGradient(ctx, cx, cy - 20, cx, cy + 30);
  ctx.fillText(String(level), cx, cy + 8);
}

// Barra de XP do nível atual; sem `xpNext` (nível máximo) ela aparece cheia
function drawXpBar(ctx, x, y, w, xp, xpNext) {
  const h = 12;
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.font = `bold 16px ${FONT}`; ctx.letterSpacing = '2px';
  ctx.fillStyle = GOLD;
  ctx.fillText('XP', x, y);
  ctx.letterSpacing = '0px';
  const bx = x + 36;
  const bw = w - 36 - 130;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath(); ctx.roundRect(bx, y - h / 2, bw, h, 6); ctx.fill();
  const frac = xpNext ? Math.max(0, Math.min(1, xp / xpNext)) : 1;
  if (frac > 0) {
    ctx.fillStyle = goldGradient(ctx, bx, 0, bx + bw, 0);
    ctx.beginPath(); ctx.roundRect(bx, y - h / 2, Math.max(h, bw * frac), h, 6); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(217,180,90,0.5)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(bx, y - h / 2, bw, h, 6); ctx.stroke();
  ctx.font = `16px ${FONT}`; ctx.fillStyle = MUTED;
  ctx.fillText(xpNext ? `${xp} / ${xpNext}` : 'MÁXIMO', bx + bw + 12, y + 1);
}

// Selo com os pontos de atributo que ainda dá para gastar (destacado quando há pontos)
function drawPointsTag(ctx, cx, y, points) {
  const w = 156;
  const h = 30;
  const x = cx - w / 2;
  const has = points > 0;
  ctx.beginPath(); ctx.roundRect(x, y - h / 2, w, h, 15);
  ctx.fillStyle = has ? 'rgba(217,180,90,0.22)' : 'rgba(0,0,0,0.35)';
  ctx.fill();
  ctx.strokeStyle = has ? GOLD : 'rgba(217,180,90,0.35)'; ctx.lineWidth = has ? 2 : 1.5;
  ctx.stroke();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `bold 17px ${FONT}`; ctx.letterSpacing = '1px';
  ctx.fillStyle = has ? GOLD_LIGHT : MUTED;
  ctx.fillText(`${points} ${points === 1 ? 'PONTO' : 'PONTOS'}`, cx, y + 1);
  ctx.letterSpacing = '0px';
}

// data: { name, age, level, xp, xpNext, points, attrs, portrait, grimoire }  (portrait/grimoire: imagens já carregadas, ou null)
async function renderProfileImage(data) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  background(ctx);
  border(ctx);

  // Coluna esquerda: retrato e grimório
  drawPortrait(ctx, data.portrait, 50, 52, 304, 372);
  drawGrimoire(ctx, data.grimoire, 50, 446, 104, 126);
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = `bold 17px ${FONT}`; ctx.letterSpacing = '4px';
  ctx.fillStyle = GOLD;
  ctx.fillText('GRIMÓRIO', 176, 468);
  ctx.letterSpacing = '0px';
  ctx.strokeStyle = 'rgba(217,180,90,0.5)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(176, 486); ctx.lineTo(354, 486); ctx.stroke();
  // tipo da magia (nome do grimório) e raridade, ao lado da foto
  let gSize = 34;
  const gName = data.grimoireName ?? 'Sem grimório';
  ctx.font = `bold ${gSize}px ${FONT}`;
  while (gSize > 18 && ctx.measureText(gName).width > 178) { gSize -= 2; ctx.font = `bold ${gSize}px ${FONT}`; }
  ctx.fillStyle = data.grimoireName ? goldGradient(ctx, 0, 500, 0, 540) : MUTED;
  ctx.fillText(gName, 176, 518);
  if (data.grimoireRarity) {
    ctx.font = `italic 20px ${FONT}`; ctx.fillStyle = MUTED;
    ctx.fillText(data.grimoireRarity, 177, 552);
  }

  // Cabeçalho: nome, idade e nível
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  let nameSize = 58;
  ctx.font = `bold ${nameSize}px ${FONT}`;
  while (nameSize > 34 && ctx.measureText(data.name).width > 410) {
    nameSize -= 2;
    ctx.font = `bold ${nameSize}px ${FONT}`;
  }
  ctx.fillStyle = goldGradient(ctx, 0, 60, 0, 130);
  ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
  ctx.fillText(fitText(ctx, data.name, 410), 392, 110);
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

  ctx.font = `italic 26px ${FONT}`;
  ctx.fillStyle = MUTED;
  const age = data.age == null ? 'Idade desconhecida' : `${data.age} anos`;
  ctx.fillText(age, 394, 150);

  drawLevelBadge(ctx, 880, 100, data.level);
  drawPointsTag(ctx, 880, 178, data.points ?? 0);
  drawXpBar(ctx, 392, 180, 400, data.xp ?? 0, data.xpNext ?? null);

  // Atributos
  let y = 205;
  for (const group of GROUPS) {
    ornamentLine(ctx, 392, 962, y, group.title);
    y += 36;
    for (const key of group.keys) {
      drawAttributeRow(ctx, ATTRIBUTES[key], data.attrs[key] ?? 0, y, group);
      y += 38;
    }
    y += 12;
  }

  return canvas.toBuffer('image/png');
}

module.exports = { renderProfileImage };
