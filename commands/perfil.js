const { SlashCommandBuilder, MessageFlags, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder } = require('discord.js');
const { EMBED_COLOR } = require('../src/combat/config');
const { getProfile } = require('../src/combat/profiles');
const { profileAttachment } = require('../src/combat/profileView');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('perfil')
    .setDescription('Mostra o perfil de um personagem')
    .addUserOption(o => o.setName('jogador').setDescription('De quem (padrão: você)')),

  async execute(interaction) {
    await interaction.deferReply(); // baixar as imagens e desenhar pode passar de 3s
    const user = interaction.options.getUser('jogador') ?? interaction.user;
    const member = interaction.guild?.members.cache.get(user.id);
    if (!getProfile(user.id).name) {
      const msg = user.id === interaction.user.id
        ? 'Você ainda não tem um perfil. Crie a sua ficha com `/ficha` primeiro.'
        : `${user.displayName} ainda não criou a ficha.`;
      return interaction.editReply({ content: msg });
    }

    const container = new ContainerBuilder()
      .setAccentColor(EMBED_COLOR)
      .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://perfil.png')));
    return interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      files: [await profileAttachment(user, member)],
    });
  },
};
