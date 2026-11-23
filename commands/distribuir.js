const { SlashCommandBuilder } = require('discord.js');
const C = require('../src/combat/config');
const { getProfile, save } = require('../src/combat/profiles');
const { ATTRIBUTES, roomFor } = require('../src/combat/progression');
const { getBattle, findPlayer } = require('../src/combat/battle');

const fail = (interaction, content) => interaction.reply({ content, ephemeral: true });

module.exports = {
  data: new SlashCommandBuilder()
    .setName('distribuir')
    .setDescription('Gasta seus pontos de atributo (não dá para desfazer). Veja o resultado no /perfil')
    .addStringOption(o => o
      .setName('atributo')
      .setDescription('Qual atributo aumentar')
      .setRequired(true)
      .addChoices(...Object.entries(ATTRIBUTES).map(([value, name]) => ({ name, value }))))
    .addIntegerOption(o => o
      .setName('pontos')
      .setDescription('Quantos pontos gastar')
      .setRequired(true)
      .setMinValue(1)),

  async execute(interaction) {
    const battle = getBattle(interaction.channelId);
    if (battle && findPlayer(battle, interaction.user.id)) {
      return fail(interaction, 'Você não pode distribuir pontos no meio de uma batalha.');
    }
    const profile = getProfile(interaction.user.id);
    const attr = interaction.options.getString('atributo');
    const amount = interaction.options.getInteger('pontos');
    if (amount > profile.points) return fail(interaction, `Você só tem **${profile.points}** ponto(s) para distribuir.`);
    if (amount > roomFor(profile, attr)) {
      return fail(interaction, `${ATTRIBUTES[attr]} não pode passar de ${C.ATTRIBUTE_CAP} (você tem ${profile.attrs[attr]}).`);
    }

    profile.points -= amount;
    profile.attrs[attr] += amount;
    save();
    return interaction.reply({
      content: `✅ **${ATTRIBUTES[attr]}** subiu para **${profile.attrs[attr]}** (-${amount} ponto${amount > 1 ? 's' : ''}). Pontos restantes: **${profile.points}**.`,
      ephemeral: true,
    });
  },
};
