const C = require('./config');
const { gridSizeFor, MOVES_PER_TURN, ENERGY_REGEN_PER_TURN } = C;
const { samePos, distance, DIRECTIONS } = require('./grid');
const { getAbility, resolveAbility } = require('./abilities');
const { getKit, getRanks, getCombatStats } = require('./characters');
const fx = require('./effects');
const { getGrimoire } = require('./grimoires');

// Escala do bônus de atributo: `attributeScale` da habilidade, ou a da raridade do grimório dela, ou 1
const abilityScale = ability => ability.attributeScale ?? C.RARITY_SCALE[getGrimoire(ability.grimoire)?.rarity] ?? 1;

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
    ranks: getRanks(user.id), // id da magia -> rank (ver resolveAbility)
    speed: stats.speed,
    effects: {}, // efeitos ativos (ver effects.js)
    cooldowns: {}, // id da habilidade -> turnos seus que faltam para poder usar de novo
    hpHistory: [stats.maxHp], // vida no início dos seus últimos turnos (usado para voltar no tempo)
  };
}

const rand = ([min, max]) => min + Math.floor(Math.random() * (max - min + 1));

// Dano de um ataque: valor sorteado no intervalo da habilidade + atributo × multiplicador do atributo
const attackDamage = (attacker, attack) =>
  rand(attack.damage) + Math.round((attacker.attrs[attack.attribute] ?? 0) * (C.DAMAGE_PER_POINT[attack.attribute] ?? 0) * abilityScale(attack));

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
    summons: [], // clones invocados (ver summonClones): ocupam casas no mapa e atacam sozinhos no fim do turno do dono
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
// A habilidade `id` no rank do jogador (undefined se não existir)
const abilityOf = (player, id) => resolveAbility(getAbility(id), player.ranks?.[id] ?? 1);

const abilitiesOf = (player, type) =>
  player.abilities.map(id => abilityOf(player, id)).filter(a => a && a.type === type);

// Magias gastam mana (manaCost); o resto gasta energia (energyCost, que efeitos como Sufocamento encarecem)
const resourceOf = ability => (ability.manaCost !== undefined ? 'mana' : 'energy');
const resourceLabel = ability => (resourceOf(ability) === 'mana' ? 'mana' : 'energia');
const abilityCost = (player, ability) => (resourceOf(ability) === 'mana'
  ? ability.manaCost
  : Math.ceil(ability.energyCost * fx.getMods(player).energyCostMult));
const canAfford = (player, ability) => player[resourceOf(ability)] >= abilityCost(player, ability);
// Desconta o custo do recurso certo e retorna quanto foi gasto
function spend(player, ability) {
  const cost = abilityCost(player, ability);
  const res = resourceOf(ability);
  player[res] = Math.max(0, player[res] - cost);
  return cost;
}

// Motivo pelo qual o jogador não pode usar essa reação agora (ou null se pode)
function reactionBlock(player, reaction, attack) {
  const mods = fx.getMods(player);
  if (mods.noReact) return 'não consegue reagir';
  if (reaction.onlyVsMagic && attack && !attack.magic) return 'só pode usar isso contra magia';
  if (mods.noDodge && reaction.kind === 'dodge') return 'não consegue esquivar';
  if (!canAfford(player, reaction)) return 'sem recurso';
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
  if (isOccupied(battle, dest, player)) return { error: 'Essa casa está ocupada.' };
  return { dest };
}

// A casa tem um jogador ou um clone? `except` é quem está perguntando (não conta contra si mesmo)
const isOccupied = (battle, pos, except) =>
  battle.players.some(p => p !== except && p.pos && samePos(p.pos, pos))
  || (battle.summons ?? []).some(s => s !== except && samePos(s.pos, pos));

const inBounds = (battle, { col, row }) => col >= 0 && col < battle.cols && row >= 0 && row < battle.rows;

// Planeja o teleporte de uma ação bônus (`teleport: 'self' | 'enemy'`): o destino é N casas numa direção (o mapa não mostra
// coordenadas no combate). Retorna { dest } (ou {} se a habilidade não teleporta) ou { error }.
function planBonus(battle, me, ability, dir, steps) {
  const foe = opponentOf(battle, me.id);
  if (ability.targetRange !== undefined && distance(me.pos, foe.pos) > ability.targetRange) {
    return { error: `Alvo fora de alcance: **${ability.name}** alcança ${ability.targetRange} casas (sem diagonal).` };
  }
  if (!ability.teleport) return {};
  const who = ability.teleport === 'self' ? me : foe;
  if (ability.teleport === 'self' && fx.getMods(me).noMove) return { error: 'Você está imobilizado: nem um portal tira você daqui.' };
  if (!dir || !steps) return { error: `**${ability.name}** precisa de \`direcao\` e \`casas\` (até ${ability.destRange}) para saber para onde levar ${ability.teleport === 'self' ? 'você' : 'o alvo'}.` };
  if (steps > ability.destRange) return { error: `**${ability.name}** leva no máximo ${ability.destRange} casas.` };
  const { dc, dr } = DIRECTIONS[dir];
  const dest = { col: who.pos.col + dc * steps, row: who.pos.row + dr * steps };
  if (!inBounds(battle, dest)) return { error: 'Esse destino fica fora do mapa.' };
  if (isOccupied(battle, dest, who)) return { error: 'Essa casa está ocupada.' };
  return { dest };
}

// Casas livres do mapa, da mais próxima de `from` para a mais distante
function freeCellsNear(battle, from, except) {
  const cells = [];
  for (let col = 0; col < battle.cols; col++) {
    for (let row = 0; row < battle.rows; row++) {
      const pos = { col, row };
      if (!isOccupied(battle, pos, except)) cells.push(pos);
    }
  }
  return cells.sort((a, b) => distance(a, from) - distance(b, from));
}

// Invoca clones de `owner` nas casas livres mais próximas. Invocar de novo troca os clones antigos pelos novos.
function summonClones(battle, owner, ability) {
  const { count, duration, damage, share } = ability.summon;
  battle.summons = battle.summons.filter(s => s.ownerId !== owner.id);
  const cells = freeCellsNear(battle, owner.pos, null).filter(c => !samePos(c, owner.pos)).slice(0, count);
  for (const pos of cells) {
    battle.summons.push({
      ownerId: owner.id, name: `Clone de ${owner.name}`, pos, damage, turns: duration,
      bonus: Math.round((owner.attrs[ability.attribute] ?? 0) * (C.DAMAGE_PER_POINT[ability.attribute] ?? 0) * abilityScale(ability) * share),
    });
  }
  return [`👥 ${owner.name} fez ${cells.length} figura(s) brotarem do chão. Elas atacam sozinhas por ${duration} turno(s) seus.`];
}

// Efeitos de posição e invocação de uma ação bônus (o teleporte já foi planejado por planBonus)
function applyBonus(battle, me, ability, dest) {
  const foe = opponentOf(battle, me.id);
  const lines = [];
  if (ability.teleport === 'self') { me.pos = dest; lines.push(`🌀 ${me.name} atravessou um portal e reapareceu em outro ponto do mapa.`); }
  if (ability.teleport === 'enemy') { foe.pos = dest; lines.push(`⬛ ${foe.name} foi engolido pela escuridão e levado para outro ponto do mapa.`); }
  if (ability.summon) lines.push(...summonClones(battle, me, ability));
  return lines;
}

// No fim do turno do dono, cada clone anda até 2 casas rumo ao inimigo e, se ficar colado nele, ataca (sem reação).
// Retorna { lines, defeated, loser }.
function runSummons(battle, owner) {
  const foe = opponentOf(battle, owner.id);
  const lines = [];
  for (const s of battle.summons.filter(x => x.ownerId === owner.id)) {
    for (let i = 0; i < C.MOVES_PER_TURN && distance(s.pos, foe.pos) > 1; i++) {
      const steps = Object.values(DIRECTIONS)
        .map(({ dc, dr }) => ({ col: s.pos.col + dc, row: s.pos.row + dr }))
        .filter(p => inBounds(battle, p) && !isOccupied(battle, p, s))
        .sort((a, b) => distance(a, foe.pos) - distance(b, foe.pos));
      if (!steps.length || distance(steps[0], foe.pos) >= distance(s.pos, foe.pos)) break;
      s.pos = steps[0];
    }
    if (distance(s.pos, foe.pos) <= 1) {
      const dmg = Math.max(1, rand(s.damage) + s.bonus);
      foe.hp = Math.max(0, foe.hp - dmg);
      lines.push(`🗡️ ${s.name} atacou ${foe.name} (**${dmg}** de dano).`, ...fx.onHit(foe));
      if (foe.hp === 0) return { lines, defeated: true, loser: foe };
    }
    s.turns -= 1;
  }
  const expired = battle.summons.filter(s => s.ownerId === owner.id && s.turns <= 0);
  if (expired.length) lines.push(`👥 ${expired.length} clone(s) de ${owner.name} se desfizeram.`);
  battle.summons = battle.summons.filter(s => !(s.ownerId === owner.id && s.turns <= 0));
  return { lines, defeated: false, loser: null };
}

// Teletransporta `target` para uma casa livre aleatória a pelo menos `minDist` casas de `from`. Retorna true se moveu.
function displaceFar(battle, target, from, minDist) {
  const options = freeCellsNear(battle, from, target).filter(c => distance(c, from) >= minDist);
  if (!options.length) return false;
  target.pos = options[Math.floor(Math.random() * options.length)];
  return true;
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
// `battle` é opcional: só é preciso para golpes que mexem no mapa (displace)
function resolveAttack(attacker, defender, attack, reaction, battle) {
  // Dano bruto: golpe + bônus de efeitos do atacante, com chance de crítico e vulnerabilidade do alvo ao elemento
  let raw = attackDamage(attacker, attack) + fx.getMods(attacker).damageBonus;
  const crit = Math.random() < C.CRIT_CHANCE_BASE + fx.getMods(attacker).critChance;
  if (crit) raw *= C.CRIT_MULTIPLIER;
  const vuln = fx.vulnerability(defender, attack.element);
  let damage = Math.max(1, Math.round(raw * vuln));
  let log = `${attacker.name} usou **${attack.name}** em ${defender.name} (${damage} de dano).`;
  if (crit) log += `\n💥 **Golpe crítico!**`;
  if (vuln > 1) log += `\n💧 ${defender.name} está vulnerável a esse elemento (dano x${vuln.toFixed(1)}).`;

  if (reaction) {
    if (reaction.kind === 'dodge') {
      const chance = Math.max(0, Math.min(
        C.DODGE_CHANCE_CAP,
        reaction.chance + defender.attrs.destreza * C.DODGE_CHANCE_PER_DEXTERITY + fx.getMods(defender).dodgeDelta - (attack.dodgePenalty ?? 0), // golpes que cercam ou perseguem o alvo (dodgePenalty) são mais difíceis de esquivar
      ));
      if (Math.random() < chance) {
        damage = 0;
        log += `\n${reaction.emoji} ${defender.name} usou **${reaction.name}** e desviou! Nenhum dano.`;
      } else {
        log += `\n${reaction.emoji} ${defender.name} tentou **${reaction.name}**, mas falhou.`;
      }
    } else if (reaction.kind === 'capture') {
      // Captura a magia: ela é anulada; se a reação tiver `applies`, quem a lançou sofre esses efeitos
      damage = 0;
      log += `\n${reaction.emoji} ${defender.name} usou **${reaction.name}** e capturou a magia!`;
      const lines = fx.applyAbilityEffects(reaction, defender, attacker);
      if (lines.length) log += `\n${lines.join('\n')}`;
      if (reaction.drainMana) { // domina a mana do atacante junto com a magia
        const lost = Math.min(attacker.mana, reaction.drainMana);
        attacker.mana -= lost;
        log += `\n🔷 ${attacker.name} perdeu ${lost} de mana.`;
      }
    } else if (reaction.kind === 'reflect') {
      // Devolve parte da magia ao lançador (nunca o mata: sobra pelo menos 1 de vida)
      const back = Math.round(damage * reaction.reflect);
      damage = 0;
      attacker.hp = Math.max(1, attacker.hp - back);
      log += `\n${reaction.emoji} ${defender.name} abriu um portal e devolveu a magia: ${attacker.name} sofreu **${back}** de dano!`;
    } else if (reaction.kind === 'block' && attack.ignoreBlock) {
      log += `\n${reaction.emoji} ${defender.name} usou **${reaction.name}**, mas **${attack.name}** apaga tudo que toca: nada foi absorvido.`;
    } else if (reaction.kind === 'block') {
      // Defesa escala como um ataque: valor sorteado + atributo × multiplicador (Bloqueio usa Resistência; defesas mágicas, Magia Defensiva)
      const absorbed = Math.min(damage, rand(reaction.absorb) + Math.round((defender.attrs[reaction.attribute] ?? 0) * (C.DEFENSE_PER_POINT[reaction.attribute] ?? 0) * abilityScale(reaction)));
      damage -= absorbed;
      log += `\n${reaction.emoji} ${defender.name} usou **${reaction.name}** e absorveu ${absorbed} de dano.`;
    }
  }

  defender.hp = Math.max(0, defender.hp - damage);
  log += `\n❤️ ${defender.name} sofreu **${damage}** de dano.`;
  if (reaction) {
    const cost = spend(defender, reaction);
    log += `\n${resourceOf(reaction) === 'mana' ? '🔷' : '⚡'} ${defender.name} gastou ${cost} de ${resourceLabel(reaction)}.`;
  }

  // Efeitos: só se o golpe causou dano e o alvo continua de pé (o golpe também pode acordar/descongelar o alvo)
  if (damage > 0 && defender.hp > 0) {
    const lines = [...fx.onHit(defender, attack.element), ...fx.applyAbilityEffects(attack, attacker, defender)];
    if (battle && attack.displace && displaceFar(battle, defender, attacker.pos, attack.displace)) {
      lines.push(`🌀 ${defender.name} foi atingido e teletransportado para outro ponto do mapa!`);
    }
    if (lines.length) log += `\n${lines.join('\n')}`;
  }
  return { damage, log, defeated: defender.hp === 0 };
}

// Passa a vez. Antes, o fim do turno de quem jogava: dano contínuo, drenagem de energia e contagem dos efeitos.
// Retorna { log, defeated, loser }: o log lista o que os efeitos fizeram; `defeated` se alguém caiu por eles.
function nextTurn(battle) {
  const leaving = currentPlayer(battle);
  const end = fx.endOfTurn(leaving);
  let loser = end.defeated ? leaving : null;
  if (!end.defeated) {
    // Os clones de quem terminou o turno agem agora; se derrubarem o inimigo, a batalha acaba
    const summons = runSummons(battle, leaving);
    end.lines.push(...summons.lines);
    if (summons.defeated) { end.defeated = true; loser = summons.loser; }
  }
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
  return { log: end.lines.join('\n'), defeated: end.defeated, loser };
}

module.exports = {
  createBattle, getBattle, endBattle, currentPlayer, opponentOf, findPlayer, abilitiesOf, abilityOf, abilityCost, resourceOf, resourceLabel, canAfford, spend, reactionBlock, clampMoves,
  planBonus, applyBonus, isOccupied, placePlayer, allPlaced, checkStep, movePlayer, startActions, resolveAttack, nextTurn,
};
