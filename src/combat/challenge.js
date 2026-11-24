const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createBattle } = require('./battle');
const { panelPayload, asEdit } = require('./render');
const { loadAvatar } = require('./image');
const { CHALLENGE_TIMEOUT_MS } = require('./config');

// channelId -> { challenger, opponent, sideA, sideB, message, timer }
// challenger/opponent: quem fala por cada lado (o líder da party ou o jogador sozinho); sideA/sideB: todos que lutam em cada time
const challenges = new Map();

const getChallenge = channelId => challenges.get(channelId);

const ephemeral = (interaction, content) => interaction.reply({ content, ephemeral: true });

const row = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('ch:accept').setLabel('Aceitar').setEmoji('⚔️').setStyle(ButtonStyle.Success),
  new ButtonBuilder().setCustomId('ch:decline').setLabel('Recusar').setStyle(ButtonStyle.Danger),
  new ButtonBuilder().setCustomId('ch:cancel').setLabel('Cancelar desafio').setStyle(ButtonStyle.Secondary),
);

const sideText = side => (side.length > 1 ? `a party de <@${side[0].id}> (${side.map(p => p.name).join(', ')})` : `<@${side[0].id}>`);

// sideA/sideB: listas de { id, name, avatarUrl }. O primeiro de cada lista é quem fala pelo lado (o líder da party).
async function startChallenge(interaction, sideA, sideB) {
  const challenger = sideA[0];
  const opponent = sideB[0];
  await interaction.reply({
    content: `⚔️ ${sideText(sideA)} desafiou ${sideText(sideB)} para uma batalha de ${sideA.length}v${sideB.length}!\n<@${opponent.id}>, você aceita?`,
    components: [row()],
    allowedMentions: { users: [opponent.id] },
  });
  const message = await interaction.fetchReply();

  const challenge = { challenger, opponent, sideA, sideB, message, timer: null };
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

    const battle = createBattle(interaction.channelId, ch.sideA, ch.sideB);
    await Promise.all(battle.players.map(async p => { p.avatar = await loadAvatar(p.avatarUrl); }));
    battle.message = await interaction.editReply(asEdit(await panelPayload(
      battle,
      'Desafio aceito! Cada jogador escolhe o setor inicial. O combate começa quando todos estiverem prontos.',
    )));
  }
}

module.exports = { startChallenge, cancelChallenge, getChallenge, handleChallenge };
