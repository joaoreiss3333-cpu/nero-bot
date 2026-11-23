const fs = require('fs');
const {
  SlashCommandBuilder, MessageFlags, AttachmentBuilder, ContainerBuilder, TextDisplayBuilder, SectionBuilder,
  ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize,
} = require('discord.js');
const { EMBED_COLOR } = require('../src/combat/config');
const { getProfile } = require('../src/combat/profiles');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('historia')
    .setDescription('Mostra a história de um personagem')
    .addUserOption(o => o.setName('jogador').setDescription('De quem (padrão: você)')),

  async execute(interaction) {
    const user = interaction.options.getUser('jogador') ?? interaction.user;
    const profile = getProfile(user.id);
    if (!profile.name || !profile.story) {
      const who = user.id === interaction.user.id ? 'Você ainda não tem' : `${user.displayName} ainda não tem`;
      return interaction.reply({ content: `${who} uma história. Crie a ficha com \`/ficha\`.`, ephemeral: true });
    }

    // Retrato da ficha (arquivo salvo) ou, sem ele, o avatar do Discord
    const files = [];
    let thumb = user.displayAvatarURL({ extension: 'png', size: 256 });
    if (profile.portraitUrl && fs.existsSync(profile.portraitUrl)) {
      files.push(new AttachmentBuilder(profile.portraitUrl, { name: 'retrato.png' }));
      thumb = 'attachment://retrato.png';
    }

    const container = new ContainerBuilder().setAccentColor(EMBED_COLOR)
      .addSectionComponents(new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# 📖 História de ${profile.name}\n${profile.age} anos`))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumb)))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(profile.story));
    return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2, files, allowedMentions: { parse: [] } });
  },
};
