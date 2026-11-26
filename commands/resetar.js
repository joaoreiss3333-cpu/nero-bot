const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getProfile, resetProfile } = require('../src/combat/profiles');
const { getGrimoire } = require('../src/combat/grimoires');
const { inAnyBattle } = require('../src/combat/battle');

const MODES = {
  progresso: 'volta ao **nível 1** e zera XP, atributos, pontos e magias aprendidas. A ficha (nome, idade, história, retrato) e o grimório continuam',
  tudo: 'apaga **tudo**: nível, atributos, magias, a ficha inteira (nome, idade, história, retrato) e o grimório',
};

const fail = (interaction, content) => interaction.reply({ content, ephemeral: true });

// Botões da confirmação: rs:ok:<alvo>:<modo>:<quem pediu> e rs:no:<quem pediu>
async function handleReset(interaction) {
  const [, action, ...rest] = interaction.customId.split(':');
  const requesterId = rest[rest.length - 1];
  if (interaction.user.id !== requesterId) return fail(interaction, 'Só quem pediu o reset pode confirmar.');
  if (action === 'no') return interaction.update({ content: '❎ Reset cancelado. Nada foi alterado.', components: [] });

  const [targetId, mode] = rest;
  if (inAnyBattle(targetId)) return interaction.update({ content: 'Não dá para resetar um personagem que está numa batalha.', components: [] });
  resetProfile(targetId, mode);
  const who = targetId === requesterId ? 'Seu personagem' : `O personagem de <@${targetId}>`;
  const next = mode === 'tudo'
    ? 'Faça uma ficha nova para começar de novo.'
    : 'Use `/distribuir` e `/aprender` para montar o personagem de novo.';
  return interaction.update({ content: `🔄 ${who} foi resetado: ${MODES[mode]}.\n${next}`, components: [], allowedMentions: { users: [] } });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resetar')
    .setDescription('Reseta o seu personagem (pede confirmação antes)')
    .addStringOption(o => o
      .setName('modo')
      .setDescription('O que resetar')
      .setRequired(true)
      .addChoices(
        { name: 'Progresso (nível, atributos e magias; mantém ficha e grimório)', value: 'progresso' },
        { name: 'Tudo (apaga também a ficha e o grimório)', value: 'tudo' },
      ))
    .addUserOption(o => o.setName('jogador').setDescription('Staff: resetar outro jogador')),

  async execute(interaction) {
    const mode = interaction.options.getString('modo');
    const target = interaction.options.getUser('jogador') ?? interaction.user;
    const self = target.id === interaction.user.id;
    if (!self && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return fail(interaction, 'Só a staff pode resetar o personagem de outro jogador.');
    }
    if (inAnyBattle(target.id)) return fail(interaction, 'Não dá para resetar um personagem que está numa batalha.');

    const p = getProfile(target.id);
    const grimoire = p.grimoire ? getGrimoire(p.grimoire)?.name : null;
    const now = `Hoje: ${p.name ? `**${p.name}**, ` : ''}nível **${p.level}**, ${p.learned.length} magia(s) aprendida(s)${grimoire ? `, grimório de **${grimoire}**` : ''}.`;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`rs:ok:${target.id}:${mode}:${interaction.user.id}`).setLabel('Resetar').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`rs:no:${interaction.user.id}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary),
    );
    return interaction.reply({
      content: `⚠️ ${self ? 'Resetar o seu personagem' : `Resetar o personagem de ${target}`}? Isso ${MODES[mode]}.\n${now}\n**Não dá para desfazer.**`,
      components: [row],
      ephemeral: true,
      allowedMentions: { users: [] },
    });
  },

  handleReset,
};
