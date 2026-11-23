const {
  SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder,
} = require('discord.js');
const C = require('../src/combat/config');
const { getProfile, save } = require('../src/combat/profiles');
const { ATTRIBUTES, xpToNext, maxHp, maxMana, maxEnergy, roomFor } = require('../src/combat/progression');
const { getBattle, findPlayer } = require('../src/combat/battle');

const bar = (value, max, size = 10) => {
  const filled = Math.round((value / max) * size);
  return '▰'.repeat(filled) + '▱'.repeat(size - filled);
};

function sheetPayload(name, profile, ephemeral) {
  const { level, xp, points, attrs } = profile;
  const xpLine = level >= C.MAX_LEVEL
    ? '**Nível máximo!**'
    : `${bar(xp, xpToNext(level))} ${xp}/${xpToNext(level)} XP`;
  const attrLines = Object.entries(ATTRIBUTES)
    .map(([key, label]) => `${label}: **${attrs[key]}**`)
    .join('\n');

  const container = new ContainerBuilder()
    .setAccentColor(C.EMBED_COLOR)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## Ficha de ${name}\n**Nível ${level}** · ${xpLine}`))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `❤️ Vida: **${maxHp(level)}**\n🔷 Mana: **${maxMana(level)}**\n⚡ Energia: **${maxEnergy(level)}**`,
    ))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `${attrLines}\n\n🎯 Pontos para distribuir: **${points}**`,
    ));
  const flags = MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0);
  return { components: [container], flags };
}

const fail = (interaction, content) => interaction.reply({ content, ephemeral: true });

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ficha')
    .setDescription('Veja sua ficha ou distribua seus pontos de atributo')
    .addSubcommand(s => s
      .setName('ver')
      .setDescription('Mostra a ficha de um jogador')
      .addUserOption(o => o.setName('jogador').setDescription('De quem (padrão: você)')))
    .addSubcommand(s => s
      .setName('distribuir')
      .setDescription('Gasta pontos em um atributo (não dá para desfazer)')
      .addStringOption(o => o
        .setName('atributo')
        .setDescription('Qual atributo aumentar')
        .setRequired(true)
        .addChoices(...Object.entries(ATTRIBUTES).map(([value, name]) => ({ name, value }))))
      .addIntegerOption(o => o
        .setName('pontos')
        .setDescription('Quantos pontos gastar')
        .setRequired(true)
        .setMinValue(1))),

  async execute(interaction) {
    if (interaction.options.getSubcommand() === 'ver') {
      const user = interaction.options.getUser('jogador') ?? interaction.user;
      const name = interaction.guild?.members.cache.get(user.id)?.displayName ?? user.displayName ?? user.username;
      return interaction.reply(sheetPayload(name, getProfile(user.id), false));
    }

    // distribuir
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
    const name = interaction.member?.displayName ?? interaction.user.displayName;
    return interaction.reply(sheetPayload(name, profile, true));
  },
};
