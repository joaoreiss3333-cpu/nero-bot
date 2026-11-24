const {
  getBattle, endBattle, currentPlayer, opponentOf, findPlayer, abilitiesOf,
  movePlayer, startActions, resolveAttack, nextTurn, reactionBlock, energyCost, clampMoves,
} = require('./battle');
const { getMods } = require('./effects');
const { panelPayload, asEdit } = require('./render');
const { playAction } = require('./actions');
const { formatCoord, distance } = require('./grid');
const { getAbility } = require('./abilities');
const { ACTION_TIMEOUT_MS } = require('./config');

const ephemeral = (interaction, content) => interaction.reply({ content, ephemeral: true });

// Congela o painel atual (sem botões) e abre o painel do próximo jogador.
async function passTurn(battle, text) {
  await battle.message.edit(asEdit(await panelPayload(battle, text, { frozen: true })));
  const end = nextTurn(battle);
  if (end.defeated) return defeatByEffects(battle, end);
  battle.message = await battle.message.channel.send(await panelPayload(battle, end.log ? `${text}\n${end.log}` : text));
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

// Alguém caiu por dano contínuo (queimadura, sangramento...) no fim do próprio turno
async function defeatByEffects(battle, end) {
  const winner = opponentOf(battle, end.loser.id);
  endBattle(battle);
  battle.message = await battle.message.channel.send(
    await panelPayload(battle, `${end.log}\n\n🏆 **${winner.name} venceu a batalha!**`),
  );
}

// Resolve o ataque pendente com a reação escolhida (ou nenhuma). O painel atual é o do defensor:
// ele continua sendo o turno dele, agora com o resultado do golpe e os controles normais.
// Enquanto isso o ataque segue "pendente" (animando), para ninguém agir no meio.
async function finishAttack(battle, reaction) {
  const { attack, attackerId } = battle.pending;
  clearTimeout(battle.pending.timer);
  battle.pending.animating = true;

  const attacker = findPlayer(battle, attackerId);
  const defender = opponentOf(battle, attackerId);

  // A reação também é uma ação: aparece o embed (com GIF, se tiver), roda, some, e só então o resultado
  if (reaction) await playAction(battle.message.channel, defender.name, reaction);

  battle.pending = null;
  const result = resolveAttack(attacker, defender, attack, reaction);
  clampMoves(battle, defender); // um efeito novo (ex: Lentidão) vale já no resto deste turno

  if (result.defeated) {
    endBattle(battle);
    return battle.message.edit(asEdit(await panelPayload(battle, `${result.log}\n\n🏆 **${attacker.name} venceu a batalha!**`)));
  }
  await battle.message.edit(asEdit(await panelPayload(battle, result.log)));
  return skipIfStunned(battle); // o golpe pode ter atordoado o defensor, que perde o resto do turno
}

// Encerra o turno de `me`. Se houver ataque preparado, ele é resolvido agora (o GIF do golpe já
// apareceu quando a habilidade foi usada): aparece o painel do adversário com as opções de reação.
async function endTurn(battle, me, interaction) {
  const attack = battle.turn.queuedAttack;
  const defender = opponentOf(battle, me.id);

  if (!attack || distance(me.pos, defender.pos) > attack.range) {
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
  battle.pending = { attack, attackerId: me.id, timer: null, animating: true };
  await interaction.update(asEdit(
    await panelPayload(battle, `⏭️ ${me.name} encerrou o turno e atacou com **${attack.name}**!`, { frozen: true }),
  ));
  // A vez passa para o defensor (o fim do turno de quem atacou aplica os efeitos dele): o painel dele nasce já com a pergunta da reação
  const end = nextTurn(battle);
  if (end.defeated) return defeatByEffects(battle, end);
  const fxLog = end.log ? `\n${end.log}` : '';

  // Sem nenhuma reação que o defensor consiga usar (sem energia, atordoado...), o golpe acontece direto
  if (abilitiesOf(defender, 'reaction').every(a => reactionBlock(defender, a, attack))) {
    battle.message = await battle.message.channel.send(
      await panelPayload(battle, `👊 ${me.name} atacou com **${attack.name}**, e ${defender.name} não consegue reagir.${fxLog}`),
    );
    return finishAttack(battle, null);
  }

  battle.message = await battle.message.channel.send(await panelPayload(
    battle,
    `👊 ${me.name} atacou com **${attack.name}**! ${defender.name}, escolha sua reação (${ACTION_TIMEOUT_MS / 1000}s).${fxLog}`,
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
    const defender = opponentOf(battle, battle.pending.attackerId);
    if (kind !== 'react' || me.id !== defender.id) {
      return ephemeral(interaction, `Aguardando a reação de ${defender.name}.`);
    }
    const reaction = me.abilities.includes(arg) ? getAbility(arg) : null;
    const why = reaction && reactionBlock(me, reaction, battle.pending.attack);
    if (why === 'sem energia') {
      return ephemeral(interaction, `Energia insuficiente: **${reaction.name}** custa ${energyCost(me, reaction)} e você tem ${me.energy}.`);
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
