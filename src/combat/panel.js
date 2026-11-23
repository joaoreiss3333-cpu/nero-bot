const {
  getBattle, endBattle, currentPlayer, opponentOf, findPlayer, abilitiesOf,
  movePlayer, resolveAttack, nextTurn,
} = require('./battle');
const { panelPayload } = require('./render');
const { formatCoord, distance } = require('./grid');
const { getAbility } = require('./abilities');
const { ACTION_TIMEOUT_MS } = require('./config');

const ephemeral = (interaction, content) => interaction.reply({ content, ephemeral: true });

// Congela o painel atual (sem botões) e abre o painel do próximo jogador.
// `interaction` é o clique que originou isso; sem ele (tempo esgotado) usa o canal.
async function passTurn(battle, text, interaction = null) {
  const frozen = { embeds: panelPayload(battle, text).embeds, components: [] };
  if (interaction) await interaction.update(frozen);
  else await battle.message.edit(frozen);

  nextTurn(battle);
  const next = {
    content: `<@${currentPlayer(battle).id}>, é a sua vez!`,
    ...panelPayload(battle, text),
  };
  battle.message = interaction
    ? await interaction.followUp({ ...next, fetchReply: true })
    : await battle.message.channel.send(next);
}

// Aplica a reação escolhida (ou nenhuma) ao ataque pendente e passa o turno.
async function finishAttack(battle, reaction, interaction = null) {
  const { attack, attackerId } = battle.pending;
  clearTimeout(battle.pending.timer);
  battle.pending = null;

  const attacker = findPlayer(battle, attackerId);
  const defender = opponentOf(battle, attackerId);
  const result = resolveAttack(attacker, defender, attack, reaction);

  if (result.defeated) {
    endBattle(battle);
    const payload = panelPayload(battle, `${result.log}\n\n🏆 **${attacker.name} venceu a batalha!**`);
    return interaction ? interaction.update(payload) : battle.message.edit(payload);
  }
  return passTurn(battle, `⏭️ ${attacker.name} encerrou o turno.\n${result.log}`, interaction);
}

// Encerra o turno de `me`. Se houver ataque preparado, o defensor reage antes do dano.
async function endTurn(battle, me, interaction) {
  const attack = battle.turn.queuedAttack;
  const defender = opponentOf(battle, me.id);

  if (!attack) return passTurn(battle, `⏭️ ${me.name} encerrou o turno.`, interaction);
  if (distance(me.pos, defender.pos) > attack.range) {
    return passTurn(battle, `⏭️ ${me.name} encerrou o turno. O ataque **${attack.name}** não alcançou o alvo.`, interaction);
  }

  battle.pending = { attack, attackerId: me.id, timer: null };
  if (abilitiesOf(defender, 'reaction').length === 0) return finishAttack(battle, null, interaction);

  battle.pending.timer = setTimeout(() => {
    if (battle.pending) finishAttack(battle, null).catch(console.error);
  }, ACTION_TIMEOUT_MS);
  return interaction.update(panelPayload(
    battle,
    `👊 ${me.name} encerrou o turno e atacou com **${attack.name}**! ${defender.name}, escolha sua reação (${ACTION_TIMEOUT_MS / 1000}s).`,
  ));
}

async function handleButton(interaction) {
  const battle = getBattle(interaction.channelId);
  if (!battle || battle.message?.id !== interaction.message.id) {
    return ephemeral(interaction, 'Este painel não está mais ativo.');
  }
  const me = findPlayer(battle, interaction.user.id);
  if (!me) return ephemeral(interaction, 'Você não está nessa batalha.');

  const [kind, arg] = interaction.customId.split(':');

  // Reação do defensor
  if (battle.pending) {
    const defender = opponentOf(battle, battle.pending.attackerId);
    if (kind !== 'react' || me.id !== defender.id) {
      return ephemeral(interaction, `Aguardando a reação de ${defender.name}.`);
    }
    const reaction = me.abilities.includes(arg) ? getAbility(arg) : null;
    return finishAttack(battle, reaction, interaction);
  }

  if (kind === 'react') return ephemeral(interaction, 'Não há ataque para reagir agora.');
  if (currentPlayer(battle).id !== me.id) return ephemeral(interaction, 'Não é o seu turno.');

  if (kind === 'mv') {
    const result = movePlayer(battle, me, arg);
    if (result.error) return ephemeral(interaction, result.error);
    return interaction.update(panelPayload(battle, `🏃 ${me.name} foi para **${formatCoord(me.pos)}**.`));
  }

  if (kind === 'end') return endTurn(battle, me, interaction);
}

module.exports = { handleButton };
