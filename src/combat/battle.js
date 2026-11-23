const { COLUMNS, ROWS, MAX_HP, MAX_MANA, MAX_ENERGY, MOVES_PER_TURN } = require('./config');
const { samePos, DIRECTIONS } = require('./grid');
const { getAbility } = require('./abilities');
const { getKit } = require('./characters');

const battles = new Map(); // channelId -> batalha

// queuedAttack: ataque preparado, resolvido só quando o atacante encerra o turno
const newTurn = () => ({ movesLeft: MOVES_PER_TURN, attacked: false, bonusUsed: false, queuedAttack: null });
const rand = ([min, max]) => min + Math.floor(Math.random() * (max - min + 1));

const newPlayer = (user, pos) => ({
  id: user.id,
  name: user.name,
  hp: MAX_HP,
  mana: MAX_MANA,
  energy: MAX_ENERGY,
  pos,
  abilities: getKit(user.id),
});

function createBattle(channelId, a, b) {
  const battle = {
    channelId,
    players: [
      newPlayer(a, { col: 1, row: 1 }),
      newPlayer(b, { col: COLUMNS.length - 2, row: ROWS - 2 }),
    ],
    current: Math.random() < 0.5 ? 0 : 1,
    round: 1,
    turn: newTurn(),
    message: null, // mensagem do painel atual
    pending: null, // ataque aguardando a reação do defensor
    over: false,
  };
  battles.set(channelId, battle);
  return battle;
}

const getBattle = channelId => battles.get(channelId);

function endBattle(battle) {
  battle.over = true;
  if (battle.pending) clearTimeout(battle.pending.timer);
  battle.pending = null;
  battles.delete(battle.channelId);
}

const currentPlayer = b => b.players[b.current];
const opponentOf = (b, id) => b.players.find(p => p.id !== id);
const findPlayer = (b, id) => b.players.find(p => p.id === id);

// Habilidades do jogador de um tipo ('attack' | 'bonus' | 'reaction')
const abilitiesOf = (player, type) =>
  player.abilities.map(getAbility).filter(a => a && a.type === type);

// Retorna { dest } se o passo for válido, ou { error }
function checkStep(battle, player, dir) {
  const { dc, dr } = DIRECTIONS[dir];
  const dest = { col: player.pos.col + dc, row: player.pos.row + dr };
  if (battle.turn.movesLeft < 1) return { error: 'Você não tem mais movimento neste turno.' };
  if (dest.col < 0 || dest.col >= COLUMNS.length || dest.row < 0 || dest.row >= ROWS) {
    return { error: 'Você não pode sair do mapa.' };
  }
  if (battle.players.some(p => p !== player && samePos(p.pos, dest))) return { error: 'Essa casa está ocupada.' };
  return { dest };
}

function movePlayer(battle, player, dir) {
  const step = checkStep(battle, player, dir);
  if (step.error) return step;
  battle.turn.movesLeft -= 1;
  player.pos = step.dest;
  return step;
}

// Resolve um ataque. reaction: habilidade de reação usada pelo defensor, ou null.
function resolveAttack(attacker, defender, attack, reaction) {
  let damage = rand(attack.damage);
  let log = `${attacker.name} usou **${attack.name}** em ${defender.name} (${damage} de dano).`;

  if (reaction) {
    if (reaction.kind === 'dodge') {
      if (Math.random() < reaction.chance) {
        damage = 0;
        log += `\n${reaction.emoji} ${defender.name} usou **${reaction.name}** e desviou! Nenhum dano.`;
      } else {
        log += `\n${reaction.emoji} ${defender.name} tentou **${reaction.name}**, mas falhou.`;
      }
    } else if (reaction.kind === 'block') {
      const absorbed = Math.min(reaction.absorb, damage);
      damage -= absorbed;
      log += `\n${reaction.emoji} ${defender.name} usou **${reaction.name}** e absorveu ${absorbed} de dano.`;
    }
  }

  defender.hp = Math.max(0, defender.hp - damage);
  log += `\n❤️ ${defender.name} sofreu **${damage}** de dano.`;
  return { damage, log, defeated: defender.hp === 0 };
}

function nextTurn(battle) {
  battle.current = 1 - battle.current;
  if (battle.current === 0) battle.round++;
  battle.turn = newTurn();
}

module.exports = {
  createBattle, getBattle, endBattle, currentPlayer, opponentOf, findPlayer, abilitiesOf,
  checkStep, movePlayer, resolveAttack, nextTurn,
};
