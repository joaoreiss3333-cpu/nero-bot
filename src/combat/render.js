const {
  AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
  ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, SeparatorBuilder,
} = require('discord.js');
const { currentPlayer, opponentOf, checkStep, abilitiesOf } = require('./battle');
const { renderMapImage, renderPanelImage } = require('./image');
const { EMBED_COLOR } = require('./config');

const btn = (id, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setStyle(style);
const spacer = id => btn(id).setLabel('·').setDisabled(true);

// Setas de movimento, "Ir para as ações" e encerrar turno. As setas só funcionam na fase de
// movimento; depois que as ações são liberadas elas ficam desativadas.
function controlRows(battle) {
  const cur = currentPlayer(battle);
  const arrow = (dir, emoji) => btn(`mv:${dir}`).setEmoji(emoji).setDisabled(!!checkStep(battle, cur, dir).error);
  const moving = battle.turn.phase === 'move';

  return [
    new ActionRowBuilder().addComponents(
      spacer('sp1'), arrow('up', '⬆️'), spacer('sp2'),
      moving ? btn('act', ButtonStyle.Success).setLabel('Ir para as ações').setEmoji('⚔️') : spacer('sp3'),
    ),
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

// Monta a mensagem do painel num container (Components V2): texto, as imagens (mapa e status, que
// ocupam a largura toda) e os botões, tudo dentro do mesmo bloco. Com `frozen` os botões não aparecem.
// Obs: mensagens V2 não aceitam `content` nem embeds, e não dá para mandar `components: []` (ficaria vazia).
async function panelPayload(battle, text = '', { frozen = false } = {}) {
  const placing = battle.phase === 'placement';
  let rows;
  if (battle.over || frozen) rows = [];
  else if (placing) rows = [new ActionRowBuilder().addComponents(
    btn('pl:open', ButtonStyle.Primary).setLabel('Escolher setor').setEmoji('📍'),
  )];
  else if (battle.pending) rows = [reactionRow(battle)];
  else rows = controlRows(battle);

  let title;
  if (battle.over) title = 'Batalha encerrada';
  else if (placing) title = 'Posicionamento';
  else title = `Turno de ${currentPlayer(battle).name}`;

  let footer = '';
  if (placing) footer = 'Clique em "Escolher setor" e digite onde você quer começar (ex: C3).';
  else if (battle.pending) footer = 'Escolha como reagir ao ataque.';
  else if (!battle.over) {
    footer = battle.turn.phase === 'move'
      ? 'Movimente-se com as setas e clique em "Ir para as ações" para atacar ou usar uma ação bônus.'
      : 'Use /habilidade para atacar ou usar uma ação bônus.';
  }

  const container = new ContainerBuilder()
    .setAccentColor(EMBED_COLOR)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(text ? `## ${title}\n${text}` : `## ${title}`))
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://mapa.png')),
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://painel.png')),
    );
  if (footer) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${footer}`));
  if (rows.length) {
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addActionRowComponents(...rows);
  }

  const [mapPng, panelPng] = await Promise.all([renderMapImage(battle), renderPanelImage(battle)]);
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    files: [new AttachmentBuilder(mapPng, { name: 'mapa.png' }), new AttachmentBuilder(panelPng, { name: 'painel.png' })],
  };
}

// Ao editar uma mensagem existente, `attachments: []` faz as imagens novas substituírem as antigas;
// `content` e `embeds` vazios limpam o que a mensagem tinha antes (ex: o convite do desafio)
const asEdit = payload => ({ ...payload, content: '', embeds: [], attachments: [] });

module.exports = { panelPayload, asEdit };
