// Habilidades que cada personagem possui (ids de abilities.js) e as estatísticas que vêm da ficha.
// Por enquanto todo mundo usa o kit padrão. Para dar habilidades diferentes a um jogador,
// adicione o ID do usuário do Discord em `kits`.
const { getAbility, abilities } = require('./abilities');
const { getProfile } = require('./profiles');
const { ATTRIBUTES, meetsRequirements, maxHp, maxMana, maxEnergy, speed } = require('./progression');

const DEFAULT_KIT = ['soco', 'esquiva', 'bloqueio'];

const kits = {
  // '123456789012345678': ['soco', 'esquiva'],
};

// Magias do grimório do jogador (a árvore dele), na ordem do catálogo
const grimoireTree = profile =>
  profile.grimoire ? Object.values(abilities).filter(a => a.grimoire === profile.grimoire) : [];

const rankOf = (profile, id) => (profile.learned.includes(id) ? profile.ranks[id] ?? 1 : 0);

// Próximo passo do jogador nessa magia: aprender (rank 1) ou subir de rank. Retorna { rank, spec } ou null se já está no máximo.
// `spec` tem os requisitos desse passo (minLevel, requires e, no rank 1, after).
function nextStep(profile, ability) {
  const rank = rankOf(profile, ability.id) + 1;
  if (rank === 1) return { rank, spec: ability };
  const spec = ability.ranks?.[rank - 2];
  return spec ? { rank, spec } : null;
}

// Por que o jogador ainda não pode aprender/evoluir a magia (texto), ou null se pode
function learnBlocker(profile, ability) {
  if (ability.grimoire !== profile.grimoire) return 'não pertence ao seu grimório';
  const step = nextStep(profile, ability);
  if (!step) return 'ela já está no rank máximo';
  const { spec, rank } = step;
  if (rank === 1 && ability.after && !profile.learned.includes(ability.after)) return `aprenda antes **${getAbility(ability.after).name}**`;
  if (spec.minLevel && profile.level < spec.minLevel) return `precisa do nível ${spec.minLevel} (você está no ${profile.level})`;
  const missing = Object.entries(spec.requires ?? {}).filter(([attr, min]) => profile.attrs[attr] < min);
  if (missing.length) return `precisa de ${missing.map(([attr, min]) => `${min} em ${ATTRIBUTES[attr]} (você tem ${profile.attrs[attr]})`).join(' e ')}`;
  return null;
}

// Habilidades do kit cujos requisitos de atributo o jogador já cumpre
const getKit = userId => {
  const profile = getProfile(userId);
  // Kit base + magias do grimório que o jogador já aprendeu
  const grimoire = grimoireTree(profile).filter(a => profile.learned.includes(a.id)).map(a => a.id);
  return [...(kits[userId] ?? DEFAULT_KIT), ...grimoire].filter(id => {
    const ability = getAbility(id);
    return ability && meetsRequirements(profile, ability);
  });
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

module.exports = { getKit, getCombatStats, getRanks, grimoireTree, learnBlocker, nextStep, rankOf };
