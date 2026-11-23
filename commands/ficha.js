const { SlashCommandBuilder } = require('discord.js');
const { getSetting } = require('../src/settings');
const { startFicha } = require('../src/ficha');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ficha')
    .setDescription('Cria (ou refaz) a ficha do seu personagem: nome, idade e aparência'),

  async execute(interaction) {
    const channelId = getSetting('fichaChannelId');
    if (channelId && interaction.channelId !== channelId) {
      return interaction.reply({ content: `A criação de ficha acontece em <#${channelId}>.`, ephemeral: true });
    }
    return startFicha(interaction);
  },
};
