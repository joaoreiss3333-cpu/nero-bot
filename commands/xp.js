const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const C = require('../src/combat/config');
const { getProfile, save } = require('../src/combat/profiles');
const { addXp, xpToNext } = require('../src/combat/progression');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('xp')
    .setDescription('Staff: dá XP a um jogador')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(o => o.setName('jogador').setDescription('Quem recebe o XP').setRequired(true))
    .addIntegerOption(o => o.setName('quantidade').setDescription('Quanto XP dar').setRequired(true).setMinValue(1)),

  async execute(interaction) {
    const user = interaction.options.getUser('jogador');
    const amount = interaction.options.getInteger('quantidade');
    const profile = getProfile(user.id);
    if (profile.level >= C.MAX_LEVEL) {
      return interaction.reply({ content: `${user} já está no nível máximo (${C.MAX_LEVEL}).`, ephemeral: true });
    }

    const { from, to, gainedPoints, gainedSkillPoints } = addXp(profile, amount);
    save();

    const progress = to >= C.MAX_LEVEL ? 'nível máximo' : `${profile.xp}/${xpToNext(to)} XP para o próximo nível`;
    const levelUp = to > from ? `\n🎉 Subiu do nível **${from}** para o **${to}** e ganhou **${gainedPoints}** ponto(s) de atributo (\`/distribuir\`)${gainedSkillPoints ? ` e **${gainedSkillPoints}** ponto(s) de habilidade (\`/aprender\`)` : ''}!` : '';
    return interaction.reply({
      content: `✨ ${user} recebeu **${amount} XP** (${progress}).${levelUp}`,
      allowedMentions: { users: [] }, // sem notificar: o convite do desafio é o único que marca alguém
    });
  },
};
