const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Responde com Pong! e a latência do bot'),
  async execute(interaction) {
    const sent = await interaction.reply({ content: 'Pong! 🏓', fetchReply: true });
    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    await interaction.editReply(`Pong! 🏓 Latência: ${latency}ms | API: ${Math.round(interaction.client.ws.ping)}ms`);
  },
};
