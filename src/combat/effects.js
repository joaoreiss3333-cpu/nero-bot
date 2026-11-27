// Duas coisas ficam no jogador durante a luta:
//
// 1) EFEITOS (player.effects): debuffs GENÉRICOS que as magias colocam no alvo (queimadura, preso, sonolento...).
//    São poucos e servem para todas as magias. Cada um é um dado do catálogo EFFECTS:
//      stackable   se aplicar de novo soma stacks (até config.EFFECT_MAX_STACKS); senão só renova a duração
//      dot         dano por stack no fim do turno de quem tem o efeito (a Resistência não reduz: ela só serve para o Bloqueio)
//      drainEnergy energia perdida por stack no fim do turno
//      mods        modificadores enquanto o efeito está ativo (ver getMods); pode ser uma função do estado (força vinda da magia)
//      stackMods   { stacks: mods } -> modificadores extras a partir de N stacks
//      vulnerable  { elemento: multiplicador } -> o dono leva mais dano desse elemento (ou função do estado)
//      endsOnHit   o efeito acaba quando o dono sofre dano direto; endsOnElement: ... só se o golpe for desse elemento
//                  (golpes com `keepsAsleep` na habilidade, como as magias dos Sonhos, não acordam o Sonolento)
//    A duração (turnos), os stacks e a força vêm da habilidade que aplica:
//      applies: [{ effect: 'sangramento', turns: 3, stacks: 1, power: 2, to: 'enemy' | 'self', chance: 0.5 }]
//      `power` é o dano por stack (dano contínuo) ou a chance de errar (Cegueira); `elements` diz os elementos do Vulnerável;
//      `holdsSleep: true` faz o alvo não acordar com golpes enquanto ESSE efeito durar (Fitas do Sono Profundo).
//
// 2) MAGIAS ATIVAS (player.actives): o que uma magia deixa ligado em alguém (normalmente em quem lançou), cada uma do seu
//    jeito. Não são um catálogo: a própria habilidade descreve o que dá, no campo `active`:
//      active: { turns: 3, mods: { damageBonus: 6, damageResist: 0.2 }, lowHpMods, endsOnElement: 'agua', id, name, emoji }
//    (`id` e `name` vêm da habilidade se faltarem; magias com o mesmo `id` renovam a mesma ativa em vez de somar).
//    Outras magias podem exigir uma ativa (`requiresActive: 'mundo_do_glamour'`) ou gastá-la (`consumesActive`).
//
// Os turnos contam no FIM de cada turno de quem tem o efeito/ativa (o dano contínuo também acontece nessa hora).
const C = require('./config');

const EFFECTS = {
  // Dano por turno
  sangramento: { name: 'Sangramento', emoji: '🩸', stackable: true, dot: 1, desc: 'Dano a cada turno; acumula.' },
  queimadura: { name: 'Queimadura', emoji: '🔥', dot: 2, desc: 'Dano a cada turno; a água apaga.' },
  envenenado: { name: 'Envenenado', emoji: '☠️', stackable: true, dot: 1, desc: 'Dano a cada turno; acumula.' },
  // Elementais
  encharcado: { name: 'Encharcado', emoji: '💧', vulnerable: { relampago: 1.3, gelo: 1.3 }, desc: 'Leva mais dano de relâmpago e gelo; apaga a Queimadura.' },
  congelado: { name: 'Congelado', emoji: '🧊', mods: { noMove: true, noDodge: true }, endsOnElement: 'fogo', desc: 'Não se move nem esquiva; o fogo descongela.' },
  // Controle
  preso: { name: 'Preso', emoji: '🌿', mods: { noMove: true }, desc: 'Não se move (ainda ataca e reage).' },
  imobilizado: { name: 'Imobilizado', emoji: '⛓️', mods: { noMove: true, noDodge: true }, desc: 'Não se move nem esquiva.' },
  paralisado: { name: 'Paralisado', emoji: '🕰️', mods: { noMove: true, noReact: true }, desc: 'Não se move nem reage (ainda ataca).' },
  atordoado: { name: 'Atordoado', emoji: '💫', mods: { noAct: true, noMove: true, noReact: true, skipTurn: true }, desc: 'Perde o turno inteiro.' },
  sonolento: {
    name: 'Sonolento', emoji: '😴', stackable: true, endsOnHit: true,
    mods: { oneAction: true }, stackMods: { 3: { noAct: true } }, // com 3 stacks o alvo dorme de vez
    desc: 'Só uma ação por turno; com 3 acúmulos dorme. Acorda ao levar um golpe.',
  },
  lentidao: { name: 'Lentidão', emoji: '🐌', mods: { moveDelta: -1, dodgeDelta: -0.15 }, desc: 'Anda menos e esquiva menos.' },
  // Sentidos e energia
  cegueira: { name: 'Cegueira', emoji: '🙈', mods: s => ({ missChance: s.power || 0.4 }), desc: 'Chance de errar os golpes (a força vem da magia).' },
  escuridao: { name: 'Escuridão', emoji: '🌑', mods: { visionCap: 2 }, desc: 'Só enxerga alvos a até 2 casas.' },
  sufocamento: { name: 'Sufocamento', emoji: '😮‍💨', drainEnergy: 5, mods: { energyCostMult: 1.5 }, desc: 'Perde energia a cada turno e os golpes custam mais.' },
  // Fraqueza
  vulneravel: { name: 'Vulnerável', emoji: '🎯', vulnerable: s => s.elements ?? {}, desc: 'Leva mais dano de um elemento (definido pela magia).' },
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
const activesOf = player => (player.actives ??= {});

const hasEffect = (player, id) => !!effectsOf(player)[id];
const hasActive = (player, id) => !!activesOf(player)[id];

// Valor de um campo do catálogo que pode ser fixo ou depender do estado (força vinda da magia)
const resolve = (field, state) => (typeof field === 'function' ? field(state) : field);

// Soma os modificadores de todos os efeitos e magias ativas do jogador
function getMods(player) {
  const total = NEUTRAL_MODS();
  const lowHp = player.hp < player.maxHp / 2;
  for (const [id, state] of Object.entries(effectsOf(player))) {
    const def = EFFECTS[id];
    if (def.mods) mergeMods(total, resolve(def.mods, state));
    for (const [need, mods] of Object.entries(def.stackMods ?? {})) {
      if (state.stacks >= Number(need)) mergeMods(total, mods);
    }
  }
  for (const a of Object.values(activesOf(player))) {
    if (a.mods) mergeMods(total, a.mods);
    if (a.lowHpMods && lowHp) mergeMods(total, a.lowHpMods);
  }
  return total;
}

// Multiplicador de dano que o jogador sofre de um golpe de certo elemento (ex: Encharcado + relâmpago)
function vulnerability(player, element) {
  if (!element) return 1;
  return Object.entries(effectsOf(player)).reduce((mult, [id, state]) => mult * (resolve(EFFECTS[id].vulnerable, state)?.[element] ?? 1), 1);
}

function removeEffect(player, id) {
  delete effectsOf(player)[id];
}

function removeActive(player, id) {
  delete activesOf(player)[id];
}

// Aplica um efeito. Retorna a linha de log (ou '' se nada mudou). Aplicar de novo renova a duração
// (fica a maior) e, se o efeito acumula, soma stacks até o limite.
function applyEffect(player, id, { turns = 2, stacks = 1, power, elements, holdsSleep } = {}) {
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
  // Vulnerável: os elementos de cada aplicação se somam (fica o maior multiplicador de cada)
  if (elements || current?.elements) {
    const merged = { ...current?.elements };
    for (const [el, mult] of Object.entries(elements ?? {})) merged[el] = Math.max(merged[el] ?? 1, mult);
    active[id].elements = merged;
  }
  if (holdsSleep || current?.holdsSleep) active[id].holdsSleep = true;
  const s = active[id].stacks;
  return `${def.emoji} ${player.name} recebeu **${def.name}**${s > 1 ? ` (x${s})` : ''}${Number.isFinite(active[id].turns) ? ` por ${active[id].turns} turno(s)` : ''}.${extra}`;
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

// Liga (ou renova) uma magia ativa em `player`. `spec`: { id, name, emoji, turns, mods, lowHpMods, endsOnElement }.
// Retorna a linha de log.
function setActive(player, spec) {
  const current = activesOf(player)[spec.id];
  activesOf(player)[spec.id] = { ...spec, turns: Math.max(current?.turns ?? 0, spec.turns ?? 2) };
  const turns = activesOf(player)[spec.id].turns;
  return `${spec.emoji ?? '✨'} **${spec.name}** ${current ? 'renovada' : 'ativa'} em ${player.name}${Number.isFinite(turns) ? ` por ${turns} turno(s)` : ''}.`;
}

// A magia ativa que a habilidade liga (campo `active`) em `player`. Retorna a linha de log, ou '' se a habilidade não tem.
function applyAbilityActive(ability, player) {
  if (!ability.active) return '';
  return setActive(player, { id: ability.id, name: ability.name, ...ability.active });
}

// Remove todos os efeitos (debuffs) do jogador; as magias ativas ficam. Retorna os nomes removidos.
function clearDebuffs(player) {
  const removed = Object.keys(effectsOf(player)).map(id => EFFECTS[id].name);
  player.effects = {};
  return removed;
}

// O jogador levou um golpe direto: acorda o Sonolento (menos com golpes `keepsAsleep`), descongela se foi de fogo e
// desfaz magias ativas que quebram com esse elemento (ex: a Besta Vermelha com água)
function onHit(player, element, { keepsAsleep = false } = {}) {
  const lines = [];
  // `holdsSleep` (Fitas do Sono Profundo): enquanto as fitas prendem o alvo, nenhum golpe o acorda
  if (Object.values(effectsOf(player)).some(s => s.holdsSleep)) keepsAsleep = true;
  for (const id of Object.keys(effectsOf(player))) {
    const def = EFFECTS[id];
    if ((def.endsOnHit && !keepsAsleep) || (def.endsOnElement && def.endsOnElement === element)) {
      removeEffect(player, id);
      lines.push(`${def.emoji} **${def.name}** de ${player.name} acabou ao ser atingido.`);
    }
  }
  for (const [id, a] of Object.entries(activesOf(player))) {
    if (a.endsOnElement && a.endsOnElement === element) {
      removeActive(player, id);
      lines.push(`${a.emoji ?? '✨'} **${a.name}** de ${player.name} se desfez com o golpe.`);
    }
  }
  return lines;
}

// Fim do turno de `player`: dano contínuo, drenagem de energia e contagem regressiva dos efeitos e das magias ativas.
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
    state.turns -= 1;
    if (state.turns <= 0) {
      removeEffect(player, id);
      lines.push(`✔️ **${def.name}** de ${player.name} acabou.`);
    }
  }
  for (const [id, a] of Object.entries({ ...activesOf(player) })) {
    a.turns -= 1;
    if (a.turns <= 0) {
      removeActive(player, id);
      lines.push(`✔️ **${a.name}** de ${player.name} acabou.`);
    }
  }
  return { lines, defeated: player.hp === 0 };
}

// Texto curto das magias ativas e dos efeitos, para o painel. Ex: "🐺 Instinto Selvagem (2t) • 🔥 Queimadura (2t) • 🩸 Sangramento x3 (1t)"
function describeEffects(player) {
  const turns = t => (Number.isFinite(t) ? ` (${t}t)` : '');
  return [
    ...Object.values(activesOf(player)).map(a => `${a.emoji ?? '✨'} ${a.name}${turns(a.turns)}`),
    ...Object.entries(effectsOf(player)).map(([id, s]) => `${EFFECTS[id].emoji} ${EFFECTS[id].name}${s.stacks > 1 ? ` x${s.stacks}` : ''}${turns(s.turns)}`),
  ].join(' • ');
}

module.exports = {
  EFFECTS, getEffect, hasEffect, hasActive, getMods, vulnerability, applyEffect, applyAbilityEffects,
  setActive, applyAbilityActive, removeEffect, removeActive, clearDebuffs, onHit, endOfTurn, describeEffects,
};
