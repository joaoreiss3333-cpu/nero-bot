const fs = require('fs');
const path = require('path');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
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

// Posta o embed da ação ("X utilizou um Soco") com o GIF. Retorna true se havia GIF.
// Uma falha aqui (ex: sem permissão para enviar arquivos) nunca deve travar a luta.
async function announceAction(channel, userName, ability) {
  const embed = new EmbedBuilder()
    .setColor(config.EMBED_COLOR)
    .setTitle(`${userName} utilizou ${ability.actionText ?? ability.name}`);

  const gif = gifFor(ability);
  const files = [];
  if (gif?.url) {
    embed.setImage(gif.url);
  } else if (gif?.file) {
    files.push(new AttachmentBuilder(gif.file, { name: gif.name }));
    embed.setImage(`attachment://${gif.name}`);
  }

  try {
    await channel.send({ embeds: [embed], files });
  } catch (err) {
    console.error('Não foi possível enviar o aviso da ação:', err.message);
    return false;
  }
  return !!gif;
}

// Mostra o aviso da ação e espera o GIF rodar, para o resultado só aparecer depois da animação.
// Habilidades sem GIF não esperam nada.
async function playAction(channel, userName, ability) {
  const hasGif = await announceAction(channel, userName, ability);
  const wait = ability.gifDurationMs ?? config.ACTION_GIF_WAIT_MS;
  if (hasGif && wait > 0) await sleep(wait);
}

module.exports = { announceAction, playAction, gifFor };
