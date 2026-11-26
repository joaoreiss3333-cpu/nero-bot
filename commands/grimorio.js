const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getProfile, save } = require('../src/combat/profiles');
const { grimoires, getGrimoire, RARITIES } = require('../src/combat/grimoires');
const { abilities } = require('../src/combat/abilities');
const { treeHint } = require('../src/web/links');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('grimorio')
    .setDescription('Staff: define o grimório de um jogador')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(o => o.setName('jogador').setDescription('Quem recebe o grimório').setRequired(true))
    .addStringOption(o => o.setName('grimorio').setDescription('Qual grimório (ou "Nenhum" para remover)').setRequired(true).setAutocomplete(true)),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    // O Discord mostra no máximo 25 opções: os grimórios que já têm magias vêm primeiro, depois do mais raro ao mais comum
    const rarityOrder = Object.keys(RARITIES).reverse();
    const hasSpells = g => Object.values(abilities).some(a => a.grimoire === g.id);
    const sorted = Object.values(grimoires).sort((a, b) =>
      (hasSpells(b) - hasSpells(a)) || (rarityOrder.indexOf(a.rarity) - rarityOrder.indexOf(b.rarity)));
    const choices = [...sorted.map(g => ({
      name: `${g.name} (${RARITIES[g.rarity].name})${hasSpells(g) ? ' ✨' : ''}`, value: g.id,
    })), { name: 'Nenhum (remover)', value: 'nenhum' }].filter(c => c.name.toLowerCase().includes(focused));
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
      ? `Magias: ${spells.map(a => `**${a.name}**`).join(', ')} (compradas com pontos de habilidade ${treeHint()}).`
      : 'Esse grimório ainda não tem magias cadastradas.';
    return interaction.reply({
      content: `📖 ${user} agora possui o grimório de **${grimoire.name}** (${RARITIES[grimoire.rarity].name}).\n${list}`,
      allowedMentions: { users: [] },
    });
  },
};
