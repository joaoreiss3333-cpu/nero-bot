const {
  SlashCommandBuilder, MessageFlags, AttachmentBuilder, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder,
} = require('discord.js');
const { loadImage } = require('@napi-rs/canvas');
const { EMBED_COLOR, MAX_LEVEL } = require('../src/combat/config');
const { getProfile } = require('../src/combat/profiles');
const { renderProfileImage } = require('../src/combat/profileImage');
const { xpToNext } = require('../src/combat/progression');

// Imagem opcional: se a URL falhar, o perfil sai com o espaço padrão em vez de dar erro
const tryLoad = async url => {
  if (!url) return null;
  try { return await loadImage(url); } catch { return null; }
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('perfil')
    .setDescription('Mostra o perfil de um personagem')
    .addUserOption(o => o.setName('jogador').setDescription('De quem (padrão: você)')),

  async execute(interaction) {
    await interaction.deferReply(); // baixar as imagens e desenhar pode passar de 3s
    const user = interaction.options.getUser('jogador') ?? interaction.user;
    const member = interaction.guild?.members.cache.get(user.id);
    const profile = getProfile(user.id);

    // Enquanto a criação de ficha não existe: nome = apelido no servidor, idade desconhecida,
    // foto = avatar do Discord e sem grimório. Quando a ficha guardar `name`, `age`, `portraitUrl`
    // e `grimoireUrl` no perfil, eles passam a valer automaticamente.
    const png = await renderProfileImage({
      name: profile.name ?? member?.displayName ?? user.displayName ?? user.username,
      age: profile.age ?? null,
      level: profile.level,
      xp: profile.xp,
      xpNext: profile.level >= MAX_LEVEL ? null : xpToNext(profile.level),
      points: profile.points,
      attrs: profile.attrs,
      portrait: await tryLoad(profile.portraitUrl ?? user.displayAvatarURL({ extension: 'png', size: 512 })),
      grimoire: await tryLoad(profile.grimoireUrl),
    });

    const container = new ContainerBuilder()
      .setAccentColor(EMBED_COLOR)
      .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://perfil.png')));
    return interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      files: [new AttachmentBuilder(png, { name: 'perfil.png' })],
    });
  },
};
