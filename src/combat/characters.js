// Habilidades que cada personagem possui (ids de abilities.js) e as estatísticas que vêm da ficha.
// Por enquanto todo mundo usa o kit padrão. Para dar habilidades diferentes a um jogador,
// adicione o ID do usuário do Discord em `kits`.
const { getAbility, abilities } = require('./abilities');
const { getProfile } = require('./profiles');
const { meetsRequirements, maxHp, maxMana, maxEnergy, speed } = require('./progression');

const DEFAULT_KIT = ['soco', 'esquiva', 'bloqueio'];

const kits = {
  // '123456789012345678': ['soco', 'esquiva'],
};

// Habilidades do kit cujos requisitos de atributo o jogador já cumpre
const getKit = userId => {
  const profile = getProfile(userId);
  // Kit base + todas as habilidades do grimório do jogador (se tiver um)
  const grimoire = profile.grimoire ? Object.keys(abilities).filter(id => abilities[id].grimoire === profile.grimoire) : [];
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

module.exports = { getKit, getCombatStats };
