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
  // Pontos de habilidade (compram magias na árvore do site): 1 no nível 1 e +1 a cada 2 níveis = 25 no nível 50.
  // Não dá para comprar uma árvore grande inteira: quem tem muitas magias precisa escolher um caminho.
  SKILL_POINTS_START: 1,
  SKILL_POINTS_EVERY: 2,
  POINTS_PER_LEVEL: 3,            // pontos ganhos a cada nível (3 iniciais + 49 níveis × 3 = 150 pontos no total: dá para maximizar 1 atributo e sobra pouco)
  XP_BASE: 100,                   // XP para sair do nível n = XP_BASE * n^XP_EXPONENT (arredondado para 10)
  XP_EXPONENT: 1.5,
  HP_BASE: 20,                    // vida no nível 1 (começa baixa de propósito)
  HP_PER_LEVEL: 20,               // vida sobe sozinha a cada nível (nível 50 = 1000)
  // Mana e energia sobem em degraus: [nível a partir do qual vale, valor]
  MANA_STEPS: [[1, 100], [10, 120], [20, 150], [35, 200]],
  ENERGY_STEPS: [[1, 100], [10, 120], [20, 150], [35, 200]],
  // Dano = valor sorteado no intervalo da habilidade + atributo * multiplicador (um multiplicador por atributo)
  DAMAGE_PER_POINT: { forca: 1, armasBrancas: 1, magiaOfensiva: 1.25, magiaSuplementar: 1 }, // 1 ponto de Força = +1 de dano
  // Defesa (Bloqueio e afins) absorve um valor sorteado no intervalo da habilidade + atributo × multiplicador, como um ataque ao contrário.
  // Os multiplicadores são ~metade dos de ataque: uma defesa absorve cerca de metade de um golpe de atributo igual.
  // Escala do bônus de atributo por raridade do grimório da habilidade (a habilidade pode sobrescrever com `attributeScale`).
  // Soco e habilidades sem grimório usam 1. O dano base e os efeitos também mudam de magia para magia.
  RARITY_SCALE: { comum: 1, raro: 1.15, epico: 1.4, lendario: 1.7, mitico: 2 },
  // Trevos do grimório (clovers.js): multiplicam a força INTEIRA das magias do próprio grimório (valor sorteado + atributo).
  // 4 e 5 folhas têm a mesma força; o de 5 se diferencia pela magia de demônio.
  CLOVER_MULT: { 3: 1, 4: 1.2, 5: 1.2 },
  DEFENSE_PER_POINT: { resistencia: 0.5, magiaDefensiva: 0.6 },
  DODGE_CHANCE_PER_DEXTERITY: 0.004, // chance extra de esquiva por ponto de Destreza (+0,4%)
  DODGE_CHANCE_CAP: 0.8,
  BASE_SPEED: 10,                 // velocidade = BASE_SPEED + Destreza
  EFFECT_MAX_STACKS: 5,           // máximo de stacks de um efeito acumulável (sangramento, veneno...)
  CRIT_CHANCE_BASE: 0.05,         // chance base de crítico em todo ataque (efeitos como Brilho Estelar somam)
  CRIT_MULTIPLIER: 1.5,           // o crítico multiplica o dano por isso
  ENERGY_REGEN_PER_TURN: 0,       // energia recuperada no início de cada turno (0 = não recupera)
  PARTY_MAX_SIZE: 4,              // jogadores por party (o mapa cresce junto: ver gridSizeFor)
  PARTY_INVITE_TIMEOUT_MS: 120_000, // tempo para aceitar o convite de party
  ACTION_TIMEOUT_MS: 60_000,      // tempo para o defensor escolher a reação
  CHALLENGE_TIMEOUT_MS: 120_000,  // tempo para o oponente aceitar o desafio
};
