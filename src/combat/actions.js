const fs = require('fs');
const path = require('path');
const {
  AttachmentBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder,
} = require('discord.js');
const config = require('./config');

const GIF_DIR = path.join(__dirname, '..', '..', 'assets', 'gifs');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// O GIF da habilidade: uma URL, ou um arquivo da pasta assets/gifs. Retorna null se não houver
// (ou se o arquivo ainda não existir), e nesse caso o aviso sai só com o título.
function gifFor(ability) {
  if (!ability.gif) return null;
  if (/^https?:\/\//i.test(ability.gif)) return { url: ability.gif };
  const file = path.isAbsolute(ability.gif) ? ability.gif : path.join(GIF_DIR, ability.gif);
  return fs.existsSync(file) ? { file, name: path.basename(file) } : null;
}

// Posta o container da ação ("X utilizou um Soco") com o GIF.
// Retorna { message, hasGif }. Uma falha ao enviar (ex: sem permissão para anexar arquivos)
// nunca deve travar a luta: nesse caso message fica indefinida.
async function announceAction(channel, userName, ability) {
  const container = new ContainerBuilder()
    .setAccentColor(config.EMBED_COLOR)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${userName} utilizou ${ability.actionText ?? ability.name}`));

  const gif = gifFor(ability);
  const files = [];
  let gifUrl;
  if (gif?.url) {
    gifUrl = gif.url;
  } else if (gif?.file) {
    files.push(new AttachmentBuilder(gif.file, { name: gif.name }));
    gifUrl = `attachment://${gif.name}`;
  }
  if (gifUrl) {
    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(gifUrl)));
  }

  try {
    const message = await channel.send({ components: [container], flags: MessageFlags.IsComponentsV2, files });
    return { message, hasGif: !!gif };
  } catch (err) {
    console.error('Não foi possível enviar o aviso da ação:', err.message);
    return { message: undefined, hasGif: false };
  }
}

// Mostra o aviso da ação: ele fica na tela pelo tempo da animação (o GIF roda, se a habilidade
// tiver um) e então é apagado. Vale para qualquer ação, com ou sem GIF.
//   block: true  -> espera o aviso sumir antes de retornar, para o próximo embed só aparecer depois;
//         false -> retorna na hora e o aviso some sozinho depois.
async function playAction(channel, userName, ability, { block = true } = {}) {
  const { message } = await announceAction(channel, userName, ability);
  const wait = ability.gifDurationMs ?? config.ACTION_GIF_WAIT_MS;
  if (!message || wait <= 0) return;

  const remove = () => message.delete().catch(() => {});
  if (!block) {
    setTimeout(remove, wait);
    return;
  }
  await sleep(wait);
  await remove();
}

module.exports = { announceAction, playAction, gifFor };
