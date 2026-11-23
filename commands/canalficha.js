const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { setSetting } = require('../src/settings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('canalficha')
    .setDescription('Staff: define este canal como o canal de criação de ficha (/ficha só funciona nele)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    setSetting('fichaChannelId', interaction.channelId);
    return interaction.reply({ content: `✅ O comando \`/ficha\` agora só funciona em ${interaction.channel}.`, ephemeral: true });
  },
};
