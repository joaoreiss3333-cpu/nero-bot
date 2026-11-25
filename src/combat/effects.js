// Efeitos de combate (queimadura, lentidão, buffs...). Cada efeito é um dado do catálogo EFFECTS:
//   kind        'debuff' (colocado no adversário) ou 'buff' (colocado em si mesmo)
//   stackable   se aplicar de novo soma stacks (até config.EFFECT_MAX_STACKS); senão só renova a duração
//   dot         dano por stack no fim do turno de quem tem o efeito (a Resistência não reduz: ela só serve para o Bloqueio)
//   drainEnergy energia perdida por stack no fim do turno
//   mods        modificadores enquanto o efeito está ativo (ver getMods)
//   stackMods   { stacks: mods } -> modificadores extras a partir de N stacks
//   lowHpMods   modificadores extras quando a vida do dono está abaixo de 50%
//   vulnerable  { elemento: multiplicador } -> o dono leva mais dano desse elemento
//   endsOnHit   o efeito acaba quando o dono sofre dano direto; endsOnElement: ... só se o golpe for desse elemento
//               (golpes com `keepsAsleep` na habilidade, como as magias dos Sonhos, não acordam o Sonolento)
//   eachTurn    { effect, turns, stacks } -> aplica esse efeito no dono no fim de cada turno dele (ex: sono crescente)
//
// A duração (turnos), os stacks e a força (`power`, dano por stack) vêm da habilidade que aplica:
//   applies: [{ effect: 'sangramento', turns: 3, stacks: 1, power: 2, to: 'enemy' | 'self' }]
// Os turnos contam no FIM de cada turno de quem tem o efeito (o dano contínuo também acontece nessa hora).
const C = require('./config');

const EFFECTS = {
  sangramento: { name: 'Sangramento', emoji: '🩸', kind: 'debuff', stackable: true, dot: 1 },
  queimadura: { name: 'Queimadura', emoji: '🔥', kind: 'debuff', dot: 2 },
  envenenado: { name: 'Envenenado', emoji: '☠️', kind: 'debuff', stackable: true, dot: 1 }, // dano contínuo: só some quando o efeito acaba ou é removido
  encharcado: { name: 'Encharcado', emoji: '💧', kind: 'debuff', vulnerable: { relampago: 1.3, gelo: 1.3 } },
  enraizado: { name: 'Enraizado', emoji: '🌿', kind: 'debuff', mods: { noMove: true } },
  atordoado: { name: 'Atordoado', emoji: '💫', kind: 'debuff', mods: { noAct: true, noMove: true, noReact: true, skipTurn: true } }, // perde o turno inteiro (passa sozinho)
  congelado: { name: 'Congelado', emoji: '🧊', kind: 'debuff', mods: { noMove: true, noDodge: true }, endsOnElement: 'fogo' },
  estase: { name: 'Estase Temporal', emoji: '🕰️', kind: 'debuff', mods: { noMove: true, noReact: true } }, // preso num loop do tempo: imóvel e sem reação, mas ainda pode atacar
  esfera_dimensional: { name: 'Esfera Dimensional', emoji: '🔮', kind: 'debuff', mods: { noMove: true } }, // barreira esférica ao redor do alvo: impede a fuga
  sala_vermelha: { name: 'Sala Vermelha', emoji: '🟥', kind: 'debuff', mods: { noMove: true, dodgeDelta: -0.2 } }, // preso num cubo vermelho: sem fuga e com pouco espaço para esquivar
  lentidao: { name: 'Lentidão', emoji: '🐌', kind: 'debuff', mods: { moveDelta: -1, dodgeDelta: -0.15 } },
  cegueira: { name: 'Cegueira', emoji: '🙈', kind: 'debuff', mods: { missChance: 0.4 } },
  escuridao: { name: 'Escuridão', emoji: '🌑', kind: 'debuff', mods: { visionCap: 2 } },
  sufocamento: { name: 'Sufocamento', emoji: '😮‍💨', kind: 'debuff', drainEnergy: 5, mods: { energyCostMult: 1.5 } },
  sonolento: {
    name: 'Sonolento', emoji: '😴', kind: 'debuff', stackable: true, endsOnHit: true,
    mods: { oneAction: true }, stackMods: { 3: { noAct: true } }, // com 3 stacks o alvo dorme de vez
  },
  // Buraco negro ao redor de quem usou: apaga parte da magia que o atinge (e libera o Impulso da Morte)
  lua_negra: { name: 'Lua Negra', emoji: '🌑', kind: 'buff', mods: { magicResist: 0.35 } },
  // Galhos da Formação Dracaena envolvem e protegem: reduzem todo dano recebido
  abrigo_dracaena: { name: 'Abrigo Dracaena', emoji: '🌳', kind: 'buff', mods: { damageResist: 0.3 } },
  // Sonhos: quem abriu o Mundo do Glamour (libera as outras magias dos Sonhos)
  mundo_do_glamour: { name: 'Mundo do Glamour', emoji: '🌙', kind: 'buff' },
  // Preso no mundo dos sonhos: fica mais sonolento a cada turno e sofre mais dano das magias dos Sonhos
  preso_no_sonho: {
    name: 'Preso no Sonho', emoji: '💭', kind: 'debuff', vulnerable: { sonho: 1.25 },
    eachTurn: { effect: 'sonolento', turns: 2 },
  },
  // Cópia: enquanto ativo, quem usou pode lançar as magias copiadas (ver battle.copiedOf). Quando acaba, a cópia se desfaz.
  magia_copiada: { name: 'Magia Copiada', emoji: '📋', kind: 'buff' },
  // Sangue: os golpes de sangue marcam o alvo; só quem tem a marca pode virar Marionete
  marca_de_sangue: { name: 'Marca de Sangue', emoji: '🔴', kind: 'debuff' },
  // Preso nos crucifixos do Andaime: sem se mover e sem esquivar
  crucificado: { name: 'Crucificado', emoji: '✝️', kind: 'debuff', mods: { noMove: true, noDodge: true } },
  // Controlado pelo próprio sangue: dor intensa (dano por turno) e sem conseguir reagir
  marionete: { name: 'Marionete de Sangue', emoji: '🪢', kind: 'debuff', dot: 3, mods: { noReact: true } },
  // Besta Vermelha: sangue denso que segura golpes fortes; muita água a dilui
  besta_vermelha: { name: 'Besta Vermelha', emoji: '👹', kind: 'buff', mods: { damageResist: 0.3 }, endsOnElement: 'agua' },
  // Transfusão do Casulo de Sangue: o alvo curado sai fortalecido
  transfusao: { name: 'Transfusão', emoji: '💉', kind: 'buff', mods: { damageBonus: 4 } },
  // Pintura: preso no poço de tinta em forma de mola da Primavera da Restrição
  mola_de_tinta: { name: 'Mola de Tinta', emoji: '🎨', kind: 'debuff', mods: { noMove: true, dodgeDelta: -0.25 } },
  // Perfume da Barreira de Espinhos e Rosas: os sentidos confusos fazem errar golpes
  perfume_de_rosas: { name: 'Perfume de Rosas', emoji: '🌹', kind: 'debuff', mods: { missChance: 0.2 } },
  // Monarca Absoluto do Brilho Sagrado: a imagem gigante de luz reforça os golpes e protege o dono
  monarca_absoluto: { name: 'Monarca Absoluto', emoji: '👑', kind: 'buff', mods: { damageBonus: 6, damageResist: 0.2 } },
  // Estrela de Prata da Execução: preso na gaiola de mercúrio, sem fugir nem contra-atacar
  gaiola_de_prata: { name: 'Gaiola de Prata', emoji: '⭐', kind: 'debuff', mods: { noMove: true, noReact: true } },
  // O cenário do sonho se ergue para proteger quem o manipula
  cenario_onirico: { name: 'Cenário Onírico', emoji: '🏔️', kind: 'buff', mods: { damageResist: 0.25 } },
  instinto_selvagem: {
    name: 'Instinto Selvagem', emoji: '🐺', kind: 'buff',
    mods: { damageBonus: 3, moveDelta: 1 }, lowHpMods: { damageBonus: 3 },
  },
  brilho_estelar: {
    name: 'Brilho Estelar', emoji: '✨', kind: 'buff',
    mods: { damageBonus: 2, dodgeDelta: 0.15, critChance: 0.2 },
  },
};

const getEffect = id => EFFECTS[id];

const NEUTRAL_MODS = () => ({
  moveDelta: 0, dodgeDelta: 0, damageBonus: 0, critChance: 0, missChance: 0, magicResist: 0, damageResist: 0, // magicResist: fração do dano de magia que o dono não sofre
  visionCap: Infinity, energyCostMult: 1,
  noMove: false, noAct: false, noReact: false, noDodge: false, oneAction: false, skipTurn: false,
});

function mergeMods(total, mods) {
  for (const [key, value] of Object.entries(mods)) {
    if (typeof value === 'boolean') total[key] = total[key] || value;
    else if (key === 'energyCostMult') total[key] *= value;
    else if (key === 'visionCap') total[key] = Math.min(total[key], value);
    else total[key] += value;
  }
}

const effectsOf = player => (player.effects ??= {});

const hasEffect = (player, id) => !!effectsOf(player)[id];

// Soma os modificadores de todos os efeitos ativos do jogador
function getMods(player) {
  const total = NEUTRAL_MODS();
  for (const [id, state] of Object.entries(effectsOf(player))) {
    const def = EFFECTS[id];
    if (def.mods) mergeMods(total, def.mods);
    for (const [need, mods] of Object.entries(def.stackMods ?? {})) {
      if (state.stacks >= Number(need)) mergeMods(total, mods);
    }
    if (def.lowHpMods && player.hp < player.maxHp / 2) mergeMods(total, def.lowHpMods);
  }
  return total;
}

// Multiplicador de dano que o jogador sofre de um golpe de certo elemento (ex: Encharcado + relâmpago)
function vulnerability(player, element) {
  if (!element) return 1;
  return Object.keys(effectsOf(player)).reduce((mult, id) => mult * (EFFECTS[id].vulnerable?.[element] ?? 1), 1);
}

function removeEffect(player, id) {
  delete effectsOf(player)[id];
}

// Aplica um efeito. Retorna a linha de log (ou '' se nada mudou). Aplicar de novo renova a duração
// (fica a maior) e, se o efeito acumula, soma stacks até o limite.
function applyEffect(player, id, { turns = 2, stacks = 1, power } = {}) {
  const def = EFFECTS[id];
  if (!def) return '';
  const active = effectsOf(player);
  let extra = '';

  // Interações entre efeitos
  if (id === 'queimadura') {
    if (active.encharcado) {
      removeEffect(player, 'encharcado');
      return `💨 O fogo evaporou o **Encharcado** de ${player.name}.`; // o vapor consome as duas coisas
    }
    if (active.congelado) {
      removeEffect(player, 'congelado');
      extra = `\n🧊 O calor descongelou ${player.name}.`;
    }
  }
  if (id === 'encharcado' && active.queimadura) {
    removeEffect(player, 'queimadura');
    extra = `\n💨 A água apagou a **Queimadura** de ${player.name}.`;
  }

  const current = active[id];
  active[id] = {
    stacks: def.stackable ? Math.min(C.EFFECT_MAX_STACKS, (current?.stacks ?? 0) + stacks) : 1,
    turns: Math.max(current?.turns ?? 0, turns),
    power: Math.max(current?.power ?? 0, power ?? def.dot ?? 0),
  };
  const s = active[id].stacks;
  return `${def.emoji} ${player.name} recebeu **${def.name}**${s > 1 ? ` (x${s})` : ''} por ${active[id].turns} turno(s).${extra}`;
}

// Aplica os efeitos de uma habilidade. `hit` = o golpe acertou (efeitos em quem ataca valem sempre).
function applyAbilityEffects(ability, source, target, { hit = true, defaultTo = 'enemy' } = {}) {
  const lines = [];
  for (const entry of ability.applies ?? []) {
    const to = entry.to ?? defaultTo;
    if (to === 'enemy' && !hit) continue;
    if (entry.chance !== undefined && Math.random() >= entry.chance) continue;
    const line = applyEffect(to === 'self' ? source : target, entry.effect, entry);
    if (line) lines.push(line);
  }
  return lines;
}

// Remove todos os debuffs do jogador (os buffs ficam). Retorna os nomes removidos.
function clearDebuffs(player) {
  const removed = [];
  for (const id of Object.keys(effectsOf(player))) {
    if (EFFECTS[id].kind === 'debuff') { removeEffect(player, id); removed.push(EFFECTS[id].name); }
  }
  return removed;
}

// O jogador levou um golpe direto: acorda o Sonolento (menos com golpes `keepsAsleep`) e descongela se foi de fogo
function onHit(player, element, { keepsAsleep = false } = {}) {
  const lines = [];
  for (const [id, def] of Object.entries({ ...EFFECTS })) {
    if (!hasEffect(player, id)) continue;
    if ((def.endsOnHit && !keepsAsleep) || (def.endsOnElement && def.endsOnElement === element)) {
      removeEffect(player, id);
      lines.push(`${def.emoji} **${def.name}** de ${player.name} acabou ao ser atingido.`);
    }
  }
  return lines;
}

// Fim do turno de `player`: dano contínuo, drenagem de energia e contagem regressiva dos turnos.
// Retorna { lines, defeated }.
function endOfTurn(player) {
  const lines = [];
  for (const [id, state] of Object.entries({ ...effectsOf(player) })) {
    const def = EFFECTS[id];
    if (def.dot) {
      const damage = Math.max(1, state.power * state.stacks);
      player.hp = Math.max(0, player.hp - damage);
      lines.push(`${def.emoji} ${player.name} sofreu **${damage}** de dano de ${def.name}.`);
    }
    if (def.drainEnergy) {
      const lost = Math.min(player.energy, def.drainEnergy * state.stacks);
      player.energy -= lost;
      lines.push(`${def.emoji} ${player.name} perdeu ${lost} de energia (${def.name}).`);
    }
    if (def.eachTurn && player.hp > 0) {
      const line = applyEffect(player, def.eachTurn.effect, def.eachTurn);
      if (line) lines.push(`${def.emoji} ${def.name}: ${line}`);
    }
    state.turns -= 1;
    if (state.turns <= 0) {
      removeEffect(player, id);
      lines.push(`✔️ **${def.name}** de ${player.name} acabou.`);
    }
  }
  return { lines, defeated: player.hp === 0 };
}

// Texto curto dos efeitos ativos, para o painel. Ex: "🔥 Queimadura (2t) • 🩸 Sangramento x3 (1t)"
function describeEffects(player) {
  return Object.entries(effectsOf(player))
    .map(([id, s]) => `${EFFECTS[id].emoji} ${EFFECTS[id].name}${s.stacks > 1 ? ` x${s.stacks}` : ''} (${s.turns}t)`)
    .join(' • ');
}

module.exports = {
  EFFECTS, getEffect, hasEffect, getMods, vulnerability, applyEffect, applyAbilityEffects,
  removeEffect, clearDebuffs, onHit, endOfTurn, describeEffects,
};
