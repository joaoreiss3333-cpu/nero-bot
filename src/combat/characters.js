// Habilidades que cada personagem possui (ids de abilities.js).
// Por enquanto todo mundo usa o kit padrão. Para dar habilidades diferentes a um jogador,
// adicione o ID do usuário do Discord em `kits`.
const { DEFAULT_SPEED } = require('./config');

const DEFAULT_KIT =['soco', 'esquiva', 'bloqueio'];

const kits = {
  // '123456789012345678': ['soco', 'esquiva'],
};

const getKit = userId => [...(kits[userId] ?? DEFAULT_KIT)];

// Velocidade define quem começa a luta (maior velocidade começa; empate é sorteado).
// Quando houver atributos por personagem, devolva aqui o valor real.
const getSpeed = () => DEFAULT_SPEED;

module.exports = { getKit, getSpeed };
