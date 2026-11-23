const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { getBattle, findPlayer, placePlayer, allPlaced } = require('./battle');
const { panelPayload, asEdit } = require('./render');
const { parseCoord, formatCoord } = require('./grid');
const { COLUMNS, ROWS } = require('./config');

const ephemeral = (interaction, content) => interaction.reply({ content, ephemeral: true });

const formatHint = `colunas ${COLUMNS[0]}-${COLUMNS.at(-1)}, linhas 1-${ROWS}`;

// Os dois escolheram: revela as posições e começa o combate
async function startCombat(battle) {
  battle.phase = 'combat';
  await battle.message.edit(asEdit({
    ...(await panelPayload(battle, 'Posições definidas!')),
    components: [],
  }));
  battle.message = await battle.message.channel.send(await panelPayload(battle, 'A batalha começou!'));
}

async function handlePlacement(interaction) {
  const battle = getBattle(interaction.channelId);
  if (!battle) return ephemeral(interaction, 'Esta batalha não está mais ativa.');
  const me = findPlayer(battle, interaction.user.id);
  if (!me) return ephemeral(interaction, 'Você não está nessa batalha.');
  if (battle.phase !== 'placement') return ephemeral(interaction, 'O posicionamento já terminou.');

  const kind = interaction.customId.split(':')[1];

  // Botão "Escolher setor": abre um campo para digitar o setor direto (ex: C3)
  if (kind === 'open') {
    const input = new TextInputBuilder()
      .setCustomId('setor')
      .setLabel('Setor inicial (ex: C3)')
      .setStyle(TextInputStyle.Short)
      .setMinLength(2)
      .setMaxLength(3)
      .setPlaceholder('C3')
      .setRequired(true);
    if (me.pos) input.setValue(formatCoord(me.pos)); // já escolhido: mostra a posição atual
    return interaction.showModal(
      new ModalBuilder()
        .setCustomId('pl:modal')
        .setTitle('Escolher setor inicial')
        .addComponents(new ActionRowBuilder().addComponents(input)),
    );
  }

  if (kind === 'modal') {
    const pos = parseCoord(interaction.fields.getTextInputValue('setor'));
    if (!pos) return ephemeral(interaction, `Setor inválido. Use algo como \`C3\` (${formatHint}). Clique em "Escolher setor" para tentar de novo.`);

    const result = placePlayer(battle, me, pos);
    if (result.error) return ephemeral(interaction, `${result.error} Clique em "Escolher setor" para tentar de novo.`);

    if (!allPlaced(battle)) {
      await ephemeral(interaction, `✅ Você começará em **${formatCoord(pos)}**. Para trocar antes do oponente escolher, clique em "Escolher setor" de novo.`);
      return battle.message.edit(asEdit(await panelPayload(battle, `${me.name} escolheu o setor inicial.`)));
    }

    await ephemeral(interaction, `✅ Você começará em **${formatCoord(pos)}**.`);
    return startCombat(battle);
  }
}

module.exports = { handlePlacement };
