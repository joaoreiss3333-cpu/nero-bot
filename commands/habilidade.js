const { SlashCommandBuilder } = require('discord.js');
const { getBattle, currentPlayer, opponentOf, findPlayer, abilitiesOf, abilityOf, planBonus, applyBonus, abilityCost, resourceLabel, resourceOf, canAfford, spend } = require('../src/combat/battle');
const { getMods, applyAbilityEffects } = require('../src/combat/effects');
const { panelPayload, asEdit } = require('../src/combat/render');
const { playAction } = require('../src/combat/actions');
const { TYPE_LABEL } = require('../src/combat/abilities');
const { getKit, getRanks } = require('../src/combat/characters');
const { distance } = require('../src/combat/grid');

const fail = (interaction, content) => interaction.reply({ content, ephemeral: true });

module.exports = {
  data: new SlashCommandBuilder()
    .setName('habilidade')
    .setDescription('Usa uma habilidade de ataque ou ação bônus')
    .addStringOption(o => o
      .setName('nome')
      .setDescription('Qual habilidade usar')
      .setRequired(true)
      .setAutocomplete(true))
    .addStringOption(o => o
      .setName('direcao')
      .setDescription('Só para habilidades de teleporte (portais): para onde levar')
      .addChoices(
        { name: 'Cima', value: 'up' },
        { name: 'Baixo', value: 'down' },
        { name: 'Esquerda', value: 'left' },
        { name: 'Direita', value: 'right' },
      ))
    .addIntegerOption(o => o
      .setName('casas')
      .setDescription('Só para habilidades de teleporte: quantas casas')
      .setMinValue(1)
      .setMaxValue(10)),

  // Lista as habilidades de ataque/bônus do personagem do jogador
  async autocomplete(interaction) {
    const battle = getBattle(interaction.channelId);
    const me = battle && findPlayer(battle, interaction.user.id);
    const ids = me ? me.abilities : getKit(interaction.user.id);
    const focused = interaction.options.getFocused().toLowerCase();

    const holder = me ?? { ranks: getRanks(interaction.user.id) };
    const choices = ids
      .map(id => abilityOf(holder, id))
      .filter(a => a && a.type !== 'reaction' && a.name.toLowerCase().includes(focused))
      .map(a => ({ name: `${a.name}${a.rank > 1 ? ` (rank ${a.rank})` : ''} (${TYPE_LABEL[a.type]} · ${a.manaCost ?? a.energyCost} ${a.manaCost !== undefined ? 'mana' : 'energia'}${a.cooldown ? ` · recarga ${a.cooldown}` : ''})`, value: a.id }));
    await interaction.respond(choices.slice(0, 25));
  },

  async execute(interaction) {
    const battle = getBattle(interaction.channelId);
    if (!battle) return fail(interaction, 'Não há batalha neste canal. Use `/batalha iniciar`.');
    const me = findPlayer(battle, interaction.user.id);
    if (!me) return fail(interaction, 'Você não está nessa batalha.');
    if (battle.phase !== 'combat') return fail(interaction, 'A batalha ainda não começou. Escolha seu setor inicial no painel.');
    if (currentPlayer(battle).id !== me.id) return fail(interaction, 'Não é o seu turno.');
    if (battle.pending) return fail(interaction, 'Aguarde a reação do oponente.');
    if (battle.turn.phase !== 'action') {
      return fail(interaction, 'Primeiro faça sua movimentação: use as setas e depois clique em **Ir para as ações**.');
    }

    const ability = abilityOf(me, interaction.options.getString('nome'));
    const owned = ability && abilitiesOf(me, ability.type).some(a => a.id === ability.id);
    if (!owned || ability.type === 'reaction') return fail(interaction, 'Você não possui essa habilidade.');
    const cost = abilityCost(me, ability);
    if (!canAfford(me, ability)) {
      return fail(interaction, `${resourceOf(ability) === 'mana' ? 'Mana' : 'Energia'} insuficiente: **${ability.name}** custa ${cost} e você tem ${me[resourceOf(ability)]}.`);
    }
    if (me.cooldowns[ability.id] > 0) {
      return fail(interaction, `**${ability.name}** ainda está em recarga: faltam ${me.cooldowns[ability.id]} turno(s) seu(s).`);
    }
    const mods = getMods(me);
    if (mods.noAct) return fail(interaction, 'Você não consegue agir neste turno por causa de um efeito (atordoado, dormindo...).');
    if (mods.oneAction && (battle.turn.attacked || battle.turn.bonusUsed)) {
      return fail(interaction, 'O **Sonolento** só deixa você fazer uma ação por turno.');
    }

    if (ability.type === 'attack') {
      if (battle.turn.attacked) return fail(interaction, 'Você já usou sua ação de ataque neste turno.');
      const foe = opponentOf(battle, me.id);
      if (distance(me.pos, foe.pos) > Math.min(ability.range, mods.visionCap)) {
        if (distance(me.pos, foe.pos) <= ability.range) return fail(interaction, 'A **Escuridão** limita sua visão: você não enxerga o alvo a essa distância.');
        return fail(interaction, `Alvo fora de alcance: **${ability.name}** alcança ${ability.range} casa (sem diagonal).`);
      }
      // O ataque só é resolvido quando o atacante encerra o turno (aí o defensor reage)
      battle.turn.attacked = true;
      battle.turn.queuedAttack = ability;
      if (ability.cooldown) me.cooldowns[ability.id] = ability.cooldown;
      spend(me, ability);
      await interaction.reply({ content: `✅ **${ability.name}** preparado (-${cost} ${resourceLabel(ability)}). O dano e a reação do oponente acontecem quando você encerrar o turno.`, ephemeral: true });
      // O GIF do golpe aparece na hora (como na ação bônus); o dano e a reação ficam para o fim do turno
      await playAction(battle.message.channel, me.name, ability, { block: false });
      return battle.message.edit(asEdit(await panelPayload(battle, `👊 ${me.name} preparou **${ability.name}** (-${cost} ${resourceLabel(ability)}). O golpe acontece ao fim do turno.`)));
    }

    // bonus
    if (battle.turn.bonusUsed) return fail(interaction, 'Você já usou sua ação bônus neste turno.');
    // Alcance e teleporte são conferidos antes de gastar mana ou a ação
    const plan = planBonus(battle, me, ability, interaction.options.getString('direcao'), interaction.options.getInteger('casas'));
    if (plan.error) return fail(interaction, plan.error);
    battle.turn.bonusUsed = true;
    if (ability.cooldown) me.cooldowns[ability.id] = ability.cooldown;
    spend(me, ability);
    // Ação bônus: usa a função própria da habilidade (use) e/ou aplica os efeitos dela (applies) em quem usou
    const lines = [];
    if (ability.use) lines.push(ability.use(battle, me));
    lines.push(...applyBonus(battle, me, ability, plan.dest));
    lines.push(...applyAbilityEffects(ability, me, opponentOf(battle, me.id), { defaultTo: 'self' }));
    const text = lines.join('\n') || `${me.name} usou **${ability.name}**.`;
    await interaction.reply({ content: `✅ Você usou **${ability.name}**.`, ephemeral: true });
    // A ação bônus acontece na hora: o GIF roda e some sozinho, sem travar o turno
    await playAction(battle.message.channel, me.name, ability, { block: false });
    return battle.message.edit(asEdit(await panelPayload(battle, text)));
  },
};
