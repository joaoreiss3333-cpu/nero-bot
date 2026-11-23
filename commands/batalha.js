const { SlashCommandBuilder } = require('discord.js');
const { createBattle, getBattle, endBattle, currentPlayer } = require('../src/combat/battle');
const { panelPayload } = require('../src/combat/render');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('batalha')
    .setDescription('Sistema de combate')
    .addSubcommand(s => s
      .setName('iniciar')
      .setDescription('Inicia uma batalha contra outro jogador')
      .addUserOption(o => o.setName('oponente').setDescription('Quem você quer enfrentar').setRequired(true)))
    .addSubcommand(s => s.setName('encerrar').setDescription('Encerra a batalha deste canal')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const battle = getBattle(interaction.channelId);

    if (sub === 'iniciar') {
      const opponent = interaction.options.getUser('oponente');
      if (battle) return interaction.reply({ content: 'Já existe uma batalha neste canal.', ephemeral: true });
      if (opponent.bot) return interaction.reply({ content: 'Você não pode lutar contra um bot.', ephemeral: true });
      if (opponent.id === interaction.user.id) return interaction.reply({ content: 'Você não pode lutar contra si mesmo.', ephemeral: true });

      const nameOf = u => interaction.guild?.members.cache.get(u.id)?.displayName ?? u.displayName ?? u.username;
      const b = createBattle(
        interaction.channelId,
        { id: interaction.user.id, name: nameOf(interaction.user) },
        { id: opponent.id, name: nameOf(opponent) },
      );
      b.message = await interaction.reply({
        content: `<@${currentPlayer(b).id}> começa! (sorteio de iniciativa)`,
        ...panelPayload(b, 'A batalha começou!'),
        fetchReply: true,
      });
      return;
    }

    // encerrar
    if (!battle) return interaction.reply({ content: 'Não há batalha neste canal.', ephemeral: true });
    if (!battle.players.some(p => p.id === interaction.user.id)) {
      return interaction.reply({ content: 'Só os participantes podem encerrar a batalha.', ephemeral: true });
    }
    endBattle(battle);
    await battle.message?.edit({ components: [] }).catch(() => {});
    return interaction.reply('🏳️ A batalha foi encerrada.');
  },
};
