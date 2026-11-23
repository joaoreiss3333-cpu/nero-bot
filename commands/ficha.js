const { SlashCommandBuilder } = require('discord.js');
const { getSetting } = require('../src/settings');
const { getProfile } = require('../src/combat/profiles');
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
    if (getProfile(interaction.user.id).name) {
      return interaction.reply({ content: 'Você já criou a sua ficha e ela não pode ser refeita. Veja-a com `/perfil`.', ephemeral: true });
    }
    return startFicha(interaction);
  },
};
