const {
  getBattle, endBattle, currentPlayer, opponentOf, findPlayer, abilitiesOf,
  movePlayer, resolveAttack, nextTurn,
} = require('./battle');
const { panelPayload, asEdit } = require('./render');
const { playAction } = require('./actions');
const { formatCoord, distance } = require('./grid');
const { getAbility } = require('./abilities');
const { ACTION_TIMEOUT_MS } = require('./config');

const ephemeral = (interaction, content) => interaction.reply({ content, ephemeral: true });

// Congela o painel atual (sem botões) e abre o painel do próximo jogador.
async function passTurn(battle, text) {
  await battle.message.edit(asEdit({ ...(await panelPayload(battle, text)), components: [] }));
  nextTurn(battle);
  battle.message = await battle.message.channel.send(await panelPayload(battle, text));
}

// Aplica a reação escolhida (ou nenhuma) ao ataque pendente e passa o turno.
// Enquanto isso o ataque continua "pendente" (marcado como animando), para ninguém agir no meio.
async function finishAttack(battle, reaction) {
  const { attack, attackerId } = battle.pending;
  clearTimeout(battle.pending.timer);
  battle.pending.animating = true;

  const attacker = findPlayer(battle, attackerId);
  const defender = opponentOf(battle, attackerId);

  // A reação também é uma ação: aparece o aviso (com GIF, se tiver) antes do resultado
  if (reaction) await playAction(battle.message.channel, defender.name, reaction);

  battle.pending = null;
  const result = resolveAttack(attacker, defender, attack, reaction);

  if (result.defeated) {
    endBattle(battle);
    return battle.message.edit(asEdit(await panelPayload(battle, `${result.log}\n\n🏆 **${attacker.name} venceu a batalha!**`)));
  }
  return passTurn(battle, `⏭️ ${attacker.name} encerrou o turno.\n${result.log}`);
}

// Encerra o turno de `me`. Se houver ataque preparado, ele acontece agora: aparece o aviso do
// golpe (com GIF) e só depois o defensor reage antes do dano.
async function endTurn(battle, me, interaction) {
  await interaction.update({ components: [] }); // tira os botões na hora (evita cliques duplos)

  const attack = battle.turn.queuedAttack;
  const defender = opponentOf(battle, me.id);

  if (!attack) return passTurn(battle, `⏭️ ${me.name} encerrou o turno.`);
  if (distance(me.pos, defender.pos) > attack.range) {
    return passTurn(battle, `⏭️ ${me.name} encerrou o turno. O ataque **${attack.name}** não alcançou o alvo.`);
  }

  battle.pending = { attack, attackerId: me.id, timer: null, animating: true };
  await playAction(battle.message.channel, me.name, attack);

  // Sem nenhuma reação que o defensor consiga pagar com a energia que tem, o golpe acontece direto
  if (!abilitiesOf(defender, 'reaction').some(a => defender.energy >= a.energyCost)) {
    return finishAttack(battle, null);
  }

  battle.pending.animating = false;
  battle.pending.timer = setTimeout(() => {
    if (battle.pending && !battle.pending.animating) finishAttack(battle, null).catch(console.error);
  }, ACTION_TIMEOUT_MS);
  return battle.message.edit(asEdit(await panelPayload(
    battle,
    `👊 ${me.name} encerrou o turno e atacou com **${attack.name}**! ${defender.name}, escolha sua reação (${ACTION_TIMEOUT_MS / 1000}s).`,
  )));
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
    if (reaction && me.energy < reaction.energyCost) {
      return ephemeral(interaction, `Energia insuficiente: **${reaction.name}** custa ${reaction.energyCost} e você tem ${me.energy}.`);
    }
    await interaction.update({ components: [] }); // tira os botões na hora (evita cliques duplos)
    return finishAttack(battle, reaction);
  }

  if (kind === 'react') return ephemeral(interaction, 'Não há ataque para reagir agora.');
  if (currentPlayer(battle).id !== me.id) return ephemeral(interaction, 'Não é o seu turno.');

  if (kind === 'mv') {
    const result = movePlayer(battle, me, arg);
    if (result.error) return ephemeral(interaction, result.error);
    return interaction.update(asEdit(await panelPayload(battle, `🏃 ${me.name} foi para **${formatCoord(me.pos)}**.`)));
  }

  if (kind === 'end') return endTurn(battle, me, interaction);
}

module.exports = { handleButton };
