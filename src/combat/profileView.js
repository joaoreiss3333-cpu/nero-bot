// Monta a imagem do perfil de um jogador (usada pelo /perfil e ao terminar a criação de ficha).
const { AttachmentBuilder } = require('discord.js');
const { loadImage } = require('@napi-rs/canvas');
const { MAX_LEVEL } = require('./config');
const { getProfile } = require('./profiles');
const { renderProfileImage } = require('./profileImage');
const { xpToNext } = require('./progression');
const { getGrimoire, RARITIES } = require('./grimoires');
const fs = require('fs');
const path = require('path');

// Foto do grimório: assets/grimoires/<id>.(png|jpg|jpeg|webp); sem arquivo, a imagem desenha uma capa padrão
const GRIMOIRE_DIR = path.join(__dirname, '..', '..', 'assets', 'grimoires');
function grimoireImagePath(id) {
  for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
    const file = path.join(GRIMOIRE_DIR, `${id}.${ext}`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

// Imagem opcional: se falhar, o perfil sai com o espaço padrão em vez de dar erro
const tryLoad = async src => {
  if (!src) return null;
  try { return await loadImage(src); } catch { return null; }
};

// Retorna o anexo PNG do perfil de `user` (nome/idade/retrato da ficha, ou padrões enquanto não houver ficha)
async function profileAttachment(user, member) {
  const profile = getProfile(user.id);
  const grimoire = profile.grimoire ? getGrimoire(profile.grimoire) : null;
  const png = await renderProfileImage({
    name: profile.name ?? member?.displayName ?? user.displayName ?? user.username,
    age: profile.age ?? null,
    level: profile.level,
    xp: profile.xp,
    xpNext: profile.level >= MAX_LEVEL ? null : xpToNext(profile.level),
    points: profile.points,
    skillPoints: profile.skillPoints,
    attrs: profile.attrs,
    portrait: await tryLoad(profile.portraitUrl ?? user.displayAvatarURL({ extension: 'png', size: 512 })),
    grimoire: await tryLoad(profile.grimoireUrl ?? (grimoire && grimoireImagePath(grimoire.id))),
    grimoireName: grimoire?.name ?? null,
    grimoireRarity: grimoire ? RARITIES[grimoire.rarity].name : null,
  });
  return new AttachmentBuilder(png, { name: 'perfil.png' });
}

module.exports = { profileAttachment };
