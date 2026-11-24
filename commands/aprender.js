const { SlashCommandBuilder } = require('discord.js');
const { getProfile, save } = require('../src/combat/profiles');
const { getAbility, TYPE_LABEL } = require('../src/combat/abilities');
const { grimoireTree, learnBlocker, nextStep, learnCost } = require('../src/combat/characters');
const { getBattle, findPlayer } = require('../src/combat/battle');

const fail = (interaction, content) => interaction.reply({ content, ephemeral: true });

module.exports = {
  data: new SlashCommandBuilder()
    .setName('aprender')
    .setDescription('Gasta pontos de habilidade para aprender uma magia do grimório ou subir o rank dela')
    .addStringOption(o => o
      .setName('magia')
      .setDescription('Qual magia aprender ou evoluir')
      .setRequired(true)
      .setAutocomplete(true)),

  // Lista as magias da árvore que ainda têm o que comprar (aprender ou próximo rank), marcando as que já dá para comprar
  async autocomplete(interaction) {
    const profile = getProfile(interaction.user.id);
    const focused = interaction.options.getFocused().toLowerCase();
    const choices = grimoireTree(profile)
      .map(a => ({ a, step: nextStep(profile, a) }))
      .filter(({ a, step }) => step && a.name.toLowerCase().includes(focused))
      .map(({ a, step }) => ({
        name: `${learnBlocker(profile, a) ? '🔒' : '✅'} ${a.name} ${step.rank === 1 ? `(${TYPE_LABEL[a.type]})` : `→ rank ${step.rank}`} · ${learnCost(a, step.rank)} pt`,
        value: a.id,
      }));
    await interaction.respond(choices.slice(0, 25));
  },

  async execute(interaction) {
    const battle = getBattle(interaction.channelId);
    if (battle && findPlayer(battle, interaction.user.id)) return fail(interaction, 'Você não pode aprender magias no meio de uma batalha.');
    const profile = getProfile(interaction.user.id);
    if (!profile.grimoire) return fail(interaction, 'Você ainda não tem um grimório. Peça à staff para definir o seu.');
    const ability = getAbility(interaction.options.getString('magia'));
    if (!ability) return fail(interaction, 'Magia não encontrada.');
    const blocker = learnBlocker(profile, ability);
    if (blocker) return fail(interaction, `❌ Você não pode comprar **${ability.name}** agora: ${blocker}.`);

    const { rank } = nextStep(profile, ability);
    const cost = learnCost(ability, rank);
    profile.skillPoints -= cost;
    if (rank === 1) profile.learned.push(ability.id);
    profile.ranks[ability.id] = rank;
    save();
    return interaction.reply({
      content: rank === 1
        ? `📖 Você aprendeu **${ability.name}** (-${cost} pt)! Ela já está no seu kit. Pontos de habilidade restantes: **${profile.skillPoints}**.`
        : `⬆️ **${ability.name}** evoluiu para o **rank ${rank}** (-${cost} pt)! Pontos de habilidade restantes: **${profile.skillPoints}**.`,
      ephemeral: true,
    });
  },
};
