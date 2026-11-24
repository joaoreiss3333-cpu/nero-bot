const C = require('./config');
const { gridSizeFor, MOVES_PER_TURN, ENERGY_REGEN_PER_TURN } = C;
const { samePos, DIRECTIONS } = require('./grid');
const { getAbility } = require('./abilities');
const { getKit, getCombatStats } = require('./characters');
const fx = require('./effects');

const battles = new Map(); // channelId -> batalha

// Todo turno começa pela movimentação (phase 'move') e depois passa para as ações (phase 'action'),
// quando ataque e ação bônus ficam liberados e o movimento fecha.
// queuedAttack: ataque preparado, resolvido só quando o atacante encerra o turno
const movesFor = player => {
  const mods = fx.getMods(player);
  return mods.noMove ? 0 : Math.max(0, MOVES_PER_TURN + mods.moveDelta);
};

const newTurn = player => ({
  phase: 'move', movesLeft: movesFor(player), attacked: false, bonusUsed: false, queuedAttack: null,
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
    effects: {}, // efeitos ativos (ver effects.js)
    cooldowns: {}, // id da habilidade -> turnos seus que faltam para poder usar de novo
    hpHistory: [stats.maxHp], // vida no início dos seus últimos turnos (usado para voltar no tempo)
  };
}

const rand = ([min, max]) => min + Math.floor(Math.random() * (max - min + 1));

// Dano de um ataque: valor sorteado no intervalo da habilidade + atributo × multiplicador do atributo
const attackDamage = (attacker, attack) =>
  rand(attack.damage) + Math.round((attacker.attrs[attack.attribute] ?? 0) * (C.DAMAGE_PER_POINT[attack.attribute] ?? 0) * (attack.attributeScale ?? 1));

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
    turn: null, // criado logo abaixo, depois de saber quem começa
    message: null, // mensagem do painel atual
    pending: null, // ataque aguardando a reação do defensor
    over: false,
  };
  battle.turn = newTurn(players[battle.current]);
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

// Energia que a habilidade custa de verdade (efeitos como Sufocamento encarecem)
const energyCost = (player, ability) => Math.ceil(ability.energyCost * fx.getMods(player).energyCostMult);

// Motivo pelo qual o jogador não pode usar essa reação agora (ou null se pode)
function reactionBlock(player, reaction, attack) {
  const mods = fx.getMods(player);
  if (mods.noReact) return 'não consegue reagir';
  if (reaction.onlyVsMagic && attack && !attack.magic) return 'só pode usar isso contra magia';
  if (mods.noDodge && reaction.kind === 'dodge') return 'não consegue esquivar';
  if (player.energy < energyCost(player, reaction)) return 'sem energia';
  return null;
}

// Depois de um efeito novo no meio do turno (ex: Lentidão), o movimento que sobrou nunca passa do permitido
const clampMoves = (battle, player) => {
  if (currentPlayer(battle) === player) battle.turn.movesLeft = Math.min(battle.turn.movesLeft, movesFor(player));
};

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
  if (fx.getMods(player).noMove) return { error: 'Você está imobilizado e não pode se mover.' };
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
  // Dano bruto: golpe + bônus de efeitos do atacante, com chance de crítico e vulnerabilidade do alvo ao elemento
  let raw = attackDamage(attacker, attack) + fx.getMods(attacker).damageBonus;
  const crit = Math.random() < C.CRIT_CHANCE_BASE + fx.getMods(attacker).critChance;
  if (crit) raw *= C.CRIT_MULTIPLIER;
  const vuln = fx.vulnerability(defender, attack.element);
  let damage = Math.max(1, Math.round(raw * vuln * (1 - cut)));
  let log = `${attacker.name} usou **${attack.name}** em ${defender.name} (${damage} de dano).`;
  if (crit) log += `\n💥 **Golpe crítico!**`;
  if (vuln > 1) log += `\n💧 ${defender.name} está vulnerável a esse elemento (dano x${vuln.toFixed(1)}).`;

  if (reaction) {
    if (reaction.kind === 'dodge') {
      const chance = Math.max(0, Math.min(
        C.DODGE_CHANCE_CAP,
        reaction.chance + defender.attrs.destreza * C.DODGE_CHANCE_PER_DEXTERITY + fx.getMods(defender).dodgeDelta,
      ));
      if (Math.random() < chance) {
        damage = 0;
        log += `\n${reaction.emoji} ${defender.name} usou **${reaction.name}** e desviou! Nenhum dano.`;
      } else {
        log += `\n${reaction.emoji} ${defender.name} tentou **${reaction.name}**, mas falhou.`;
      }
    } else if (reaction.kind === 'capture') {
      // Captura a magia: ela é anulada e quem a lançou sofre os efeitos da reação (ex: Estase Temporal)
      damage = 0;
      log += `\n${reaction.emoji} ${defender.name} usou **${reaction.name}** e capturou a magia!`;
      const lines = fx.applyAbilityEffects(reaction, defender, attacker);
      if (lines.length) log += `\n${lines.join('\n')}`;
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
    const cost = energyCost(defender, reaction);
    defender.energy = Math.max(0, defender.energy - cost);
    log += `\n⚡ ${defender.name} gastou ${cost} de energia.`;
  }

  // Efeitos: só se o golpe causou dano e o alvo continua de pé (o golpe também pode acordar/descongelar o alvo)
  if (damage > 0 && defender.hp > 0) {
    const lines = [...fx.onHit(defender, attack.element), ...fx.applyAbilityEffects(attack, attacker, defender)];
    if (lines.length) log += `\n${lines.join('\n')}`;
  }
  return { damage, log, defeated: defender.hp === 0 };
}

// Passa a vez. Antes, o fim do turno de quem jogava: dano contínuo, drenagem de energia e contagem dos efeitos.
// Retorna { log, defeated, loser }: o log lista o que os efeitos fizeram; `defeated` se alguém caiu por eles.
function nextTurn(battle) {
  const leaving = currentPlayer(battle);
  const end = fx.endOfTurn(leaving);
  for (const id of Object.keys(leaving.cooldowns)) {
    leaving.cooldowns[id] -= 1;
    if (leaving.cooldowns[id] <= 0) delete leaving.cooldowns[id];
  }

  battle.current = (battle.current + 1) % battle.players.length;
  if (battle.current === 0) battle.round++;
  const p = currentPlayer(battle);
  p.hpHistory = [...p.hpHistory, p.hp].slice(-2);
  battle.turn = newTurn(p);
  p.energy = Math.min(p.maxEnergy, p.energy + ENERGY_REGEN_PER_TURN);
  return { log: end.lines.join('\n'), defeated: end.defeated, loser: end.defeated ? leaving : null };
}

module.exports = {
  createBattle, getBattle, endBattle, currentPlayer, opponentOf, findPlayer, abilitiesOf, energyCost, reactionBlock, clampMoves,
  placePlayer, allPlaced, checkStep, movePlayer, startActions, resolveAttack, nextTurn,
};
