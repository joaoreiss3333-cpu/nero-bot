// Criação de ficha passo a passo (/ficha): nome -> idade -> aparência -> revisão e confirmação.
// Tudo acontece numa única mensagem (container) que vai se atualizando; só quem abriu a ficha
// consegue clicar nos botões. O rascunho fica em memória até confirmar.
const fs = require('fs');
const path = require('path');
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, AttachmentBuilder,
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MediaGalleryBuilder, MediaGalleryItemBuilder,
} = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { EMBED_COLOR } = require('./combat/config');
const { getProfile, save } = require('./combat/profiles');
const { profileAttachment } = require('./combat/profileView');

const PORTRAIT_DIR = path.join(__dirname, '..', 'data', 'portraits');
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const PORTRAIT_MAX_SIDE = 768;
const NAME_MIN = 2, NAME_MAX = 32, AGE_MIN = 1, AGE_MAX = 999;
const STORY_MIN = 20, STORY_MAX = 1500, STORY_PREVIEW = 400;

const drafts = new Map(); // userId -> { name, age, portrait: Buffer|null, useAvatar: boolean, story }

const portraitFile = userId => path.join(PORTRAIT_DIR, `${userId}.png`);
const button = (action, userId, label, emoji, style = ButtonStyle.Secondary) =>
  new ButtonBuilder().setCustomId(`fc:${action}:${userId}`).setLabel(label).setEmoji(emoji).setStyle(style);

// Em qual passo o rascunho está: o primeiro item que ainda falta
const stepOf = d => (!d.name ? 'name' : !d.age ? 'age' : (!d.portrait && !d.useAvatar) ? 'look' : !d.story ? 'story' : 'review');

// Baixa a imagem do link, confere se é imagem de verdade e reduz. Retorna { png } ou { error }.
async function fetchPortrait(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return { error: 'Isso não parece um link. Cole o endereço da imagem (começando com https://).' }; }
  if (!/^https?:$/.test(parsed.protocol)) return { error: 'O link precisa começar com http:// ou https://.' };
  try {
    const res = await fetch(parsed, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { error: `Não consegui baixar a imagem (erro ${res.status}). Confira o link.` };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) return { error: 'A imagem é grande demais (máximo 8 MB).' };
    const img = await loadImage(buf);
    const scale = Math.min(1, PORTRAIT_MAX_SIDE / Math.max(img.width, img.height));
    const canvas = createCanvas(Math.round(img.width * scale), Math.round(img.height * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return { png: canvas.toBuffer('image/png') };
  } catch {
    return { error: 'Esse link não é uma imagem que eu consiga abrir. Use o link direto da imagem (png, jpg, webp).' };
  }
}

const NEXT_HELP = {
  name: ['Qual é o **nome** do seu personagem?', 'Clique no botão abaixo e digite o nome.'],
  age: ['Qual é a **idade** dele?', 'Clique no botão abaixo e digite só o número.'],
  look: [
    'Como ele **se parece**?',
    'Envie o **link direto de uma imagem** (png, jpg ou webp) ou use o seu avatar do Discord.',
  ],
  story: ['Qual é a **história** dele?', `Conte a origem e o passado do personagem (de ${STORY_MIN} a ${STORY_MAX} caracteres).`],
  review: ['Tudo certo? **Confira sua ficha**', 'Se estiver bom, confirme. Para mudar algo, use os botões de editar.'],
};

// Monta a mensagem (container) do passo atual
function view(user, d, { editing = false } = {}) {
  const step = stepOf(d);
  const mark = (done, key) => (done ? '✅' : step === key ? '▶️' : '⬜');
  const line = (done, key, label, value) => `${mark(done, key)} **${label}:** ${done ? value : '—'}`;
  const lookText = d.portrait ? 'imagem enviada' : 'avatar do Discord';

  const [question, hint] = NEXT_HELP[step];
  const intro = editing && step === 'review'
    ? 'Você já tem uma ficha — pode editar qualquer parte dela.'
    : 'Vamos registrar o seu personagem, um passo de cada vez.';
  const container = new ContainerBuilder().setAccentColor(EMBED_COLOR)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# 📜 Criação de Ficha\n${intro}`))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      line(!!d.name, 'name', 'Nome', d.name),
      line(!!d.age, 'age', 'Idade', `${d.age} anos`),
      line(!!(d.portrait || d.useAvatar), 'look', 'Aparência', lookText),
      line(!!d.story, 'story', 'História', d.story && (d.story.length > STORY_PREVIEW ? `${d.story.slice(0, STORY_PREVIEW)}…` : d.story)),
    ].join('\n')))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  const files = [];
  if (step === 'review') {
    let url;
    if (d.portrait) { files.push(new AttachmentBuilder(d.portrait, { name: 'aparencia.png' })); url = 'attachment://aparencia.png'; }
    else url = user.displayAvatarURL({ extension: 'png', size: 512 });
    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(url)));
  }
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${question}\n${hint}`));

  const id = user.id;
  const rows = {
    name: [button('askName', id, 'Informar nome', '✏️', ButtonStyle.Primary)],
    age: [button('askAge', id, 'Informar idade', '🎂', ButtonStyle.Primary)],
    look: [
      button('askLook', id, 'Enviar link da imagem', '🖼️', ButtonStyle.Primary),
      button('avatar', id, 'Usar meu avatar', '👤'),
    ],
    story: [button('askStory', id, 'Escrever história', '📖', ButtonStyle.Primary)],
    review: [
      button('confirm', id, 'Confirmar ficha', '✅', ButtonStyle.Success),
      button('askName', id, 'Nome', '✏️'),
      button('askAge', id, 'Idade', '🎂'),
      button('askLook', id, 'Aparência', '🖼️'),
      button('askStory', id, 'História', '📖'),
    ],
  }[step];
  const cancel = button('cancel', id, 'Cancelar', '✖️');
  // Máximo de 5 botões por linha: na revisão o Cancelar vai para uma segunda linha
  if (step === 'review') container.addActionRowComponents(new ActionRowBuilder().addComponents(...rows), new ActionRowBuilder().addComponents(cancel));
  else container.addActionRowComponents(new ActionRowBuilder().addComponents(...rows, cancel));

  return { components: [container], flags: MessageFlags.IsComponentsV2, files, attachments: [] };
}

// Comando /ficha: abre o rascunho (já preenchido se o jogador tiver uma ficha)
async function startFicha(interaction) {
  const profile = getProfile(interaction.user.id);
  const draft = { name: profile.name ?? null, age: profile.age ?? null, portrait: null, useAvatar: false, story: profile.story ?? null };
  if (profile.name) {
    try { draft.portrait = fs.readFileSync(portraitFile(interaction.user.id)); } catch { draft.useAvatar = true; }
  }
  drafts.set(interaction.user.id, draft);
  return interaction.reply(view(interaction.user, draft, { editing: !!profile.name }));
}

// `value` só é aplicado se existir: valor vazio quebra o formulário quando há tamanho mínimo
const withValue = (input, value) => (value ? input.setValue(value) : input);
const input = (id, label, placeholder, style = TextInputStyle.Short) =>
  new TextInputBuilder().setCustomId(id).setLabel(label).setPlaceholder(placeholder).setStyle(style).setRequired(true);
const modal = (action, userId, title, textInput) =>
  new ModalBuilder().setCustomId(`fc:${action}:${userId}`).setTitle(title).addComponents(new ActionRowBuilder().addComponents(textInput));

async function handleFicha(interaction) {
  const [, action, ownerId] = interaction.customId.split(':');
  const reply = content => interaction.reply({ content, ephemeral: true });
  if (interaction.user.id !== ownerId) return reply('Essa ficha é de outra pessoa. Use `/ficha` para criar a sua.');
  const draft = drafts.get(ownerId);
  if (!draft) return reply('Essa criação de ficha expirou. Use `/ficha` para começar de novo.');
  const editing = !!getProfile(ownerId).name;

  switch (action) {
    case 'askName':
      return interaction.showModal(modal('name', ownerId, 'Nome do personagem',
        withValue(input('value', 'Nome', 'Ex: Asta').setMinLength(NAME_MIN).setMaxLength(NAME_MAX), draft.name)));
    case 'askAge':
      return interaction.showModal(modal('age', ownerId, 'Idade do personagem',
        withValue(input('value', 'Idade (só o número)', 'Ex: 17').setMinLength(1).setMaxLength(3), draft.age && String(draft.age))));
    case 'askLook':
      return interaction.showModal(modal('look', ownerId, 'Aparência do personagem',
        input('value', 'Link da imagem', 'https://...', TextInputStyle.Paragraph).setMaxLength(1000)));

    case 'askStory':
      return interaction.showModal(modal('story', ownerId, 'História do personagem',
        withValue(input('value', 'História', 'Origem, família, passado...', TextInputStyle.Paragraph).setMinLength(STORY_MIN).setMaxLength(STORY_MAX), draft.story)));

    case 'story': {
      const story = interaction.fields.getTextInputValue('value').trim();
      if (story.length < STORY_MIN) return reply(`A história precisa ter pelo menos ${STORY_MIN} caracteres.`);
      draft.story = story;
      return interaction.update(view(interaction.user, draft, { editing }));
    }
    case 'name': {
      const name = interaction.fields.getTextInputValue('value').trim().replace(/\s+/g, ' ');
      if (name.length < NAME_MIN) return reply(`O nome precisa ter pelo menos ${NAME_MIN} letras.`);
      draft.name = name;
      return interaction.update(view(interaction.user, draft, { editing }));
    }
    case 'age': {
      const raw = interaction.fields.getTextInputValue('value').trim();
      const age = /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;
      if (!(age >= AGE_MIN && age <= AGE_MAX)) return reply(`Idade inválida. Digite só o número (de ${AGE_MIN} a ${AGE_MAX}).`);
      draft.age = age;
      return interaction.update(view(interaction.user, draft, { editing }));
    }
    case 'look': {
      await interaction.deferUpdate(); // baixar a imagem pode passar de 3s
      const result = await fetchPortrait(interaction.fields.getTextInputValue('value').trim());
      if (result.error) return interaction.followUp({ content: `❌ ${result.error}`, ephemeral: true });
      draft.portrait = result.png;
      draft.useAvatar = false;
      return interaction.editReply(view(interaction.user, draft, { editing }));
    }
    case 'avatar':
      draft.portrait = null;
      draft.useAvatar = true;
      return interaction.update(view(interaction.user, draft, { editing }));

    case 'cancel': {
      drafts.delete(ownerId);
      const container = new ContainerBuilder().setAccentColor(EMBED_COLOR)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('# 📜 Criação de Ficha\nCriação cancelada. Use `/ficha` quando quiser recomeçar.'));
      return interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2, files: [], attachments: [] });
    }

    case 'confirm': {
      if (stepOf(draft) !== 'review') return reply('Ainda faltam informações na ficha.');
      await interaction.deferUpdate(); // desenhar o perfil pode passar de 3s
      const profile = getProfile(ownerId);
      profile.name = draft.name;
      profile.age = draft.age;
      profile.story = draft.story;
      if (draft.portrait) {
        fs.mkdirSync(PORTRAIT_DIR, { recursive: true });
        fs.writeFileSync(portraitFile(ownerId), draft.portrait);
        profile.portraitUrl = portraitFile(ownerId); // caminho do arquivo salvo; o /perfil carrega direto
      } else {
        delete profile.portraitUrl; // sem imagem própria: o perfil usa o avatar do Discord
        fs.rmSync(portraitFile(ownerId), { force: true });
      }
      save();
      drafts.delete(ownerId);

      const member = interaction.guild?.members.cache.get(ownerId);
      const container = new ContainerBuilder().setAccentColor(EMBED_COLOR)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# 📜 Ficha ${editing ? 'atualizada' : 'criada'}!\nBem-vindo, **${profile.name}**. Veja seu perfil abaixo; use \`/distribuir\` para gastar seus pontos de atributo.`))
        .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://perfil.png')));
      return interaction.editReply({
        components: [container], flags: MessageFlags.IsComponentsV2,
        files: [await profileAttachment(interaction.user, member)], attachments: [],
      });
    }
  }
}

module.exports = { startFicha, handleFicha };
