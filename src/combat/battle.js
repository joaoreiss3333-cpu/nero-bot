const C = require('./config');
const { gridSizeFor, MOVES_PER_TURN, ENERGY_REGEN_PER_TURN } = C;
const { samePos, DIRECTIONS } = require('./grid');
const { getAbility } = require('./abilities');
const { getKit, getCombatStats } = require('./characters');

const battles = new Map(); // channelId -> batalha

// Todo turno começa pela movimentação (phase 'move') e depois passa para as ações (phase 'action'),
// quando ataque e ação bônus ficam liberados e o movimento fecha.
// queuedAttack: ataque preparado, resolvido só quando o atacante encerra o turno
const newTurn = () => ({
  phase: 'move', movesLeft: MOVES_PER_TURN, attacked: false, bonusUsed: false, queuedAttack: null,
});

// Os números do personagem (vida, mana, energia, atributos) vêm da ficha no momento em que a batalha começa
function newPlayer(user) {
  const stats = getCombatStats(user.id);
  return {
    id: user.id,
    name: user.name,
    level: stats.level,
    attrs: stats.attrs,
    maxHp: stats.maxHp,
    maxMana: stats.maxMana,
    maxEnergy: stats.maxEnergy,
    hp: stats.maxHp,
    mana: stats.maxMana,
    energy: stats.maxEnergy,
    pos: null, // definida na fase de posicionamento
    abilities: getKit(user.id),
    speed: stats.speed,
  };
}

const rand = ([min, max]) => min + Math.floor(Math.random() * (max - min + 1));

// Dano de um ataque: valor sorteado no intervalo da habilidade + atributo × multiplicador do atributo
const attackDamage = (attacker, attack) =>
  rand(attack.damage) + Math.round((attacker.attrs[attack.attribute] ?? 0) * (C.DAMAGE_PER_POINT[attack.attribute] ?? 0));

// Maior velocidade começa; se empatar, sorteia entre os mais rápidos
function whoStarts(players) {
  const top = Math.max(...players.map(p => p.speed));
  const fastest = players.flatMap((p, i) => (p.speed === top ? [i] : []));
  return fastest[Math.floor(Math.random() * fastest.length)];
}

// users: { id, name } de cada participante. O tamanho do mapa cresce com o número de jogadores.
function createBattle(channelId, ...users) {
  const players = users.map(newPlayer);
  const { cols, rows } = gridSizeFor(players.length);
  const battle = {
    channelId,
    players,
    cols,
    rows,
    phase: 'placement', // 'placement' (escolha dos setores iniciais) -> 'combat'
    current: whoStarts(players),
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

// Escolhe o setor inicial. Pode ser trocado até o oponente também escolher.
function placePlayer(battle, player, pos) {
  if (battle.players.some(p => p !== player && p.pos && samePos(p.pos, pos))) {
    return { error: 'Esse setor não está disponível. Escolha outro.' };
  }
  player.pos = pos;
  return { pos };
}

const allPlaced = battle => battle.players.every(p => p.pos);

// Retorna { dest } se o passo for válido, ou { error }
function checkStep(battle, player, dir) {
  const { dc, dr } = DIRECTIONS[dir];
  const dest = { col: player.pos.col + dc, row: player.pos.row + dr };
  if (battle.turn.phase !== 'move') return { error: 'A fase de movimento já acabou neste turno.' };
  if (battle.turn.movesLeft < 1) return { error: 'Você não tem mais movimento neste turno.' };
  if (dest.col < 0 || dest.col >= battle.cols || dest.row < 0 || dest.row >= battle.rows) {
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
  if (battle.turn.movesLeft < 1) battle.turn.phase = 'action'; // gastou todo o movimento: libera as ações
  return step;
}

// Encerra a fase de movimento (mesmo sem ter se movido) e libera ataque e ação bônus
function startActions(battle) {
  battle.turn.phase = 'action';
}

// Resolve um ataque. reaction: habilidade de reação usada pelo defensor, ou null.
function resolveAttack(attacker, defender, attack, reaction) {
  // A Resistência do defensor corta uma porcentagem do golpe (sempre sobra pelo menos 1 de dano)
  const cut = Math.min(C.RESISTANCE_REDUCTION_CAP, defender.attrs.resistencia * C.RESISTANCE_REDUCTION_PER_POINT);
  let damage = Math.max(1, Math.round(attackDamage(attacker, attack) * (1 - cut)));
  let log = `${attacker.name} usou **${attack.name}** em ${defender.name} (${damage} de dano).`;

  if (reaction) {
    if (reaction.kind === 'dodge') {
      const chance = Math.min(C.DODGE_CHANCE_CAP, reaction.chance + defender.attrs.destreza * C.DODGE_CHANCE_PER_DEXTERITY);
      if (Math.random() < chance) {
        damage = 0;
        log += `\n${reaction.emoji} ${defender.name} usou **${reaction.name}** e desviou! Nenhum dano.`;
      } else {
        log += `\n${reaction.emoji} ${defender.name} tentou **${reaction.name}**, mas falhou.`;
      }
    } else if (reaction.kind === 'block') {
      const share = Math.min(C.BLOCK_ABSORB_CAP, reaction.absorb + defender.attrs.resistencia * C.RESISTANCE_BLOCK_BONUS);
      const absorbed = Math.round(damage * share);
      damage -= absorbed;
      log += `\n${reaction.emoji} ${defender.name} usou **${reaction.name}** e absorveu ${absorbed} de dano.`;
    }
  }

  defender.hp = Math.max(0, defender.hp - damage);
  log += `\n❤️ ${defender.name} sofreu **${damage}** de dano.`;
  if (reaction) {
    defender.energy = Math.max(0, defender.energy - reaction.energyCost);
    log += `\n⚡ ${defender.name} gastou ${reaction.energyCost} de energia.`;
  }
  return { damage, log, defeated: defender.hp === 0 };
}

function nextTurn(battle) {
  battle.current = (battle.current + 1) % battle.players.length;
  if (battle.current === 0) battle.round++;
  battle.turn = newTurn();
  const p = currentPlayer(battle);
  p.energy = Math.min(p.maxEnergy, p.energy + ENERGY_REGEN_PER_TURN);
}

module.exports = {
  createBattle, getBattle, endBattle, currentPlayer, opponentOf, findPlayer, abilitiesOf,
  placePlayer, allPlaced, checkStep, movePlayer, startActions, resolveAttack, nextTurn,
};
