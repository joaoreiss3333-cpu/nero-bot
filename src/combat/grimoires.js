// Grimórios do servidor e suas raridades. Cada habilidade de um grimório declara `grimoire: '<id>'`
// em abilities.js, e quem possui o grimório (profile.grimoire) recebe essas habilidades no kit
// depois de comprá-las com pontos de habilidade (na árvore de habilidades do site).
const RARITIES = {
  comum: { name: 'Comum', chance: '55,7%' },
  raro: { name: 'Raro', chance: '27%' },
  epico: { name: 'Épico', chance: '14%' },
  lendario: { name: 'Lendário', chance: '3%' },
  mitico: { name: 'Mítico', chance: '0,3%' },
};

const slug = name => name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const NAMES_BY_RARITY = {
  comum: ['Fogo', 'Água', 'Vento', 'Terra', 'Plantas', 'Gelo', 'Fumaça', 'Névoa', 'Corrente', 'Pedra'],
  raro: ['Relâmpago', 'Veneno', 'Areia', 'Cerejeira', 'Aço', 'Cinzas', 'Espelho', 'Algodão'],
  epico: ['Mercúrio', 'Roseira', 'Pintura', 'Sangue', 'Corte', 'Cópia', 'Fera'],
  lendario: ['Trevas', 'Sonhos', 'Árvore do Mundo', 'Espadas', 'Luz', 'Espaço'],
  mitico: ['Tempo', 'Estelar'],
};

// id -> { id, name, rarity }
const grimoires = {};
for (const [rarity, names] of Object.entries(NAMES_BY_RARITY)) {
  for (const name of names) grimoires[slug(name)] = { id: slug(name), name, rarity };
}

const getGrimoire = id => grimoires[id];

module.exports = { grimoires, getGrimoire, RARITIES };
