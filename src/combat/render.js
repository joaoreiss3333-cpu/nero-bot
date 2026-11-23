const { EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { currentPlayer, opponentOf, checkStep, abilitiesOf } = require('./battle');
const { renderMapImage, renderPanelImage } = require('./image');

const EMBED_COLOR = 0xc0392b;

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

// Monta a mensagem do painel: o que aconteceu, as imagens (mapa e status) e os botões.
// `ping` é a menção que vai fora do embed (para notificar de verdade).
async function panelPayload(battle, text = '', ping = '') {
  const placing = battle.phase === 'placement';
  let components;
  if (battle.over) components = [];
  else if (placing) components = [new ActionRowBuilder().addComponents(
    btn('pl:open', ButtonStyle.Primary).setLabel('Escolher setor').setEmoji('📍'),
  )];
  else if (battle.pending) components = [reactionRow(battle)];
  else components = controlRows(battle);

  // Dois embeds empilhados: o de cima com o texto e o mapa, o de baixo com o painel de status
  let title;
  if (battle.over) title = 'Batalha encerrada';
  else if (placing) title = 'Posicionamento';
  else title = `Turno de ${currentPlayer(battle).name}`;

  const mapEmbed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle(title).setImage('attachment://mapa.png');
  if (text) mapEmbed.setDescription(text);

  const panelEmbed = new EmbedBuilder().setColor(EMBED_COLOR).setImage('attachment://painel.png');
  if (placing) panelEmbed.setFooter({ text: 'Clique em "Escolher setor" e digite onde você quer começar (ex: C3).' });
  else if (!battle.over) panelEmbed.setFooter({ text: 'Use /habilidade para atacar ou usar uma ação bônus.' });

  const [mapPng, panelPng] = await Promise.all([renderMapImage(battle), renderPanelImage(battle)]);
  return {
    content: ping,
    embeds: [mapEmbed, panelEmbed],
    components,
    files: [new AttachmentBuilder(mapPng, { name: 'mapa.png' }), new AttachmentBuilder(panelPng, { name: 'painel.png' })],
  };
}

// Ao editar uma mensagem existente, `attachments: []` faz a imagem nova substituir a antiga
const asEdit = payload => ({ ...payload, attachments: [] });

module.exports = { panelPayload, asEdit };
