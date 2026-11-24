const { SlashCommandBuilder } = require('discord.js');
const { getParty, createParty, removeMember, disband } = require('../src/combat/parties');
const { sendInvite } = require('../src/combat/partyInvites');
const { PARTY_MAX_SIZE } = require('../src/combat/config');

const fail = (interaction, content) => interaction.reply({ content, ephemeral: true });
const mentions = { parse: [] }; // nomes na mensagem sem notificar ninguém

module.exports = {
  data: new SlashCommandBuilder()
    .setName('party')
    .setDescription('Grupos para lutar juntos nas batalhas')
    .addSubcommand(s => s.setName('criar').setDescription('Cria uma party (você vira o líder)'))
    .addSubcommand(s => s
      .setName('convidar')
      .setDescription('Convida alguém para a sua party (só o líder)')
      .addUserOption(o => o.setName('jogador').setDescription('Quem convidar').setRequired(true)))
    .addSubcommand(s => s
      .setName('expulsar')
      .setDescription('Tira alguém da party (só o líder)')
      .addUserOption(o => o.setName('jogador').setDescription('Quem expulsar').setRequired(true)))
    .addSubcommand(s => s.setName('sair').setDescription('Sai da sua party'))
    .addSubcommand(s => s.setName('dissolver').setDescription('Desfaz a party (só o líder)'))
    .addSubcommand(s => s.setName('ver').setDescription('Mostra os membros da sua party')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const uid = interaction.user.id;
    const party = getParty(uid);

    if (sub === 'criar') {
      const result = createParty(uid);
      if (result.error) return fail(interaction, result.error);
      return interaction.reply(`🛡️ Party criada! <@${uid}> é o líder. Use \`/party convidar\` para chamar até ${PARTY_MAX_SIZE - 1} aliados.`);
    }

    if (!party) return fail(interaction, 'Você não está em uma party. Use `/party criar`.');
    const isLeader = party.leaderId === uid;

    if (sub === 'ver') {
      const list = party.members.map(id => `${id === party.leaderId ? '👑' : '•'} <@${id}>`).join('\n');
      return interaction.reply({ content: `🛡️ **Party** (${party.members.length}/${PARTY_MAX_SIZE})\n${list}`, allowedMentions: mentions });
    }

    if (sub === 'sair') {
      const result = removeMember(party, uid);
      const extra = result.disbanded ? ' A party acabou.' : result.newLeaderId ? ` <@${result.newLeaderId}> é o novo líder.` : '';
      return interaction.reply({ content: `🚪 <@${uid}> saiu da party.${extra}`, allowedMentions: mentions });
    }

    if (!isLeader) return fail(interaction, 'Só o líder da party pode fazer isso.');

    if (sub === 'dissolver') {
      disband(party);
      return interaction.reply({ content: '💥 A party foi desfeita.', allowedMentions: mentions });
    }

    const target = interaction.options.getUser('jogador');
    if (sub === 'convidar') {
      if (target.bot) return fail(interaction, 'Bots não entram em party.');
      if (target.id === uid) return fail(interaction, 'Você já está na sua party.');
      if (getParty(target.id)) return fail(interaction, 'Essa pessoa já está em uma party.');
      if (party.members.length >= PARTY_MAX_SIZE) return fail(interaction, `A party está cheia (máximo ${PARTY_MAX_SIZE} jogadores).`);
      return sendInvite(interaction, party, target);
    }

    if (sub === 'expulsar') {
      if (target.id === uid) return fail(interaction, 'Para sair use `/party sair`.');
      if (!party.members.includes(target.id)) return fail(interaction, 'Essa pessoa não está na sua party.');
      removeMember(party, target.id);
      return interaction.reply({ content: `🥾 <@${target.id}> foi removido da party.`, allowedMentions: mentions });
    }
  },
};
