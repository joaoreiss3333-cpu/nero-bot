const { SlashCommandBuilder } = require('discord.js');
const { getProfile } = require('../src/combat/profiles');
const { getBattle, endBattle } = require('../src/combat/battle');
const { getChallenge, startChallenge, cancelChallenge } = require('../src/combat/challenge');
const { panelPayload, asEdit } = require('../src/combat/render');

const fail = (interaction, content) => interaction.reply({ content, ephemeral: true });

module.exports = {
  data: new SlashCommandBuilder()
    .setName('batalha')
    .setDescription('Sistema de combate')
    .addSubcommand(s => s
      .setName('iniciar')
      .setDescription('Desafia outro jogador para uma batalha')
      .addUserOption(o => o.setName('oponente').setDescription('Quem você quer enfrentar').setRequired(true)))
    .addSubcommand(s => s.setName('encerrar').setDescription('Encerra a batalha (ou o desafio) deste canal')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const battle = getBattle(interaction.channelId);
    const challenge = getChallenge(interaction.channelId);

    if (sub === 'iniciar') {
      const opponent = interaction.options.getUser('oponente');
      if (battle || challenge) return fail(interaction, 'Já existe uma batalha ou um desafio pendente neste canal.');
      if (opponent.bot) return fail(interaction, 'Você não pode lutar contra um bot.');
      if (opponent.id === interaction.user.id) return fail(interaction, 'Você não pode lutar contra si mesmo.');

      // Nome e aparência vêm da ficha; sem ficha, usa o apelido e o avatar do Discord
      const describe = u => {
        const profile = getProfile(u.id);
        return {
          id: u.id,
          name: profile.name ?? interaction.guild?.members.cache.get(u.id)?.displayName ?? u.displayName ?? u.username,
          avatarUrl: profile.portraitUrl ?? u.displayAvatarURL({ extension: 'png', size: 128 }), // portraitUrl é o caminho do arquivo salvo
        };
      };
      return startChallenge(interaction, describe(interaction.user), describe(opponent));
    }

    // encerrar
    if (battle) {
      if (!battle.players.some(p => p.id === interaction.user.id)) return fail(interaction, 'Só os participantes podem encerrar a batalha.');
      endBattle(battle);
      await battle.message?.edit(asEdit(await panelPayload(battle, '🏳️ A batalha foi encerrada.', { frozen: true }))).catch(() => {});
      return interaction.reply('🏳️ A batalha foi encerrada.');
    }
    if (challenge) {
      const { challenger, opponent } = challenge;
      if (![challenger.id, opponent.id].includes(interaction.user.id)) return fail(interaction, 'Só quem está no desafio pode cancelá-lo.');
      await cancelChallenge(interaction.channelId, '🏳️ O desafio foi cancelado.');
      return interaction.reply({ content: 'Desafio cancelado.', ephemeral: true });
    }
    return fail(interaction, 'Não há batalha nem desafio neste canal.');
  },
};
