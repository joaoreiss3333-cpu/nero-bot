// Habilidades que cada personagem possui (ids de abilities.js).
// Por enquanto todo mundo usa o kit padrão. Para dar habilidades diferentes a um jogador,
// adicione o ID do usuário do Discord em `kits`.
const DEFAULT_KIT = ['soco', 'esquiva', 'bloqueio'];

const kits = {
  // '123456789012345678': ['soco', 'esquiva'],
};

const getKit = userId => [...(kits[userId] ?? DEFAULT_KIT)];

module.exports = { getKit };
