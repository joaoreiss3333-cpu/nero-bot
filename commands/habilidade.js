const { SlashCommandBuilder } = require('discord.js');
const { getBattle, currentPlayer, enemiesOf, needsTarget, findPlayer, abilitiesOf, abilityOf, ownedIds, planBonus, applyBonus, enemySummons, summonDistance, abilityCost, resourceLabel, resourceOf, canAfford, spend } = require('../src/combat/battle');
const { getMods, applyAbilityEffects, applyAbilityActive, hasActive, removeActive } = require('../src/combat/effects');
const { panelPayload, asEdit } = require('../src/combat/render');
const { playAction } = require('../src/combat/actions');
const { typeLabel, getAbility } = require('../src/combat/abilities');
const { getKit, getRanks } = require('../src/combat/characters');
const { distance } = require('../src/combat/grid');

const fail = (interaction, content) => interaction.reply({ content, ephemeral: true });

// Opções do autocomplete `copiar`: as magias que dá para copiar do inimigo marcado em `alvo` (ou de todos os inimigos,
// se ainda não marcou). As que pedem um nível maior que o seu aparecem com cadeado.
function copyChoices(interaction, battle, me) {
  const copia = me && me.abilities.includes('magia_de_copia') && abilityOf(me, 'magia_de_copia');
  if (!copia) return [];
  const focused = interaction.options.getFocused().toLowerCase();
  const alvo = interaction.options.get('alvo')?.value;
  const foes = enemiesOf(battle, me).filter(e => !alvo || e.id === alvo);
  const choices = [];
  for (const foe of foes) {
    for (const a of copia.copyable(me, foe)) {
      if (!a.name.toLowerCase().includes(focused)) continue;
      const blocker = copia.copyBlocker(me, a);
      const label = `${blocker ? '🔒 ' : ''}${a.name}${foes.length > 1 ? ` (de ${foe.name})` : ''}${blocker ? ` · precisa do nível ${a.minLevel}` : ''}`;
      choices.push({ name: label.slice(0, 100), value: a.id });
    }
  }
  return choices.slice(0, 25);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('habilidade')
    .setDescription('Usa uma habilidade de ataque ou ação bônus')
    .addStringOption(o => o
      .setName('nome')
      .setDescription('Qual habilidade usar')
      .setRequired(true)
      .setAutocomplete(true))
    .addUserOption(o => o
      .setName('alvo')
      .setDescription('Quem atacar (obrigatório se houver mais de um inimigo vivo)'))
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
      .setMaxValue(10))
    .addStringOption(o => o
      .setName('copiar')
      .setDescription('Só para a Magia de Cópia: qual magia do inimigo copiar')
      .setAutocomplete(true))
    .addStringOption(o => o
      .setName('invocacao')
      .setDescription('Atacar uma invocação inimiga no lugar de um jogador (só ataques)')
      .setAutocomplete(true)),

  // Lista as habilidades de ataque/bônus do personagem do jogador (ou, na opção `copiar`, as magias do inimigo)
  async autocomplete(interaction) {
    const battle = getBattle(interaction.channelId);
    const me = battle && findPlayer(battle, interaction.user.id);
    if (interaction.options.getFocused(true).name === 'copiar') return interaction.respond(copyChoices(interaction, battle, me));
    if (interaction.options.getFocused(true).name === 'invocacao') {
      const focused = interaction.options.getFocused().toLowerCase();
      const choices = (me ? enemySummons(battle, me) : [])
        .filter(s => s.name.toLowerCase().includes(focused))
        .map(s => ({ name: `${s.emoji ?? '👥'} ${s.name} (❤️ ${s.hp}/${s.maxHp}, a ${summonDistance(s, me.pos)} casa(s))`.slice(0, 100), value: s.id }));
      return interaction.respond(choices.slice(0, 25));
    }
    const ids = me ? ownedIds(me) : getKit(interaction.user.id); // na batalha, inclui as magias copiadas
    const focused = interaction.options.getFocused().toLowerCase();

    const holder = me ?? { ranks: getRanks(interaction.user.id) };
    const choices = ids
      .map(id => abilityOf(holder, id))
      .filter(a => a && a.type !== 'reaction' && a.name.toLowerCase().includes(focused))
      .map(a => ({ name: `${a.name}${a.rank > 1 ? ` (rank ${a.rank})` : ''} (${typeLabel(a)} · ${a.manaCost ?? a.energyCost} ${a.manaCost !== undefined ? 'mana' : 'energia'}${a.cooldown ? ` · recarga ${a.cooldown}` : ''})`, value: a.id }))
      .map(c => (holder.copied?.[c.value] && !holder.abilities?.includes(c.value) ? { ...c, name: `📋 ${c.name}`.slice(0, 100) } : c));
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
    if (ability.requiresActive && !hasActive(me, ability.requiresActive)) {
      return fail(interaction, `**${ability.name}** só pode ser usada com **${getAbility(ability.requiresActive)?.name}** ativo.`);
    }
    const mods = getMods(me);
    if (mods.noAct) return fail(interaction, 'Você não consegue agir neste turno por causa de um efeito (atordoado, dormindo...).');
    if (mods.oneAction && (battle.turn.attacked || battle.turn.bonusUsed)) {
      return fail(interaction, 'O **Sonolento** só deixa você fazer uma ação por turno.');
    }

    // Mirar numa invocação inimiga (opção `invocacao`): só ataques; ela não reage e o golpe sai da vida dela no fim do turno
    const summonId = interaction.options.getString('invocacao');
    if (summonId) {
      if (ability.type !== 'attack') return fail(interaction, 'Só habilidades de **Ataque** de alvo único podem mirar numa invocação.');
      if (battle.turn.attacked) return fail(interaction, 'Você já usou sua ação de ataque neste turno.');
      const summon = enemySummons(battle, me).find(s => s.id === summonId);
      if (!summon) return fail(interaction, 'Essa invocação não está mais no mapa. Escolha outra na opção `invocacao`.');
      const dist = summonDistance(summon, me.pos);
      if (dist > Math.min(ability.range, mods.visionCap)) {
        if (dist <= ability.range) return fail(interaction, 'A **Escuridão** limita sua visão: você não enxerga o alvo a essa distância.');
        return fail(interaction, `Alvo fora de alcance: **${ability.name}** alcança ${ability.range} casa (sem diagonal).`);
      }
      battle.turn.attacked = true;
      battle.turn.queuedAttack = ability;
      battle.turn.queuedTargetId = `summon:${summon.id}`;
      if (ability.cooldown) me.cooldowns[ability.id] = ability.cooldown;
      spend(me, ability);
      if (ability.consumesActive) removeActive(me, ability.consumesActive);
      await interaction.reply({ content: `✅ **${ability.name}** preparado em ${summon.name} (-${cost} ${resourceLabel(ability)}). O golpe acontece quando você encerrar o turno.`, ephemeral: true });
      await playAction(battle.message.channel, me.name, ability, { block: false });
      return battle.message.edit(asEdit(await panelPayload(battle, `👊 ${me.name} preparou **${ability.name}** contra ${summon.name} (-${cost} ${resourceLabel(ability)}). O golpe acontece ao fim do turno.`)));
    }

    // O alvo: o jogador marcado em `alvo` ou, se só restar um inimigo vivo, ele mesmo
    let foe = null;
    if (needsTarget(ability)) {
      const enemies = enemiesOf(battle, me);
      const picked = interaction.options.getUser('alvo');
      if (picked) {
        foe = enemies.find(e => e.id === picked.id);
        if (!foe) return fail(interaction, 'O alvo precisa ser um inimigo que ainda está de pé na batalha.');
      } else if (enemies.length === 1) {
        foe = enemies[0];
      } else {
        return fail(interaction, `Há mais de um inimigo: escolha em quem usar **${ability.name}** na opção \`alvo\`.`);
      }
    }

    if (ability.type === 'attack') {
      if (battle.turn.attacked) return fail(interaction, 'Você já usou sua ação de ataque neste turno.');
      if (distance(me.pos, foe.pos) > Math.min(ability.range, mods.visionCap)) {
        if (distance(me.pos, foe.pos) <= ability.range) return fail(interaction, 'A **Escuridão** limita sua visão: você não enxerga o alvo a essa distância.');
        return fail(interaction, `Alvo fora de alcance: **${ability.name}** alcança ${ability.range} casa (sem diagonal).`);
      }
      // O ataque só é resolvido quando o atacante encerra o turno (aí o defensor reage)
      battle.turn.attacked = true;
      battle.turn.queuedAttack = ability;
      battle.turn.queuedTargetId = foe.id;
      if (ability.cooldown) me.cooldowns[ability.id] = ability.cooldown;
      spend(me, ability);
      if (ability.consumesActive) removeActive(me, ability.consumesActive); // a Lua Negra é gasta no golpe
      await interaction.reply({ content: `✅ **${ability.name}** preparado em ${foe.name} (-${cost} ${resourceLabel(ability)}). O dano e a reação do oponente acontecem quando você encerrar o turno.`, ephemeral: true });
      // O GIF do golpe aparece na hora (como na ação bônus); o dano e a reação ficam para o fim do turno
      await playAction(battle.message.channel, me.name, ability, { block: false });
      return battle.message.edit(asEdit(await panelPayload(battle, `👊 ${me.name} preparou **${ability.name}** contra ${foe.name} (-${cost} ${resourceLabel(ability)}). O golpe acontece ao fim do turno.`)));
    }

    // bonus (as ofensivas, com `usesAttack`, agem na hora igual, mas gastam a ação de ataque no lugar da bônus)
    const slot = ability.usesAttack ? 'attacked' : 'bonusUsed';
    if (battle.turn[slot]) return fail(interaction, ability.usesAttack ? 'Você já usou sua ação de ataque neste turno.' : 'Você já usou sua ação bônus neste turno.');
    // Alcance e teleporte são conferidos antes de gastar mana ou a ação
    const plan = planBonus(battle, me, ability, interaction.options.getString('direcao'), interaction.options.getInteger('casas'), foe);
    if (plan.error) return fail(interaction, plan.error);
    // Ação bônus em área (`area`): atinge todos os inimigos dentro do raio, a partir de quem usou
    const inArea = ability.area ? enemiesOf(battle, me).filter(e => distance(me.pos, e.pos) <= ability.area.radius) : null;
    // Magias de área com dano também valem só contra invocações inimigas dentro da área
    const summonsInArea = ability.area && ability.damage ? enemySummons(battle, me).filter(s => summonDistance(s, me.pos) <= ability.area.radius) : [];
    if (ability.area && !inArea.length && !summonsInArea.length) return fail(interaction, `Nenhum inimigo dentro da área de **${ability.name}** (${ability.area.radius} casas).`);
    // Checagem própria da habilidade antes de gastar mana (ex: a Cópia precisa de uma magia para copiar)
    const opts = { copyId: interaction.options.getString('copiar') };
    const blocked = ability.canUse?.(battle, me, foe, opts);
    if (blocked) return fail(interaction, blocked);
    battle.turn[slot] = true;
    if (ability.cooldown) me.cooldowns[ability.id] = ability.cooldown;
    spend(me, ability);
    // Ação bônus: usa a função própria da habilidade (use) e/ou aplica os efeitos dela (applies) em quem usou
    const lines = [];
    if (ability.use) lines.push(ability.use(battle, me, foe, opts));
    lines.push(...applyBonus(battle, me, ability, plan.dest, foe));
    if (inArea) for (const e of inArea) lines.push(...applyAbilityEffects(ability, me, e, { defaultTo: 'self' }));
    else lines.push(...applyAbilityEffects(ability, me, foe, { defaultTo: 'self' }));
    const activeLine = applyAbilityActive(ability, me); // a magia ativa liga uma vez só, mesmo em área
    if (activeLine) lines.push(activeLine);
    const text = lines.join('\n') || `${me.name} usou **${ability.name}**.`;
    await interaction.reply({ content: `✅ Você usou **${ability.name}**.`, ephemeral: true });
    // A ação bônus acontece na hora: o GIF roda e some sozinho, sem travar o turno
    await playAction(battle.message.channel, me.name, ability, { block: false });
    return battle.message.edit(asEdit(await panelPayload(battle, text)));
  },
};
