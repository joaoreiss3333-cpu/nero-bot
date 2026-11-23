// Tamanho do mapa conforme o número de jogadores: 2 jogadores = 8x8 e cada jogador a mais
// acrescenta 2 colunas e 2 linhas, até o limite MAX_GRID (as colunas usam letras: máximo 26).
const BASE_GRID = 8;
const GRID_GROWTH_PER_EXTRA_PLAYER = 2;
const MAX_GRID = 20;
const COLUMN_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function gridSizeFor(playerCount) {
  const extra = Math.max(0, playerCount - 2);
  const size = Math.min(MAX_GRID, BASE_GRID + extra * GRID_GROWTH_PER_EXTRA_PLAYER);
  return { cols: size, rows: size };
}

module.exports = {
  EMBED_COLOR: 0xc0392b,
  ACTION_GIF_WAIT_MS: 10_000,     // quanto tempo o embed de uma ação fica na tela (o GIF roda) antes de sumir e o jogo seguir (0 = desliga)
  COLUMN_LETTERS,
  gridSizeFor,
  MOVES_PER_TURN: 2,              // casas por turno (sem diagonal)
  MAX_HP: 100,
  MAX_MANA: 50,
  MAX_ENERGY: 100,
  ENERGY_REGEN_PER_TURN: 0,       // energia recuperada no início de cada turno (0 = não recupera)
  DEFAULT_SPEED: 10,              // velocidade usada enquanto não há atributos por personagem
  ACTION_TIMEOUT_MS: 60_000,      // tempo para o defensor escolher a reação
  CHALLENGE_TIMEOUT_MS: 120_000,  // tempo para o oponente aceitar o desafio
};
