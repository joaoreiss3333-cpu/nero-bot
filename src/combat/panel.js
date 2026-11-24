const {
  getBattle, endBattle, currentPlayer, findPlayer, abilitiesOf, abilityOf, winnerTeam, victoryText, collectFallen,
  movePlayer, startActions, resolveAttack, nextTurn, reactionBlock, abilityCost, resourceLabel, resourceOf,
} = require('./battle');
const { getMods } = require('./effects');
const { panelPayload, asEdit } = require('./render');
const { playAction } = require('./actions');
const { formatCoord, distance } = require('./grid');
const { ACTION_TIMEOUT_MS } = require('./config');

const ephemeral = (interaction, content) => interaction.reply({ content, ephemeral: true });

// Se um time inteiro caiu, encerra a batalha e mostra o painel final com o vencedor. Retorna true se acabou.
async function finishIfWon(battle, text) {
  const team = winnerTeam(battle);
  if (team === null) return false;
  endBattle(battle);
  battle.message = await battle.message.channel.send(await panelPayload(battle, `${text}\n\n${victoryText(battle, team)}`));
  return true;
}

// Congela o painel atual (sem botões) e abre o painel do próximo jogador (ou encerra, se um time ganhou).
async function passTurn(battle, text) {
  await battle.message.edit(asEdit(await panelPayload(battle, text, { frozen: true })));
  if (await finishIfWon(battle, '')) return;
  const end = nextTurn(battle);
  const full = end.log ? `${text}\n${end.log}` : text;
  if (await finishIfWon(battle, end.log)) return;
  battle.message = await battle.message.channel.send(await panelPayload(battle, full));
  return skipIfStunned(battle);
}

// Quem está Atordoado perde o turno inteiro: depois de um instante para todos lerem, a vez passa sozinha
async function skipIfStunned(battle) {
  if (battle.over || battle.pending) return;
  const me = currentPlayer(battle);
  if (!getMods(me).skipTurn) return;
  await new Promise(resolve => setTimeout(resolve, 4000));
  if (battle.over || battle.pending || currentPlayer(battle) !== me) return;
  return passTurn(battle, `💫 ${me.name} está **Atordoado** e perdeu o turno.`);
}

// Resolve o ataque pendente com a reação escolhida (ou nenhuma). O painel atual é o da reação do alvo.
// Enquanto isso o ataque segue "pendente" (animando), para ninguém agir no meio. Depois a vez passa para o próximo.
async function finishAttack(battle, reaction) {
  const { attack, attackerId, defenderId } = battle.pending;
  clearTimeout(battle.pending.timer);
  battle.pending.animating = true;

  const attacker = findPlayer(battle, attackerId);
  const defender = findPlayer(battle, defenderId);

  // A reação também é uma ação: aparece o embed (com GIF, se tiver), roda, some, e só então o resultado
  if (reaction) await playAction(battle.message.channel, defender.name, reaction);

  battle.pending = null;
  const result = resolveAttack(attacker, defender, attack, reaction, battle);
  const fallen = collectFallen(battle);
  return passTurn(battle, [result.log, ...fallen].join('\n'));
}

// Encerra o turno de `me`. Se houver ataque preparado, ele é resolvido agora (o GIF do golpe já
// apareceu quando a habilidade foi usada): aparece o painel com as opções de reação do alvo.
async function endTurn(battle, me, interaction) {
  const attack = battle.turn.queuedAttack;
  const defender = attack && findPlayer(battle, battle.turn.queuedTargetId);

  if (!attack || !defender || defender.hp <= 0 || distance(me.pos, defender.pos) > attack.range) {
    await interaction.deferUpdate();
    const miss = attack ? ` O ataque **${attack.name}** não alcançou o alvo.` : '';
    return passTurn(battle, `⏭️ ${me.name} encerrou o turno.${miss}`);
  }
  // Cegueira: o ataque pode errar o alvo por completo (o defensor nem precisa reagir)
  if (Math.random() < getMods(me).missChance) {
    await interaction.deferUpdate();
    return passTurn(battle, `🙈 ${me.name} encerrou o turno, mas a **Cegueira** fez **${attack.name}** errar o alvo.`);
  }

  // Tira os botões do painel do atacante e trava as ações enquanto o golpe é mostrado
  battle.pending = { attack, attackerId: me.id, defenderId: defender.id, timer: null, animating: true };
  await interaction.update(asEdit(
    await panelPayload(battle, `⏭️ ${me.name} encerrou o turno e atacou ${defender.name} com **${attack.name}**!`, { frozen: true }),
  ));

  // Sem nenhuma reação que o defensor consiga usar (sem energia, atordoado...), o golpe acontece direto
  if (abilitiesOf(defender, 'reaction').every(a => reactionBlock(defender, a, attack))) {
    battle.message = await battle.message.channel.send(
      await panelPayload(battle, `👊 ${me.name} atacou ${defender.name} com **${attack.name}**, e ele não consegue reagir.`),
    );
    return finishAttack(battle, null);
  }

  battle.message = await battle.message.channel.send(await panelPayload(
    battle,
    `👊 ${me.name} atacou com **${attack.name}**! ${defender.name}, escolha sua reação (${ACTION_TIMEOUT_MS / 1000}s).`,
  ));
  battle.pending.animating = false;
  battle.pending.timer = setTimeout(() => {
    if (battle.pending && !battle.pending.animating) finishAttack(battle, null).catch(console.error);
  }, ACTION_TIMEOUT_MS);
}

async function handleButton(interaction) {
  const battle = getBattle(interaction.channelId);
  if (!battle || battle.message?.id !== interaction.message.id) {
    return ephemeral(interaction, 'Este painel não está mais ativo.');
  }
  const me = findPlayer(battle, interaction.user.id);
  if (!me) return ephemeral(interaction, 'Você não está nessa batalha.');
  if (battle.phase !== 'combat') return ephemeral(interaction, 'A batalha ainda não começou.');

  const [kind, arg] = interaction.customId.split(':');

  // Reação do defensor
  if (battle.pending) {
    if (battle.pending.animating) return ephemeral(interaction, 'A ação está acontecendo, aguarde um instante.');
    const defender = findPlayer(battle, battle.pending.defenderId);
    if (kind !== 'react' || me.id !== defender.id) {
      return ephemeral(interaction, `Aguardando a reação de ${defender.name}.`);
    }
    const reaction = me.abilities.includes(arg) ? abilityOf(me, arg) : null;
    const why = reaction && reactionBlock(me, reaction, battle.pending.attack);
    if (why === 'sem recurso') {
      return ephemeral(interaction, `Sem ${resourceLabel(reaction)} suficiente: **${reaction.name}** custa ${abilityCost(me, reaction)} e você tem ${me[resourceOf(reaction)]}.`);
    }
    if (why) return ephemeral(interaction, `Você ${why} agora.`);
    await interaction.deferUpdate(); // finishAttack já trava (animating) contra cliques duplos
    return finishAttack(battle, reaction);
  }

  if (kind === 'react') return ephemeral(interaction, 'Não há ataque para reagir agora.');
  if (currentPlayer(battle).id !== me.id) return ephemeral(interaction, 'Não é o seu turno.');

  if (kind === 'mv') {
    const result = movePlayer(battle, me, arg);
    if (result.error) return ephemeral(interaction, result.error);
    const unlocked = battle.turn.phase === 'action' ? ' Movimento esgotado: ações liberadas.' : '';
    return interaction.update(asEdit(await panelPayload(battle, `🏃 ${me.name} foi para **${formatCoord(me.pos)}**.${unlocked}`)));
  }

  // Termina a movimentação (mesmo sem ter se movido) e libera o ataque e a ação bônus
  if (kind === 'act') {
    if (battle.turn.phase !== 'move') return ephemeral(interaction, 'As ações já estão liberadas.');
    startActions(battle);
    return interaction.update(asEdit(await panelPayload(battle, `⚔️ ${me.name} terminou a movimentação. Ações liberadas: use \`/habilidade\`.`)));
  }

  if (kind === 'end') {
    if (battle.ending) return interaction.deferUpdate(); // clique duplo
    battle.ending = true;
    try { return await endTurn(battle, me, interaction); } finally { battle.ending = false; }
  }
}

module.exports = { handleButton };
