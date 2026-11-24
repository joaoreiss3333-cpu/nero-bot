const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getProfile, save } = require('../src/combat/profiles');
const { grimoires, getGrimoire, RARITIES } = require('../src/combat/grimoires');
const { abilities } = require('../src/combat/abilities');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('grimorio')
    .setDescription('Staff: define o grimório de um jogador')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(o => o.setName('jogador').setDescription('Quem recebe o grimório').setRequired(true))
    .addStringOption(o => o.setName('grimorio').setDescription('Qual grimório (ou "Nenhum" para remover)').setRequired(true).setAutocomplete(true)),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const choices = [{ name: 'Nenhum (remover)', value: 'nenhum' }, ...Object.values(grimoires).map(g => ({
      name: `${g.name} (${RARITIES[g.rarity].name})`, value: g.id,
    }))].filter(c => c.name.toLowerCase().includes(focused));
    await interaction.respond(choices.slice(0, 25));
  },

  async execute(interaction) {
    const user = interaction.options.getUser('jogador');
    const id = interaction.options.getString('grimorio');
    const profile = getProfile(user.id);

    if (id === 'nenhum') {
      delete profile.grimoire;
      save();
      return interaction.reply({ content: `${user} ficou sem grimório.`, allowedMentions: { users: [] } });
    }
    const grimoire = getGrimoire(id);
    if (!grimoire) return interaction.reply({ content: 'Grimório não encontrado. Escolha um da lista.', ephemeral: true });

    profile.grimoire = grimoire.id;
    save();
    const spells = Object.values(abilities).filter(a => a.grimoire === grimoire.id);
    const list = spells.length
      ? `Magias: ${spells.map(a => `**${a.name}**`).join(', ')} (aparecem quando o jogador tiver os pontos de atributo exigidos).`
      : 'Esse grimório ainda não tem magias cadastradas.';
    return interaction.reply({
      content: `📖 ${user} agora possui o grimório de **${grimoire.name}** (${RARITIES[grimoire.rarity].name}).\n${list}`,
      allowedMentions: { users: [] },
    });
  },
};
