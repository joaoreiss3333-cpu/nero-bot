const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { COLUMNS, ROWS, MAX_HP, MAX_MANA, MAX_ENERGY, MOVES_PER_TURN } = require('./config');
const { formatCoord } = require('./grid');
const { currentPlayer, opponentOf, checkStep, abilitiesOf } = require('./battle');

function renderMap(battle) {
  const cell = (c, r) => {
    const i = battle.players.findIndex(p => p.pos.col === c && p.pos.row === r);
    return i >= 0 ? ` ${i + 1} ` : ' . ';
  };
  const header = '   ' + COLUMNS.map(c => ` ${c} `).join('');
  const lines = [];
  for (let r = 0; r < ROWS; r++) {
    lines.push(`${String(r + 1).padStart(2)} ` + COLUMNS.map((_, c) => cell(c, r)).join(''));
  }
  return '```\n' + [header, ...lines].join('\n') + '\n```';
}

const bar = (value, max) => {
  const filled = Math.round((value / max) * 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
};

// Painel: mapa em cima, informações da luta embaixo.
function battleEmbed(battle, text = '') {
  const cur = currentPlayer(battle);
  const t = battle.turn;

  const embed = new EmbedBuilder()
    .setColor(0xc0392b)
    .setTitle(`⚔️ Batalha — Rodada ${battle.round}`)
    .setDescription(renderMap(battle));

  battle.players.forEach((p, i) => {
    embed.addFields({
      name: `${i + 1}. ${p.name}${!battle.over && p === cur ? ' ▶' : ''} — ${formatCoord(p.pos)}`,
      value:
        `❤️ \`${bar(p.hp, MAX_HP)}\` ${p.hp}/${MAX_HP}\n` +
        `🔷 \`${bar(p.mana, MAX_MANA)}\` ${p.mana}/${MAX_MANA}\n` +
        `⚡ \`${bar(p.energy, MAX_ENERGY)}\` ${p.energy}/${MAX_ENERGY}`,
      inline: true,
    });
  });

  if (!battle.over) {
    embed.addFields({
      name: `Turno de ${cur.name}`,
      value:
        `🏃 Movimento: ${t.movesLeft}/${MOVES_PER_TURN} · ` +
        `👊 Ataque: ${t.queuedAttack ? `preparado (${t.queuedAttack.name})` : t.attacked ? 'usado' : 'disponível'} · ` +
        `✨ Bônus: ${t.bonusUsed ? 'usado' : 'disponível'}\n` +
        'Use `/habilidade` para atacar ou usar uma ação bônus.',
    });
  }
  if (text) embed.addFields({ name: 'Último evento', value: text });
  return embed;
}

const btn = (id, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setStyle(style);
const spacer = id => btn(id).setLabel('·').setDisabled(true);

// Setas de movimento e encerrar turno
function controlRows(battle) {
  const cur = currentPlayer(battle);
  const arrow = (dir, emoji) => btn(`mv:${dir}`).setEmoji(emoji).setDisabled(!!checkStep(battle, cur, dir).error);

  return [
    new ActionRowBuilder().addComponents(spacer('sp1'), arrow('up', '⬆️'), spacer('sp2')),
    new ActionRowBuilder().addComponents(
      arrow('left', '⬅️'), arrow('down', '⬇️'), arrow('right', '➡️'),
      btn('end', ButtonStyle.Primary).setLabel('Encerrar turno').setEmoji('⏭️'),
    ),
  ];
}

// Botões com as reações que o defensor possui
function reactionRow(battle) {
  const defender = opponentOf(battle, battle.pending.attackerId);
  const buttons = abilitiesOf(defender, 'reaction').map(a =>
    btn(`react:${a.id}`, a.kind === 'dodge' ? ButtonStyle.Primary : ButtonStyle.Success)
      .setLabel(a.name).setEmoji(a.emoji));
  buttons.push(btn('react:nenhuma').setLabel('Não reagir'));
  return new ActionRowBuilder().addComponents(buttons);
}

// Monta o conteúdo completo do painel conforme o estado da batalha
function panelPayload(battle, text = '') {
  let components;
  if (battle.over) components = [];
  else if (battle.pending) components = [reactionRow(battle)];
  else components = controlRows(battle);
  return { embeds: [battleEmbed(battle, text)], components };
}

module.exports = { panelPayload };
