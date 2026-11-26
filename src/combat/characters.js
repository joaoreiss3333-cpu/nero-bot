// Habilidades que cada personagem possui (ids de abilities.js) e as estatísticas que vêm da ficha.
// Por enquanto todo mundo usa o kit padrão. Para dar habilidades diferentes a um jogador,
// adicione o ID do usuário do Discord em `kits`.
const { getAbility, abilities } = require('./abilities');
const { getProfile } = require('./profiles');
const { maxHp, maxMana, maxEnergy, speed } = require('./progression');

const DEFAULT_KIT = ['soco', 'esquiva', 'bloqueio'];

const kits = {
  // '123456789012345678': ['soco', 'esquiva'],
};

// Magias do grimório do jogador (a árvore dele), na ordem do catálogo
const grimoireTree = profile =>
  profile.grimoire ? Object.values(abilities).filter(a => a.grimoire === profile.grimoire) : [];

const rankOf = (profile, id) => (profile.learned.includes(id) ? profile.ranks[id] ?? 1 : 0);

// Próximo passo do jogador nessa magia: aprender (rank 1) ou subir de rank. Retorna { rank, spec } ou null se já está no máximo.
// `spec` tem os requisitos desse passo (minLevel e, no rank 1, after).
function nextStep(profile, ability) {
  const rank = rankOf(profile, ability.id) + 1;
  if (rank === 1) return { rank, spec: ability };
  const spec = ability.ranks?.[rank - 2];
  return spec ? { rank, spec } : null;
}

// Profundidade da magia na árvore: 0 na raiz, +1 a cada `after`
const depthOf = ability => (ability.after ? 1 + depthOf(getAbility(ability.after)) : 0);

// Custo em pontos de habilidade do rank `rank` da magia. Quanto mais fundo na árvore, mais caro: raiz = 1, cada
// nível abaixo +1. Cada rank acima do 1 custa o preço base + (rank - 1). `cost` na magia (ou no rank) sobrescreve.
function learnCost(ability, rank = 1) {
  const base = ability.cost ?? depthOf(ability) + 1;
  if (rank === 1) return base;
  return ability.ranks?.[rank - 2]?.cost ?? base + rank - 1;
}

// Pontos de habilidade gastos em tudo que o jogador já comprou (usado para converter fichas antigas)
const spentSkillPoints = profile => profile.learned.reduce((sum, id) => {
  const ability = getAbility(id);
  if (!ability) return sum;
  for (let r = 1; r <= (profile.ranks[id] ?? 1); r++) sum += learnCost(ability, r);
  return sum;
}, 0);

// Por que o jogador ainda não pode aprender/evoluir a magia (texto), ou null se pode
function learnBlocker(profile, ability) {
  if (ability.grimoire !== profile.grimoire) return 'não pertence ao seu grimório';
  const step = nextStep(profile, ability);
  if (!step) return 'ela já está no rank máximo';
  const { spec, rank } = step;
  if (rank === 1 && ability.after && !profile.learned.includes(ability.after)) return `aprenda antes **${getAbility(ability.after).name}**`;
  if (spec.minLevel && profile.level < spec.minLevel) return `precisa do nível ${spec.minLevel} (você está no ${profile.level})`;
  const cost = learnCost(ability, rank);
  if ((profile.skillPoints ?? 0) < cost) return `custa ${cost} ponto(s) de habilidade e você tem ${profile.skillPoints ?? 0}`;
  return null;
}

// Compra o próximo passo da magia (aprender ou subir de rank), gastando os pontos. Usado pela árvore de habilidades do site.
// Retorna { error } se não puder, ou { rank, cost } da compra feita. Quem chama precisa salvar a ficha (save()).
function learn(profile, ability) {
  const blocker = learnBlocker(profile, ability);
  if (blocker) return { error: blocker };
  const { rank } = nextStep(profile, ability);
  const cost = learnCost(ability, rank);
  profile.skillPoints -= cost;
  if (rank === 1) profile.learned.push(ability.id);
  profile.ranks[ability.id] = rank;
  return { rank, cost };
}

// Habilidades do kit: o kit base + as magias aprendidas do grimório
const getKit = userId => {
  const profile = getProfile(userId);
  // Kit base + magias do grimório que o jogador já aprendeu
  const grimoire = grimoireTree(profile).filter(a => profile.learned.includes(a.id)).map(a => a.id);
  return [...(kits[userId] ?? DEFAULT_KIT), ...grimoire].filter(id => getAbility(id));
};

// Tudo que a batalha precisa saber do personagem, calculado a partir da ficha
function getCombatStats(userId) {
  const profile = getProfile(userId);
  return {
    level: profile.level,
    attrs: { ...profile.attrs },
    maxHp: maxHp(profile.level),
    maxMana: maxMana(profile.level),
    maxEnergy: maxEnergy(profile.level),
    speed: speed(profile),
  };
}

// Ranks das magias do jogador (id -> rank), usado na batalha para montar cada habilidade no rank certo
const getRanks = userId => {
  const profile = getProfile(userId);
  return Object.fromEntries(profile.learned.map(id => [id, rankOf(profile, id)]));
};

module.exports = { getKit, getCombatStats, getRanks, grimoireTree, learnBlocker, nextStep, rankOf, learnCost, spentSkillPoints, learn };
