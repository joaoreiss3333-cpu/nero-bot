module.exports = {
  COLUMNS: 'ABCDEFGH'.split(''), // colunas A-H
  ROWS: 8,                        // linhas 1-8
  MOVES_PER_TURN: 2,              // casas por turno (sem diagonal)
  MAX_HP: 100,
  MAX_MANA: 50,
  MAX_ENERGY: 100,
  ENERGY_REGEN_PER_TURN: 10,      // energia recuperada no início de cada turno (0 desliga)
  DEFAULT_SPEED: 10,             // velocidade usada enquanto não há atributos por personagem
  ACTION_TIMEOUT_MS: 60_000,      // tempo para o defensor escolher a reação
  CHALLENGE_TIMEOUT_MS: 120_000,  // tempo para o oponente aceitar o desafio
};
