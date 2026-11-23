const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createBattle } = require('./battle');
const { panelPayload, asEdit } = require('./render');
const { loadAvatar } = require('./image');
const { CHALLENGE_TIMEOUT_MS } = require('./config');

const challenges = new Map(); // channelId -> { challenger, opponent, message, timer }

const getChallenge = channelId => challenges.get(channelId);

const ephemeral = (interaction, content) => interaction.reply({ content, ephemeral: true });

const row = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('ch:accept').setLabel('Aceitar').setEmoji('⚔️').setStyle(ButtonStyle.Success),
  new ButtonBuilder().setCustomId('ch:decline').setLabel('Recusar').setStyle(ButtonStyle.Danger),
  new ButtonBuilder().setCustomId('ch:cancel').setLabel('Cancelar desafio').setStyle(ButtonStyle.Secondary),
);

// challenger/opponent: { id, name, avatarUrl }
async function startChallenge(interaction, challenger, opponent) {
  await interaction.reply({
    content: `⚔️ <@${challenger.id}> desafiou <@${opponent.id}> para uma batalha!\n<@${opponent.id}>, você aceita?`,
    components: [row()],
  });
  const message = await interaction.fetchReply();

  const challenge = { challenger, opponent, message, timer: null };
  challenge.timer = setTimeout(() => {
    challenges.delete(interaction.channelId);
    message.edit({ content: `⌛ O desafio de ${challenger.name} para ${opponent.name} expirou.`, components: [] }).catch(() => {});
  }, CHALLENGE_TIMEOUT_MS);
  challenges.set(interaction.channelId, challenge);
}

// Cancela o desafio pendente do canal (usado por /batalha encerrar)
async function cancelChallenge(channelId, content) {
  const ch = challenges.get(channelId);
  if (!ch) return;
  clearTimeout(ch.timer);
  challenges.delete(channelId);
  await ch.message.edit({ content, components: [] }).catch(() => {});
}

async function handleChallenge(interaction) {
  const ch = challenges.get(interaction.channelId);
  if (!ch || ch.message.id !== interaction.message.id) {
    return ephemeral(interaction, 'Este desafio não está mais ativo.');
  }
  const kind = interaction.customId.split(':')[1];
  const uid = interaction.user.id;

  if (kind === 'cancel') {
    if (uid !== ch.challenger.id) return ephemeral(interaction, 'Só quem fez o desafio pode cancelá-lo.');
    clearTimeout(ch.timer);
    challenges.delete(interaction.channelId);
    return interaction.update({ content: `🏳️ ${ch.challenger.name} cancelou o desafio.`, components: [] });
  }

  if (uid !== ch.opponent.id) return ephemeral(interaction, `Só ${ch.opponent.name} pode responder a este desafio.`);

  if (kind === 'decline') {
    clearTimeout(ch.timer);
    challenges.delete(interaction.channelId);
    return interaction.update({ content: `❌ ${ch.opponent.name} recusou o desafio de ${ch.challenger.name}.`, components: [] });
  }

  if (kind === 'accept') {
    clearTimeout(ch.timer);
    challenges.delete(interaction.channelId);
    await interaction.deferUpdate(); // baixar avatares e desenhar a imagem pode passar de 3s

    const battle = createBattle(interaction.channelId, ch.challenger, ch.opponent);
    [battle.players[0].avatar, battle.players[1].avatar] = await Promise.all([
      loadAvatar(ch.challenger.avatarUrl),
      loadAvatar(ch.opponent.avatarUrl),
    ]);
    battle.message = await interaction.editReply(asEdit(await panelPayload(
      battle,
      'Cada jogador escolhe o setor inicial. O combate começa quando os dois estiverem prontos.',
      `<@${ch.challenger.id}> <@${ch.opponent.id}>, desafio aceito! Escolham onde querem começar.`,
    )));
  }
}

module.exports = { startChallenge, cancelChallenge, getChallenge, handleChallenge };
