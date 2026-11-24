// Fórmulas de progressão: XP, nível, vida/mana/energia e atributos. Tudo vem de config.js.
const C = require('./config');

const ATTRIBUTES = {
  forca: 'Força',
  destreza: 'Destreza',
  resistencia: 'Resistência',
  inteligencia: 'Inteligência',
  armasBrancas: 'Armas Brancas',
  magiaOfensiva: 'Magia Ofensiva',
  magiaDefensiva: 'Magia Defensiva',
  magiaSuplementar: 'Magia Suplementar',
};

const newProfile = () => ({
  level: 1,
  xp: 0, // XP acumulado dentro do nível atual
  points: C.STARTING_POINTS,
  skillPoints: C.SKILL_POINTS_START, // pontos de habilidade para comprar magias (/aprender)
  learned: [], // ids das magias de grimório já aprendidas (/aprender)
  attrs: Object.fromEntries(Object.keys(ATTRIBUTES).map(k => [k, 0])),
});

// Total de pontos de habilidade que o nível dá (desde o nível 1)
const skillPointsForLevel = level => C.SKILL_POINTS_START + Math.floor((level - 1) / C.SKILL_POINTS_EVERY);

// XP necessário para sair do nível `level` para o próximo
const xpToNext = level => Math.round((C.XP_BASE * level ** C.XP_EXPONENT) / 10) * 10;

// Soma XP e sobe de nível quantas vezes for preciso. Retorna os níveis ganhos e os pontos (de atributo e de habilidade) recebidos.
function addXp(profile, amount) {
  const from = profile.level;
  profile.xp += amount;
  while (profile.level < C.MAX_LEVEL && profile.xp >= xpToNext(profile.level)) {
    profile.xp -= xpToNext(profile.level);
    profile.level += 1;
    profile.points += C.POINTS_PER_LEVEL;
  }
  if (profile.level >= C.MAX_LEVEL) profile.xp = 0;
  const gainedSkillPoints = skillPointsForLevel(profile.level) - skillPointsForLevel(from);
  profile.skillPoints = (profile.skillPoints ?? 0) + gainedSkillPoints;
  return { from, to: profile.level, gainedPoints: (profile.level - from) * C.POINTS_PER_LEVEL, gainedSkillPoints };
}

// Valor do degrau em que o nível se encaixa
const fromSteps = (steps, level) => steps.reduce((v, [from, value]) => (level >= from ? value : v), steps[0][1]);

const maxHp = level => C.HP_BASE + C.HP_PER_LEVEL * (level - 1);
const maxMana = level => fromSteps(C.MANA_STEPS, level);
const maxEnergy = level => fromSteps(C.ENERGY_STEPS, level);
const speed = profile => C.BASE_SPEED + profile.attrs.destreza;

// Pontos que ainda dá para colocar nesse atributo
const roomFor = (profile, attr) => C.ATTRIBUTE_CAP - profile.attrs[attr];


module.exports = {
  ATTRIBUTES, newProfile, xpToNext, addXp, maxHp, maxMana, maxEnergy, speed, roomFor, skillPointsForLevel,
};
