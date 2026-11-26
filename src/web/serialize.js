// Transforma as fichas e as magias do bot no JSON que o site mostra (só dados, sem funções).
const { abilities, resolveAbility, typeLabel } = require('../combat/abilities');
const { grimoires, getGrimoire, RARITIES } = require('../combat/grimoires');
const { EFFECTS, getEffect } = require('../combat/effects');
const { learnCost, learnBlocker, nextStep, rankOf } = require('../combat/characters');
const { ATTRIBUTES, xpToNext, maxHp, maxMana, maxEnergy, speed } = require('../combat/progression');
const C = require('../combat/config');

const fs = require('fs');
const path = require('path');

const GIF_DIR = path.join(__dirname, '..', '..', 'assets', 'gifs');
// Só manda o GIF se o arquivo já estiver em assets/gifs (magia nova sem GIF mostra a inicial no site)
const gifUrl = gif => (!gif ? null : /^https?:/.test(gif) ? gif
  : fs.existsSync(path.join(GIF_DIR, gif)) ? `/gifs/${encodeURIComponent(gif)}` : null);

// Os detalhes de combate da magia num determinado rank, como frases curtas
function details(a) {
  const out = [];
  if (a.damage) out.push(`Dano ${a.damage[0]}–${a.damage[1]}${a.attribute ? ` + ${ATTRIBUTES[a.attribute]}` : ''}`);
  if (a.heal) out.push(`Cura ${a.heal[0]}–${a.heal[1]}${a.attribute ? ` + ${ATTRIBUTES[a.attribute]}` : ''}`);
  if (a.absorb) out.push(`Absorve ${a.absorb[0]}–${a.absorb[1]}${a.attribute ? ` + ${ATTRIBUTES[a.attribute]}` : ''}`);
  if (a.range) out.push(`Alcance ${a.range}`);
  if (a.targetRange) out.push(`Alcance ${a.targetRange}`);
  if (a.area) out.push(`Área de ${a.area.radius} casas`);
  if (a.radius) out.push(`Raio de ${a.radius} casas`);
  if (a.splash) out.push(`Respingo: ${Math.round(a.splash.share * 100)}% do dano a até ${a.splash.radius} casa(s) do alvo`);
  if (a.ignoreBlock) out.push('Ignora Bloqueio');
  if (a.cutsThrough) out.push('Funciona até contra golpes que ignoram Bloqueio');
  if (a.thorns) out.push(`Espinhos: ${a.thorns[0]}–${a.thorns[1]} de dano em quem atacar`);
  if (a.physicalBonus) out.push(`Absorve +${Math.round((a.physicalBonus - 1) * 100)}% contra ataques físicos`);
  if (a.magicBonus) out.push(`Absorve +${Math.round((a.magicBonus - 1) * 100)}% contra magias`);
  if (a.cursedBonus) out.push(`Contra alvos amaldiçoados: +${Math.round((a.cursedBonus - 1) * 100)}% de dano e absorve ${a.cursedDrain} de mana`);
  if (a.lifesteal) out.push(`Recupera ${Math.round(a.lifesteal * 100)}% do dano causado em vida`);
  if (a.requiresTargetEffect) out.push(`Só em alvos com ${getEffect(a.requiresTargetEffect)?.name}`);
  if (a.dodgePenalty >= 1) out.push('Impossível de esquivar');
  else if (a.dodgePenalty) out.push(`-${Math.round(a.dodgePenalty * 100)}% de esquiva do alvo`);
  if (a.ignoresSpeed) out.push('A velocidade do golpe não reduz a chance de esquiva');
  if (a.piercesDarkness) out.push('A Magia de Escuridão não consegue absorver (ignora a Lua Negra e as defesas das Trevas)');
  if (a.onlyVsMagic) out.push('Só contra magia');
  if (a.reflect) out.push(`Devolve ${Math.round(a.reflect * 100)}% do dano`);
  if (a.drainMana) out.push(`Drena ${a.drainMana} de mana`);
  if (a.drainArea) out.push(`Rouba ${a.drainArea} de mana de cada inimigo na área`);
  if (a.teleport === 'self') out.push(`Teleporta você até ${a.destRange} casas`);
  if (a.teleport === 'enemy') out.push(`Teleporta o alvo até ${a.destRange} casas`);
  if (a.blink) out.push(a.blinkTo === 'attacker' ? 'Se esquivar, reaparece colado em quem atacou' : `Se esquivar, reaparece até ${a.blink} casas longe do atacante`);
  if (a.displace) out.push(`Joga o alvo para ${a.displace}+ casas de distância`);
  if (a.push) out.push(`Empurra o alvo ${a.push} casas`);
  if (a.summon) {
    const s = a.summon;
    out.push(`Invoca ${s.label ? `${s.count}× ${s.label}` : `${s.count} clones`}, com ${s.hp} de vida cada, até serem destruídas`);
    if (s.linkedEffect) out.push(`Enquanto existir: ${getEffect(s.linkedEffect)?.emoji} ${getEffect(s.linkedEffect)?.name}`);
    if (s.size > 1) out.push(`Ocupa ${s.size}×${s.size} casas no mapa`);
    if (s.push) out.push(`O impacto arremessa o alvo ${s.push} casas`);
  }
  if (a.restoreMana) out.push(`Recupera ${a.restoreMana[0]}–${a.restoreMana[1]} de mana`);
  if (a.healCap) out.push(`Volta até ${Math.round(a.healCap * 100)}% da vida`);
  if (a.manaRefund) out.push(`Recupera ${a.manaRefund} de mana`);
  if (a.requiresEffect) out.push(`Exige o efeito ${getEffect(a.requiresEffect)?.name} ativo`);
  if (a.keepsAsleep) out.push('Não acorda quem está dormindo');
  if (a.copy) {
    out.push(`Copia 1 magia à sua escolha que o inimigo aprendeu`);
    out.push(`Guarda até ${a.copy.slots} cópia(s) ao mesmo tempo, por ${a.copy.turns} turnos`);
    out.push('Só copia magias cujo nível mínimo você já tem');
    out.push(a.copy.keepRank ? 'A cópia vem no rank do inimigo (até o que o seu nível permite)' : 'A cópia vem no rank 1');
    out.push('Cópias escalam no máximo como um grimório épico');
  }
  if (a.chance) out.push(`${Math.round(a.chance * 100)}% de chance`);
  for (const e of a.applies ?? []) {
    const fx = getEffect(e.effect);
    if (fx) out.push(`${fx.emoji} ${fx.name}${e.turns ? ` por ${e.turns} turno(s)` : ''}${e.chance ? ` (${Math.round(e.chance * 100)}%)` : ''}`);
  }
  return out;
}

const costOf = a => (a.manaCost !== undefined ? { amount: a.manaCost, resource: 'mana' } : { amount: a.energyCost ?? 0, resource: 'energia' });

// Uma magia do catálogo com todos os ranks (sem dados do jogador)
function publicAbility(a) {
  const rankCount = (a.ranks?.length ?? 0) + 1;
  return {
    id: a.id,
    name: a.name,
    description: a.description ?? null,
    type: a.type,
    typeLabel: typeLabel(a),
    gif: gifUrl(a.gif),
    grimoire: a.grimoire ?? null,
    after: a.after ?? null,
    ranks: Array.from({ length: rankCount }, (_, i) => {
      const rank = i + 1;
      const r = resolveAbility(a, rank);
      return {
        rank,
        minLevel: rank === 1 ? a.minLevel ?? 1 : a.ranks[i - 1].minLevel ?? 1,
        cost: learnCost(a, rank),
        resourceCost: costOf(r),
        cooldown: r.cooldown ?? 0,
        details: details(r),
      };
    }),
  };
}

const grimoireAbilities = id => Object.values(abilities).filter(a => a.grimoire === id);

// Lista de grimórios (com as magias de quem já tem árvore pronta)
function catalog() {
  return Object.values(grimoires).map(g => ({
    ...g,
    rarityName: RARITIES[g.rarity].name,
    abilities: grimoireAbilities(g.id).map(publicAbility),
  }));
}

// A árvore do grimório do jogador, com o estado de cada magia para ele
function playerTree(profile) {
  if (!profile.grimoire) return null;
  const g = getGrimoire(profile.grimoire);
  return {
    grimoire: { ...g, rarityName: RARITIES[g.rarity].name },
    skillPoints: profile.skillPoints ?? 0,
    level: profile.level,
    abilities: grimoireAbilities(g.id).map(a => {
      const step = nextStep(profile, a);
      const blocker = learnBlocker(profile, a);
      return {
        ...publicAbility(a),
        rank: rankOf(profile, a.id),
        next: step ? { rank: step.rank, cost: learnCost(a, step.rank) } : null,
        blocker: step ? blocker : null,
      };
    }),
  };
}

function playerProfile(profile, user) {
  const g = profile.grimoire && getGrimoire(profile.grimoire);
  return {
    user: user && { id: user.id, username: user.username, avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256` : null },
    level: profile.level,
    maxLevel: C.MAX_LEVEL,
    xp: profile.xp,
    xpToNext: profile.level >= C.MAX_LEVEL ? 0 : xpToNext(profile.level),
    points: profile.points,
    skillPoints: profile.skillPoints ?? 0,
    attrs: Object.entries(ATTRIBUTES).map(([id, name]) => ({ id, name, value: profile.attrs[id] ?? 0 })),
    attributeCap: C.ATTRIBUTE_CAP,
    stats: { hp: maxHp(profile.level), mana: maxMana(profile.level), energy: maxEnergy(profile.level), speed: speed(profile) },
    grimoire: g ? { ...g, rarityName: RARITIES[g.rarity].name } : null,
    learned: profile.learned.map(id => ({ id, name: abilities[id]?.name, rank: rankOf(profile, id) })).filter(a => a.name),
  };
}

// Números do jogo para o guia (sempre iguais ao config.js)
function guide() {
  return {
    maxLevel: C.MAX_LEVEL,
    attributeCap: C.ATTRIBUTE_CAP,
    startingPoints: C.STARTING_POINTS,
    pointsPerLevel: C.POINTS_PER_LEVEL,
    skillPointsStart: C.SKILL_POINTS_START,
    skillPointsEvery: C.SKILL_POINTS_EVERY,
    movesPerTurn: C.MOVES_PER_TURN,
    partyMaxSize: C.PARTY_MAX_SIZE,
    critChance: C.CRIT_CHANCE_BASE,
    critMultiplier: C.CRIT_MULTIPLIER,
    hp: { base: C.HP_BASE, perLevel: C.HP_PER_LEVEL },
    manaSteps: C.MANA_STEPS,
    energySteps: C.ENERGY_STEPS,
    raritiesScale: C.RARITY_SCALE,
    xpTable: [1, 5, 10, 20, 30, 40, 49].map(l => ({ level: l, xp: xpToNext(l) })),
    attributes: Object.values(ATTRIBUTES),
    rarities: Object.entries(RARITIES).map(([id, r]) => ({ id, ...r })),
    effects: Object.entries(EFFECTS).map(([id, e]) => ({ id, name: e.name, emoji: e.emoji, kind: e.kind })),
    basics: ['soco', 'esquiva', 'bloqueio'].map(id => publicAbility(abilities[id])),
  };
}

module.exports = { catalog, playerTree, playerProfile, guide };
