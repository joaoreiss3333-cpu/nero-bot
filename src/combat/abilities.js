// Catálogo de habilidades. Cada uma tem um `type`:
//   attack   -> gasta a ação de ataque do turno (usada com /habilidade)
//   bonus    -> gasta a ação bônus do turno (usada com /habilidade); precisa de `use(battle, user)` que retorna o log
//   reaction -> usada pelo defensor quando é atacado (aparece como botão)
// Reações têm um `kind` ('dodge', 'block' ou 'capture') que define como são resolvidas.
// Defesas `block` usam `absorb: [mín, máx]` + `attribute` (resistencia, magiaDefensiva...) e escalam como um ataque
// (valor sorteado + atributo × config.DEFENSE_PER_POINT).
// `energyCost` é a energia gasta ao usar a habilidade. Magias usam `manaCost` no lugar (gastam mana, não energia).
// Ataques causam um dano sorteado em `damage: [mín, máx]` + atributo × multiplicador (config.DAMAGE_PER_POINT);
// `attribute` diz qual atributo conta. A árvore de habilidades vai melhorar esse intervalo.
// Magias de grimório precisam ser APRENDIDAS (/aprender) para entrar no kit; é uma árvore:
//   minLevel -> nível mínimo do jogador para poder aprender
//   requires -> mínimo de pontos em atributos para poder aprender, ex: { magiaOfensiva: 5 } (não gasta os pontos; magias mais fortes pedem mais)
//   after    -> id da magia que precisa ter sido aprendida antes (a raiz da árvore não tem `after`)
//   ranks    -> evoluções da magia dentro da árvore (/aprender de novo compra o próximo rank). A habilidade em si é o rank 1;
//               cada item de `ranks` é o rank 2, 3... com `minLevel` e `requires` próprios e os campos que mudam (damage, manaCost,
//               cooldown, applies, absorb...). Os campos se acumulam rank a rank (resolveAbility).
//
// Efeitos de combate (catálogo em effects.js):
//   applies -> lista de efeitos que a habilidade aplica: { effect: 'sangramento', turns: 3, stacks: 1, power: 2, to: 'enemy'|'self', chance: 0.5 }
//              (só `effect` é obrigatório; ataque aplica no alvo se causar dano, ação bônus aplica em quem usou; `to` muda isso)
//   magic    -> true se for uma magia (reações como Chrono Stasis Grigora só funcionam contra magia)
//   cooldown -> turnos seus até poder usar de novo (1ª vez livre)
//   grimoire -> id do grimório (grimoires.js) a que a habilidade pertence; quem tem esse grimório recebe a habilidade no kit
//   element -> elemento do golpe ('fogo', 'gelo', 'relampago'...), usado nas interações (Encharcado, Congelado)
//
//   O bônus do atributo (config.DAMAGE_PER_POINT) é multiplicado pela escala da raridade do grimório (config.RARITY_SCALE);
//   `attributeScale` na habilidade sobrescreve. Dano base, mana e efeitos também variam por magia (um efeito forte pede dano menor).
//   A árvore de habilidades melhora o `damage` base (e talvez a escala).
//
// Campos opcionais para o aviso da ação (o embed "X utilizou ..." com o GIF):
//   actionText -> como a ação aparece no título, ex: "um Soco" (padrão: o nome)
//   gif        -> URL do GIF, ou nome de um arquivo da pasta assets/gifs (ex: 'soco.gif').
//                 Sem GIF, o aviso aparece só com o título.
//   gifDurationMs -> quanto o jogo espera esse GIF rodar (padrão: ACTION_GIF_WAIT_MS)
const fx = require('./effects');
const { distance } = require('./grid');
const NL = '\n';

const abilities = {
  soco: { id: 'soco', name: 'Soco', actionText: 'um Soco', gif: 'soco.gif', type: 'attack', range: 1, damage: [2, 4], attribute: 'forca', energyCost: 10 },

  esquiva: { id: 'esquiva', name: 'Esquiva', type: 'reaction', kind: 'dodge', chance: 0.5, energyCost: 15, emoji: '💨' }, // 50% (+ Destreza) de evitar todo o dano
  bloqueio: { id: 'bloqueio', name: 'Bloqueio', type: 'reaction', kind: 'block', absorb: [1, 2], attribute: 'resistencia', energyCost: 10, emoji: '🛡️' }, // absorve um valor sorteado (1-2) + Resistência × 0,5

  // ---- Grimório do Tempo ----
  // Grimório MÍTICO: a magia de ataque mais forte do servidor. Dano bem acima do Soco e prende o alvo em Estase Temporal (imóvel e sem reação, ainda pode atacar)
  chrono_stasis: {
    id: 'chrono_stasis', name: 'Chrono Stasis', actionText: 'Chrono Stasis', gif: 'chrono_stasis.gif', grimoire: 'tempo', magic: true,
    type: 'attack', range: 3, damage: [12, 18], attribute: 'magiaOfensiva', manaCost: 40,
    requires: { magiaOfensiva: 5 }, minLevel: 6, applies: [{ effect: 'estase', turns: 2 }], cooldown: 3, // raiz da árvore do Tempo
    // A Estase (imóvel + sem reação) é o que a faz forte, então o dano sobe pouco por rank e o controle é limitado por recarga:
    // 2 turnos de Estase dão no máximo UM golpe livre; nunca dá para encadear uma Estase na outra.
    ranks: [
      { minLevel: 15, requires: { magiaOfensiva: 10 }, damage: [17, 24] },
      { minLevel: 26, requires: { magiaOfensiva: 16 }, damage: [23, 32], manaCost: 45, applies: [{ effect: 'estase', turns: 3 }], cooldown: 4 },
    ],
  },
  // Captura a magia inimiga: ela é anulada por completo (sem prender o atacante: anular magia já é forte). Só funciona contra magia.
  // O rank 2 só a deixa mais barata.
  chrono_stasis_grigora: {
    id: 'chrono_stasis_grigora', name: 'Chrono Stasis Grigora', actionText: 'Chrono Stasis Grigora', gif: 'chrono_stasis_grigora.gif', grimoire: 'tempo',
    type: 'reaction', kind: 'capture', onlyVsMagic: true, manaCost: 35, emoji: '🕰️',
    requires: { magiaDefensiva: 8 }, minLevel: 12, after: 'chrono_stasis',
    ranks: [
      { minLevel: 24, requires: { magiaDefensiva: 14 }, manaCost: 25 },
    ],
  },
  // Volta no tempo em área: a vida de quem usa e dos aliados a até `radius` casas volta ao que era no início do turno anterior
  // (limitada a `healCap` da vida máxima, para não desfazer um golpe enorme de uma vez) e os debuffs somem. É o feitiço mais forte
  // do Tempo, então custa muito mais mana e tem recarga longa. Aliados = jogadores do mesmo `team` (ainda não existe luta em equipe:
  // por enquanto só afeta quem usou).
  chrono_anastasis: {
    id: 'chrono_anastasis', name: 'Chrono Anastasis', actionText: 'Chrono Anastasis', gif: 'chrono_anastasis.gif', grimoire: 'tempo', magic: true,
    type: 'bonus', manaCost: 70, cooldown: 4, requires: { magiaSuplementar: 10 }, minLevel: 18, after: 'chrono_stasis_grigora',
    radius: 3, healCap: 0.4, manaRefund: 15,
    ranks: [
      { minLevel: 30, requires: { magiaSuplementar: 16 }, cooldown: 3, healCap: 0.6, manaRefund: 25 },
    ],
    use(battle, user) {
      const affected = battle.players.filter(p => p === user
        || (user.team !== undefined && p.team === user.team && p.hp > 0 && p.pos && user.pos && distance(p.pos, user.pos) <= this.radius));
      let text = `⏪ ${user.name} usou **Chrono Anastasis** e voltou o tempo${affected.length > 1 ? ' de todos os aliados próximos' : ''}.`;
      for (const p of affected) {
        const healed = Math.min(Math.max(0, (p.hpHistory[0] ?? p.hp) - p.hp), Math.round(p.maxHp * this.healCap));
        p.hp += healed;
        const cleared = fx.clearDebuffs(p);
        const parts = [healed > 0 ? `❤️ +${healed} de vida` : 'nenhum dano para desfazer'];
        if (cleared.length) parts.push(`✨ removeu ${cleared.join(', ')}`);
        text += `${NL}${p.name}: ${parts.join(' · ')}.`;
      }
      user.mana = Math.min(user.maxMana, user.mana + this.manaRefund); // o tempo volta também para parte da mana gasta
      text += `${NL}🔷 ${user.name} recuperou ${this.manaRefund} de mana.`;
      return text;
    },
  },

  // ---- Grimório do Espaço (LENDÁRIO) ----
  // Mais fraco que o Tempo (mítico), mas com muito controle de posição. Escala de atributo da raridade (1,7x).
  // Árvore: Shootdown -> { Myriad Black -> Flapping -> Destruction } e { Gate -> Reflexo -> Mana Domination } e
  // { Gate -> Esfera -> Red Room -> Crevice Men } e { Gate -> Blackout }. Sem `ranks`: são muitas magias para comprar.
  // Esferas que apagam o que tocam: ignoram o Bloqueio. Só a mana domina uma magia espacial (Grigora, Mana Domination, Reflexo).
  archangel_shootdown: {
    id: 'archangel_shootdown', name: 'Archangel Shootdown', gif: 'espaco_archangel_shootdown.gif', grimoire: 'espaco', magic: true, element: 'espaco',
    type: 'attack', range: 3, damage: [10, 15], attribute: 'magiaOfensiva', manaCost: 30, ignoreBlock: true,
    requires: { magiaOfensiva: 5 }, minLevel: 8, // raiz da árvore do Espaço
  },
  // Balas mágicas por portais ao redor do alvo: alcance maior e mais difícil de esquivar, dano um pouco menor
  myriad_black: {
    id: 'myriad_black', name: 'Myriad Black', gif: 'espaco_myriad_black.gif', grimoire: 'espaco', magic: true, element: 'espaco',
    type: 'attack', range: 4, damage: [9, 14], attribute: 'magiaOfensiva', manaCost: 34, dodgePenalty: 0.25,
    requires: { magiaOfensiva: 8 }, minLevel: 12, after: 'archangel_shootdown',
  },
  // Massa de magia espacial que persegue o alvo; ao acertar, o teletransporta para longe (3+ casas de quem atacou)
  fallen_angel_flapping: {
    id: 'fallen_angel_flapping', name: 'Fallen Angel Flapping', gif: 'espaco_fallen_angel_flapping.gif', grimoire: 'espaco', magic: true, element: 'espaco',
    type: 'attack', range: 4, damage: [8, 12], attribute: 'magiaOfensiva', manaCost: 38, cooldown: 3, dodgePenalty: 0.15, displace: 3,
    requires: { magiaOfensiva: 12 }, minLevel: 18, after: 'myriad_black',
  },
  // A grande massa: o golpe mais forte do Espaço, ignora Bloqueio, mas cara e com recarga
  archangel_destruction: {
    id: 'archangel_destruction', name: 'Archangel Destruction', gif: 'espaco_archangel_destruction.gif', grimoire: 'espaco', magic: true, element: 'espaco',
    type: 'attack', range: 4, damage: [18, 26], attribute: 'magiaOfensiva', manaCost: 55, cooldown: 3, ignoreBlock: true,
    requires: { magiaOfensiva: 18 }, minLevel: 28, after: 'fallen_angel_flapping',
  },
  // Portal: leva você N casas numa direção (use `direcao` e `casas` no /habilidade). Não funciona imobilizado.
  fallen_angel_gate: {
    id: 'fallen_angel_gate', name: 'Fallen Angel Gate', gif: 'espaco_fallen_angel_gate.gif', grimoire: 'espaco', magic: true,
    type: 'bonus', manaCost: 30, cooldown: 2, teleport: 'self', destRange: 5,
    requires: { magiaSuplementar: 5 }, minLevel: 10, after: 'archangel_shootdown',
  },
  // O portal também devolve a magia inimiga ao lançador (metade do dano; nunca mata)
  fallen_angel_gate_reflexo: {
    id: 'fallen_angel_gate_reflexo', name: 'Fallen Angel Gate: Reflexo', actionText: 'Fallen Angel Gate: Reflexo', gif: 'espaco_fallen_angel_gate.gif', grimoire: 'espaco',
    type: 'reaction', kind: 'reflect', reflect: 0.5, onlyVsMagic: true, manaCost: 45, emoji: '🌀',
    requires: { magiaDefensiva: 6 }, minLevel: 14, after: 'fallen_angel_gate',
  },
  // Barreira esférica ao redor do alvo: ele não consegue se mover por 2 turnos (ainda reage e ataca)
  different_dimension_sphere: {
    id: 'different_dimension_sphere', name: 'Different Dimension Sphere', gif: 'espaco_different_dimension_sphere.gif', grimoire: 'espaco', magic: true,
    type: 'bonus', manaCost: 36, cooldown: 4, targetRange: 4, applies: [{ effect: 'esfera_dimensional', turns: 2, to: 'enemy' }],
    requires: { magiaSuplementar: 8 }, minLevel: 18, after: 'fallen_angel_gate',
  },
  // Leva o ALVO N casas numa direção (use `direcao` e `casas`): tira o inimigo do alcance ou o joga para longe de você
  blackout: {
    id: 'blackout', name: 'Blackout', gif: 'espaco_blackout.gif', grimoire: 'espaco', magic: true,
    type: 'bonus', manaCost: 40, cooldown: 4, targetRange: 5, teleport: 'enemy', destRange: 5,
    requires: { magiaSuplementar: 11 }, minLevel: 22, after: 'different_dimension_sphere',
  },
  // Domina a mana do lançador: anula a magia e ainda drena a mana dele (a defesa mais forte do Espaço, mas só contra magia)
  spatial_mana_domination: {
    id: 'spatial_mana_domination', name: 'Spatial Mana Domination', actionText: 'Spatial Mana Domination', gif: 'espaco_spatial_mana_domination.gif', grimoire: 'espaco',
    type: 'reaction', kind: 'capture', onlyVsMagic: true, drainMana: 25, manaCost: 40, emoji: '⬛',
    requires: { magiaDefensiva: 12 }, minLevel: 30, after: 'fallen_angel_gate_reflexo',
  },
  // Leva o alvo para um cubo vermelho: 4 turnos sem se mover e mais difícil de esquivar
  unopening_red_room: {
    id: 'unopening_red_room', name: 'Unopening Red Room', gif: 'espaco_unopening_red_room.gif', grimoire: 'espaco', magic: true, element: 'espaco',
    type: 'attack', range: 4, damage: [8, 12], attribute: 'magiaOfensiva', manaCost: 48, cooldown: 5,
    applies: [{ effect: 'sala_vermelha', turns: 4 }],
    requires: { magiaOfensiva: 14 }, minLevel: 32, after: 'different_dimension_sphere',
  },
  // Figuras com armas brotam do chão: 3 clones aparecem no mapa e atacam sozinhos no fim do seu turno (andam 2 casas e batem
  // se ficarem coladas no inimigo, sem reação possível). Dano baixo cada um: o dano base mais uma fração (22%) do bônus do atributo.
  crevice_men: {
    id: 'crevice_men', name: 'Crevice Men', gif: 'espaco_crevice_men.gif', grimoire: 'espaco', magic: true,
    type: 'bonus', manaCost: 60, cooldown: 5, attribute: 'magiaOfensiva', summon: { count: 3, duration: 3, damage: [2, 4], share: 0.22 },
    requires: { magiaOfensiva: 17 }, minLevel: 38, after: 'unopening_red_room',
  },

  // ---- Grimório das Trevas (LENDÁRIO) ----
  // Espadeiro: tudo gira em torno da espada imbuída em trevas. Escala de atributo da raridade (1,7x). Sem `ranks`.
  // Árvore: Lâmina Negra -> { Corte da Escuridão -> { Corte Selvagem, Corte Dimensional } }, { Casulo Negro },
  //         { Lâmina Sem Fio -> Lua Negra -> Impulso da Morte }.
  // Lua Negra: buff que apaga parte da magia recebida e libera o Impulso da Morte (que a consome).
  lamina_negra: {
    id: 'lamina_negra', name: 'Lâmina Negra Imbuída em Trevas', actionText: 'Lâmina Negra Imbuída em Trevas', gif: 'trevas_lamina_negra.gif', grimoire: 'trevas', magic: true, element: 'trevas',
    type: 'attack', range: 2, damage: [8, 12], attribute: 'magiaOfensiva', manaCost: 22, // a lâmina longa dá alcance 2, mas é o golpe mais fraco
    requires: { magiaOfensiva: 5 }, minLevel: 8, // raiz da árvore das Trevas
  },
  // Onda de escuridão afiada que voa até o alvo (alcance longo)
  corte_da_escuridao: {
    id: 'corte_da_escuridao', name: 'Corte da Escuridão Imbuído em Trevas', actionText: 'Corte da Escuridão Imbuído em Trevas', gif: 'trevas_corte_da_escuridao.gif', grimoire: 'trevas', magic: true, element: 'trevas',
    type: 'attack', range: 4, damage: [10, 15], attribute: 'magiaOfensiva', manaCost: 32,
    requires: { magiaOfensiva: 8 }, minLevel: 12, after: 'lamina_negra',
  },
  // Vários cortes desordenados: dano menor, mas difíceis de esquivar
  corte_selvagem: {
    id: 'corte_selvagem', name: 'Corte Selvagem Imbuído em Trevas', actionText: 'Corte Selvagem Imbuído em Trevas', gif: 'trevas_corte_selvagem.gif', grimoire: 'trevas', magic: true, element: 'trevas',
    type: 'attack', range: 3, damage: [9, 13], attribute: 'magiaOfensiva', manaCost: 38, cooldown: 2, dodgePenalty: 0.3,
    requires: { magiaOfensiva: 12 }, minLevel: 18, after: 'corte_da_escuridao',
  },
  // Barra descendente que corta até magia espacial: ignora Bloqueio e derruba as defesas do Espaço (Reflexo e Captura)
  corte_dimensional: {
    id: 'corte_dimensional', name: 'Corte Dimensional Imbuído em Trevas', actionText: 'Corte Dimensional Imbuído em Trevas', gif: 'trevas_corte_dimensional.gif', grimoire: 'trevas', magic: true, element: 'trevas',
    type: 'attack', range: 5, damage: [17, 24], attribute: 'magiaOfensiva', manaCost: 52, cooldown: 3, ignoreBlock: true, cutsSpace: true,
    requires: { magiaOfensiva: 18 }, minLevel: 28, after: 'corte_da_escuridao',
  },
  // Esfera oca de escuridão: a defesa mais forte do grimório (absorve como um bloqueio mágico)
  casulo_negro: {
    id: 'casulo_negro', name: 'Casulo Negro', actionText: 'Casulo Negro', gif: 'trevas_casulo_negro.gif', grimoire: 'trevas',
    type: 'reaction', kind: 'block', absorb: [5, 9], attribute: 'magiaDefensiva', manaCost: 30, emoji: '⚫',
    requires: { magiaDefensiva: 6 }, minLevel: 14, after: 'lamina_negra',
  },
  // Lado cego da lâmina: afasta o alvo do corpo a corpo (sem dano)
  lamina_negra_sem_fio: {
    id: 'lamina_negra_sem_fio', name: 'Lâmina Negra Sem Fio Imbuída em Trevas', actionText: 'Lâmina Negra Sem Fio Imbuída em Trevas', gif: 'trevas_lamina_negra_sem_fio.gif', grimoire: 'trevas', magic: true,
    type: 'bonus', manaCost: 25, cooldown: 3, targetRange: 2, push: 3,
    requires: { magiaSuplementar: 6 }, minLevel: 14, after: 'lamina_negra',
  },
  // Buraco negro: 3 turnos absorvendo 35% do dano de magia que você sofre; libera o Impulso da Morte
  lua_negra: {
    id: 'lua_negra', name: 'Lua Negra', actionText: 'Lua Negra', gif: 'trevas_lua_negra.gif', grimoire: 'trevas', magic: true,
    type: 'bonus', manaCost: 40, cooldown: 4, applies: [{ effect: 'lua_negra', turns: 3 }],
    requires: { magiaSuplementar: 10 }, minLevel: 22, after: 'lamina_negra_sem_fio',
  },
  // Explosão focada no braço: só com a Lua Negra ativa (que é gasta no golpe). Corpo a corpo, enorme e ignora Bloqueio
  impulso_da_morte: {
    id: 'impulso_da_morte', name: 'Impulso da Morte', actionText: 'Impulso da Morte', gif: 'trevas_impulso_da_morte.gif', grimoire: 'trevas', magic: true, element: 'trevas',
    type: 'attack', range: 1, damage: [24, 32], attribute: 'magiaOfensiva', manaCost: 50, cooldown: 2, ignoreBlock: true,
    requiresEffect: 'lua_negra', consumesEffect: 'lua_negra',
    requires: { magiaOfensiva: 16 }, minLevel: 32, after: 'lua_negra',
  },
};

const TYPE_LABEL = { attack: 'Ataque', bonus: 'Ação bônus', reaction: 'Reação' };

const getAbility = id => abilities[id];

// A habilidade no rank do jogador: os campos de cada rank até ele sobrescrevem os da habilidade base
// (os `ranks` aplicam de forma acumulada: o rank 3 parte do que o rank 2 já mudou).
function resolveAbility(ability, rank = 1) {
  if (!ability || rank <= 1 || !ability.ranks) return ability && { ...ability, rank: 1 };
  const { minLevel, requires, ...changes } = Object.assign({}, ...ability.ranks.slice(0, rank - 1));
  return { ...ability, ...changes, rank: Math.min(rank, ability.ranks.length + 1) };
}

module.exports = { abilities, getAbility, resolveAbility, TYPE_LABEL };
