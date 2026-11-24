// Tamanho do mapa conforme o número de jogadores: 2 jogadores = 10 colunas e cada jogador a mais
// acrescenta 2 colunas, até o limite MAX_GRID (as colunas usam letras: máximo 26).
const BASE_GRID = 10;
const GRID_GROWTH_PER_EXTRA_PLAYER = 2;
const MAX_GRID = 20;
const COLUMN_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// As casas são quadradas e a imagem do mapa é larga (altura ~62% da largura): o número de linhas
// acompanha o de colunas nessa proporção, para o mapa manter sempre o mesmo tamanho na tela.
const MAP_HEIGHT_RATIO = 0.62;

function gridSizeFor(playerCount) {
  const extra = Math.max(0, playerCount - 2);
  const size = Math.min(MAX_GRID, BASE_GRID + extra * GRID_GROWTH_PER_EXTRA_PLAYER);
  return { cols: size, rows: Math.round(size * MAP_HEIGHT_RATIO) };
}

module.exports = {
  EMBED_COLOR: 0xc0392b,
  ACTION_GIF_WAIT_MS: 10_000,     // quanto tempo o embed de uma ação fica na tela (o GIF roda) antes de sumir e o jogo seguir (0 = desliga)
  COLUMN_LETTERS,
  gridSizeFor,
  MOVES_PER_TURN: 2,              // casas por turno (sem diagonal)
  // ---- Progressão (todos os números de balanceamento ficam aqui) ----
  MAX_LEVEL: 50,
  ATTRIBUTE_CAP: 100,             // teto de cada atributo
  STARTING_POINTS: 3,             // pontos para distribuir no nível 1
  POINTS_PER_LEVEL: 2,            // pontos ganhos a cada nível (com 50 níveis dá ~100 pontos no total: dá para maximizar ~1 atributo)
  XP_BASE: 100,                   // XP para sair do nível n = XP_BASE * n^XP_EXPONENT (arredondado para 10)
  XP_EXPONENT: 1.5,
  HP_BASE: 20,                    // vida no nível 1 (começa baixa de propósito)
  HP_PER_LEVEL: 15,               // vida sobe sozinha a cada nível (nível 50 = 755)
  // Mana e energia sobem em degraus: [nível a partir do qual vale, valor]
  MANA_STEPS: [[1, 100], [10, 120], [20, 150], [35, 200]],
  ENERGY_STEPS: [[1, 100], [10, 120], [20, 150], [35, 200]],
  // Dano = valor sorteado no intervalo da habilidade + atributo * multiplicador (um multiplicador por atributo)
  DAMAGE_PER_POINT: { forca: 1, armasBrancas: 1, magiaOfensiva: 1.25 }, // 1 ponto de Força = +1 de dano
  // Defesa (Bloqueio e afins) absorve um valor sorteado no intervalo da habilidade + atributo × multiplicador, como um ataque ao contrário.
  // Os multiplicadores são ~metade dos de ataque: uma defesa absorve cerca de metade de um golpe de atributo igual.
  DEFENSE_PER_POINT: { resistencia: 0.5, magiaDefensiva: 0.6 },
  DODGE_CHANCE_PER_DEXTERITY: 0.004, // chance extra de esquiva por ponto de Destreza (+0,4%)
  DODGE_CHANCE_CAP: 0.8,
  BASE_SPEED: 10,                 // velocidade = BASE_SPEED + Destreza
  EFFECT_MAX_STACKS: 5,           // máximo de stacks de um efeito acumulável (sangramento, veneno...)
  CRIT_CHANCE_BASE: 0.05,         // chance base de crítico em todo ataque (efeitos como Brilho Estelar somam)
  CRIT_MULTIPLIER: 1.5,           // o crítico multiplica o dano por isso
  ENERGY_REGEN_PER_TURN: 0,       // energia recuperada no início de cada turno (0 = não recupera)
  ACTION_TIMEOUT_MS: 60_000,      // tempo para o defensor escolher a reação
  CHALLENGE_TIMEOUT_MS: 120_000,  // tempo para o oponente aceitar o desafio
};
