const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getParty, addMember } = require('./parties');
const { PARTY_INVITE_TIMEOUT_MS } = require('./config');

const invites = new Map(); // id da mensagem do convite -> { partyId, inviteeId, inviterName, timer }

const row = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('pt:accept').setLabel('Entrar').setEmoji('🤝').setStyle(ButtonStyle.Success),
  new ButtonBuilder().setCustomId('pt:decline').setLabel('Recusar').setStyle(ButtonStyle.Danger),
);

// Manda o convite no canal. `party` é a party de quem convidou; `invitee` é o usuário do Discord convidado.
async function sendInvite(interaction, party, invitee) {
  await interaction.reply({
    content: `🤝 <@${invitee.id}>, <@${interaction.user.id}> convidou você para a party!`,
    components: [row()],
    allowedMentions: { users: [invitee.id] },
  });
  const message = await interaction.fetchReply();
  const timer = setTimeout(() => {
    invites.delete(message.id);
    message.edit({ content: `⌛ O convite de party para <@${invitee.id}> expirou.`, components: [], allowedMentions: { parse: [] } }).catch(() => {});
  }, PARTY_INVITE_TIMEOUT_MS);
  invites.set(message.id, { partyId: party.id, leaderId: party.leaderId, inviteeId: invitee.id, timer });
}

async function handlePartyInvite(interaction) {
  const invite = invites.get(interaction.message.id);
  if (!invite) return interaction.reply({ content: 'Este convite não está mais ativo.', ephemeral: true });
  if (interaction.user.id !== invite.inviteeId) return interaction.reply({ content: 'Esse convite não é para você.', ephemeral: true });

  clearTimeout(invite.timer);
  invites.delete(interaction.message.id);
  const mentions = { parse: [] };

  if (interaction.customId === 'pt:decline') {
    return interaction.update({ content: `❌ <@${invite.inviteeId}> recusou o convite de party.`, components: [], allowedMentions: mentions });
  }
  // A party pode ter mudado de líder ou acabado desde o convite
  const party = getParty(invite.leaderId);
  if (!party) return interaction.update({ content: '❌ Essa party não existe mais.', components: [], allowedMentions: mentions });
  const result = addMember(party, invite.inviteeId);
  if (result.error) return interaction.update({ content: `❌ ${result.error}`, components: [], allowedMentions: mentions });
  return interaction.update({
    content: `✅ <@${invite.inviteeId}> entrou na party de <@${party.leaderId}> (${party.members.length} jogador(es)).`,
    components: [], allowedMentions: mentions,
  });
}

module.exports = { sendInvite, handlePartyInvite };
