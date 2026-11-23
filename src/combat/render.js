const { AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { currentPlayer, opponentOf, checkStep, abilitiesOf } = require('./battle');
const { renderBattleImage } = require('./image');

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

// Botões com as reações que o defensor possui (desativadas se faltar energia)
function reactionRow(battle) {
  const defender = opponentOf(battle, battle.pending.attackerId);
  const buttons = abilitiesOf(defender, 'reaction').map(a =>
    btn(`react:${a.id}`, a.kind === 'dodge' ? ButtonStyle.Primary : ButtonStyle.Success)
      .setLabel(`${a.name} (-${a.energyCost} energia)`)
      .setEmoji(a.emoji)
      .setDisabled(defender.energy < a.energyCost));
  buttons.push(btn('react:nenhuma').setLabel('Não reagir'));
  return new ActionRowBuilder().addComponents(buttons);
}

// Monta a mensagem do painel: texto do que aconteceu, imagem (mapa + status) e botões.
// A imagem vai como anexo, sem embed: o Discord a exibe bem maior assim.
// `ping` é uma linha de menção que vai no topo (ex: avisar de quem é a vez).
async function panelPayload(battle, text = '', ping = '') {
  const placing = battle.phase === 'placement';
  let components;
  if (battle.over) components = [];
  else if (placing) components = [new ActionRowBuilder().addComponents(
    btn('pl:open', ButtonStyle.Primary).setLabel('Escolher setor').setEmoji('📍'),
  )];
  else if (battle.pending) components = [reactionRow(battle)];
  else components = controlRows(battle);

  let hint = '';
  if (placing) hint = '-# Clique em "Escolher setor" e digite onde você quer começar (ex: C3).';
  else if (!battle.over) hint = '-# Use /habilidade para atacar ou usar uma ação bônus.';

  const content = [ping, text, hint].filter(Boolean).join('\n');
  const image = await renderBattleImage(battle);
  return { content, components, files: [new AttachmentBuilder(image, { name: 'batalha.png' })] };
}

// Ao editar uma mensagem existente, `attachments: []` faz a imagem nova substituir a antiga
const asEdit = payload => ({ ...payload, attachments: [] });

module.exports = { panelPayload, asEdit };
