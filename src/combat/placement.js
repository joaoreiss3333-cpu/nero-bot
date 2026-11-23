const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getBattle, findPlayer, currentPlayer, placePlayer, allPlaced } = require('./battle');
const { panelPayload, asEdit } = require('./render');
const { formatCoord } = require('./grid');
const { COLUMNS, ROWS } = require('./config');

const ephemeral = (interaction, content) => interaction.reply({ content, ephemeral: true });

// Mensagem privada do jogador, com os menus de coluna/linha e o botão de confirmar.
// O rascunho (battle.drafts) guarda a escolha ainda não confirmada de cada jogador.
function chooserPayload(battle, userId, note = '') {
  const draft = battle.drafts.get(userId) ?? {};
  const chosen = draft.col !== undefined && draft.row !== undefined;

  const colMenu = new StringSelectMenuBuilder()
    .setCustomId('pl:col')
    .setPlaceholder('Coluna')
    .addOptions(COLUMNS.map((letter, c) => ({ label: `Coluna ${letter}`, value: String(c), default: draft.col === c })));
  const rowMenu = new StringSelectMenuBuilder()
    .setCustomId('pl:row')
    .setPlaceholder('Linha')
    .addOptions(Array.from({ length: ROWS }, (_, r) => ({ label: `Linha ${r + 1}`, value: String(r), default: draft.row === r })));
  const confirm = new ButtonBuilder()
    .setCustomId('pl:ok')
    .setLabel(chosen ? `Confirmar ${formatCoord(draft)}` : 'Confirmar')
    .setEmoji('📍')
    .setStyle(ButtonStyle.Success)
    .setDisabled(!chosen);

  return {
    content: `${note ? note + '\n' : ''}${chosen
      ? `Setor escolhido: **${formatCoord(draft)}**. Confirme para valer.`
      : 'Escolha a coluna e a linha do seu setor inicial.'}`,
    components: [
      new ActionRowBuilder().addComponents(colMenu),
      new ActionRowBuilder().addComponents(rowMenu),
      new ActionRowBuilder().addComponents(confirm),
    ],
  };
}

// Os dois escolheram: revela as posições e começa o combate
async function startCombat(battle) {
  battle.phase = 'combat';
  await battle.message.edit(asEdit({
    ...(await panelPayload(battle, 'Posições definidas!')),
    components: [],
  }));
  battle.message = await battle.message.channel.send({
    content: `<@${currentPlayer(battle).id}>, é a sua vez!`,
    ...(await panelPayload(battle, 'A batalha começou!')),
  });
}

async function handlePlacement(interaction) {
  const battle = getBattle(interaction.channelId);
  if (!battle) return ephemeral(interaction, 'Esta batalha não está mais ativa.');
  const me = findPlayer(battle, interaction.user.id);
  if (!me) return ephemeral(interaction, 'Você não está nessa batalha.');
  if (battle.phase !== 'placement') return ephemeral(interaction, 'O posicionamento já terminou.');

  const kind = interaction.customId.split(':')[1];

  if (kind === 'open') {
    if (me.pos) battle.drafts.set(me.id, { ...me.pos }); // já escolhido: começa a partir da posição atual
    return interaction.reply({ ...chooserPayload(battle, me.id), ephemeral: true });
  }

  if (kind === 'col' || kind === 'row') {
    const draft = battle.drafts.get(me.id) ?? {};
    draft[kind] = Number(interaction.values[0]);
    battle.drafts.set(me.id, draft);
    return interaction.update(chooserPayload(battle, me.id));
  }

  if (kind === 'ok') {
    const draft = battle.drafts.get(me.id);
    if (!draft || draft.col === undefined || draft.row === undefined) {
      return interaction.update(chooserPayload(battle, me.id, '⚠️ Escolha a coluna e a linha primeiro.'));
    }
    const result = placePlayer(battle, me, { col: draft.col, row: draft.row });
    if (result.error) return interaction.update(chooserPayload(battle, me.id, `⚠️ ${result.error}`));

    if (!allPlaced(battle)) {
      await interaction.update({
        content: `✅ Você começará em **${formatCoord(me.pos)}**. Aguardando o oponente escolher. Para trocar antes disso, clique em "Escolher setor" de novo.`,
        components: [],
      });
      return battle.message.edit(asEdit(await panelPayload(battle, `${me.name} escolheu o setor inicial.`)));
    }

    await interaction.update({ content: `✅ Você começará em **${formatCoord(me.pos)}**.`, components: [] });
    return startCombat(battle);
  }
}

module.exports = { handlePlacement };
