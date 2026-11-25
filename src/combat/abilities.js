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
//   custo    -> comprar gasta PONTOS DE HABILIDADE (não de atributo): raiz = 1 e +1 a cada nível descendo a árvore
//               (characters.learnCost); `cost: N` sobrescreve. Os atributos só aumentam o dano/defesa das habilidades.
//   after    -> id da magia que precisa ter sido aprendida antes (a raiz da árvore não tem `after`)
//   ranks    -> evoluções da magia dentro da árvore (/aprender de novo compra o próximo rank). A habilidade em si é o rank 1;
//               cada item de `ranks` é o rank 2, 3... com `minLevel` (e `cost`, opcional) próprios e os campos que mudam (damage, manaCost,
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
const C = require('./config');
const { getGrimoire } = require('./grimoires');
const { distance } = require('./grid');
const NL = '\n';

const abilities = {
  soco: { id: 'soco', name: 'Soco', description: 'Um golpe físico simples, corpo a corpo. Gasta energia, não mana.', actionText: 'um Soco', gif: 'soco.gif', type: 'attack', range: 1, damage: [2, 4], attribute: 'forca', energyCost: 10 },

  esquiva: { id: 'esquiva', name: 'Esquiva', description: 'Reação: tenta sair do caminho e evitar todo o dano do ataque. A Destreza aumenta a chance.', type: 'reaction', kind: 'dodge', chance: 0.5, energyCost: 15, emoji: '💨' }, // 50% (+ Destreza) de evitar todo o dano
  bloqueio: { id: 'bloqueio', name: 'Bloqueio', description: 'Reação: segura o golpe e absorve parte do dano. A Resistência aumenta o quanto você absorve.', type: 'reaction', kind: 'block', absorb: [1, 2], attribute: 'resistencia', energyCost: 10, emoji: '🛡️' }, // absorve um valor sorteado (1-2) + Resistência × 0,5

  // ---- Grimório do Tempo ----
  // Grimório MÍTICO: a magia de ataque mais forte do servidor. Dano bem acima do Soco e prende o alvo em Estase Temporal (imóvel e sem reação, ainda pode atacar)
  chrono_stasis: {
    id: 'chrono_stasis', name: 'Chrono Stasis', description: 'Prende o alvo numa esfera com um anel de algarismos romanos, onde ele revive o mesmo instante em loop. Causa dano e deixa o alvo em Estase Temporal: não se move nem reage, mas ainda pode atacar.', actionText: 'Chrono Stasis', gif: 'chrono_stasis.gif', grimoire: 'tempo', magic: true,
    type: 'attack', range: 3, damage: [12, 18], attribute: 'magiaOfensiva', manaCost: 40,
    minLevel: 6, applies: [{ effect: 'estase', turns: 2 }], cooldown: 3, // raiz da árvore do Tempo
    // A Estase (imóvel + sem reação) é o que a faz forte, então o dano sobe pouco por rank e o controle é limitado por recarga:
    // 2 turnos de Estase dão no máximo UM golpe livre; nunca dá para encadear uma Estase na outra.
    ranks: [
      { minLevel: 15, damage: [17, 24] },
      { minLevel: 26, damage: [23, 32], manaCost: 45, applies: [{ effect: 'estase', turns: 3 }], cooldown: 4 },
    ],
  },
  // Captura a magia inimiga: ela é anulada por completo (sem prender o atacante: anular magia já é forte). Só funciona contra magia.
  // O rank 2 só a deixa mais barata.
  chrono_stasis_grigora: {
    id: 'chrono_stasis_grigora', name: 'Chrono Stasis Grigora', description: 'Toma o controle da mana ao redor e captura com Chrono Stasis qualquer feitiço inimigo, até os mais rápidos. Reação que anula por completo uma magia lançada contra você.', actionText: 'Chrono Stasis Grigora', gif: 'chrono_stasis_grigora.gif', grimoire: 'tempo',
    type: 'reaction', kind: 'capture', onlyVsMagic: true, manaCost: 35, emoji: '🕰️',
    minLevel: 12, after: 'chrono_stasis',
    ranks: [
      { minLevel: 24, manaCost: 25 },
    ],
  },
  // Volta no tempo em área: a vida de quem usa e dos aliados a até `radius` casas volta ao que era no início do turno anterior
  // (limitada a `healCap` da vida máxima, para não desfazer um golpe enorme de uma vez) e os debuffs somem. É o feitiço mais forte
  // do Tempo, então custa muito mais mana e tem recarga longa. Aliados = jogadores do mesmo `team` (ainda não existe luta em equipe:
  // por enquanto só afeta quem usou).
  chrono_anastasis: {
    id: 'chrono_anastasis', name: 'Chrono Anastasis', description: 'Um mostrador de relógio cobre a área e faz o tempo voltar. Você e os aliados próximos recuperam a vida perdida desde o turno anterior, perdem os efeitos negativos e parte da mana gasta volta.', actionText: 'Chrono Anastasis', gif: 'chrono_anastasis.gif', grimoire: 'tempo', magic: true,
    type: 'bonus', manaCost: 70, cooldown: 4, minLevel: 18, after: 'chrono_stasis_grigora',
    radius: 3, healCap: 0.4, manaRefund: 15,
    ranks: [
      { minLevel: 30, cooldown: 3, healCap: 0.6, manaRefund: 25 },
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
    id: 'archangel_shootdown', name: 'Archangel Shootdown', description: 'Dispara uma esfera de magia espacial que apaga o que toca. Atravessa o Bloqueio do alvo.', gif: 'espaco_archangel_shootdown.gif', grimoire: 'espaco', magic: true, element: 'espaco',
    type: 'attack', range: 3, damage: [10, 15], attribute: 'magiaOfensiva', manaCost: 30, ignoreBlock: true,
    minLevel: 8, // raiz da árvore do Espaço
  },
  // Balas mágicas por portais ao redor do alvo: alcance maior e mais difícil de esquivar, dano um pouco menor
  myriad_black: {
    id: 'myriad_black', name: 'Myriad Black', description: 'Balas mágicas saem de portais ao redor do alvo: difíceis de esquivar e também atingem quem estiver colado nele.', gif: 'espaco_myriad_black.gif', grimoire: 'espaco', magic: true, element: 'espaco',
    type: 'attack', range: 4, damage: [9, 14], attribute: 'magiaOfensiva', manaCost: 34, dodgePenalty: 0.25, splash: { radius: 1, share: 0.4 }, // balas por portais ao redor do alvo
    minLevel: 12, after: 'archangel_shootdown',
  },
  // Massa de magia espacial que persegue o alvo; ao acertar, o teletransporta para longe (3+ casas de quem atacou)
  fallen_angel_flapping: {
    id: 'fallen_angel_flapping', name: 'Fallen Angel Flapping', description: 'Uma massa de magia espacial persegue o alvo e, ao acertar, o teletransporta para longe de você.', gif: 'espaco_fallen_angel_flapping.gif', grimoire: 'espaco', magic: true, element: 'espaco',
    type: 'attack', range: 4, damage: [8, 12], attribute: 'magiaOfensiva', manaCost: 38, cooldown: 3, dodgePenalty: 0.15, displace: 3,
    minLevel: 18, after: 'myriad_black',
  },
  // A grande massa: o golpe mais forte do Espaço, ignora Bloqueio, mas cara e com recarga
  archangel_destruction: {
    id: 'archangel_destruction', name: 'Archangel Destruction', description: 'A grande massa espacial, o golpe mais forte do Espaço. Ignora o Bloqueio e engole quem estiver perto do alvo.', gif: 'espaco_archangel_destruction.gif', grimoire: 'espaco', magic: true, element: 'espaco',
    type: 'attack', range: 4, damage: [18, 26], attribute: 'magiaOfensiva', manaCost: 55, cooldown: 3, ignoreBlock: true, splash: { radius: 2, share: 0.6 }, // a grande massa engole quem está por perto
    minLevel: 28, after: 'fallen_angel_flapping',
  },
  // Portal: leva você N casas numa direção (use `direcao` e `casas` no /habilidade). Não funciona imobilizado.
  fallen_angel_gate: {
    id: 'fallen_angel_gate', name: 'Fallen Angel Gate', description: 'Abre um portal e te leva várias casas na direção que você escolher. Não funciona se você estiver imobilizado.', gif: 'espaco_fallen_angel_gate.gif', grimoire: 'espaco', magic: true,
    type: 'bonus', manaCost: 30, cooldown: 2, teleport: 'self', destRange: 5,
    minLevel: 10, after: 'archangel_shootdown',
  },
  // O portal também devolve a magia inimiga ao lançador (metade do dano; nunca mata)
  fallen_angel_gate_reflexo: {
    id: 'fallen_angel_gate_reflexo', name: 'Fallen Angel Gate: Reflexo', description: 'Reação contra magia: o portal engole o feitiço inimigo e devolve parte do dano para quem lançou.', actionText: 'Fallen Angel Gate: Reflexo', gif: 'espaco_fallen_angel_gate.gif', grimoire: 'espaco',
    type: 'reaction', kind: 'reflect', reflect: 0.5, onlyVsMagic: true, manaCost: 45, emoji: '🌀',
    minLevel: 14, after: 'fallen_angel_gate',
  },
  // Barreira esférica ao redor do alvo: ele não consegue se mover por 2 turnos (ainda reage e ataca)
  different_dimension_sphere: {
    id: 'different_dimension_sphere', name: 'Different Dimension Sphere', description: 'Prende o alvo numa barreira esférica: ele não consegue se mover, mas ainda ataca e reage.', gif: 'espaco_different_dimension_sphere.gif', grimoire: 'espaco', magic: true,
    type: 'bonus', manaCost: 36, cooldown: 4, targetRange: 4, applies: [{ effect: 'esfera_dimensional', turns: 2, to: 'enemy' }],
    minLevel: 18, after: 'fallen_angel_gate',
  },
  // Leva o ALVO N casas numa direção (use `direcao` e `casas`): tira o inimigo do alcance ou o joga para longe de você
  blackout: {
    id: 'blackout', name: 'Blackout', description: 'Abre um portal sob o inimigo e o joga para outro lugar do mapa, tirando ele do seu caminho ou do alcance do seu time.', gif: 'espaco_blackout.gif', grimoire: 'espaco', magic: true,
    type: 'bonus', manaCost: 40, cooldown: 4, targetRange: 5, teleport: 'enemy', destRange: 5,
    minLevel: 22, after: 'different_dimension_sphere',
  },
  // Domina a mana do lançador: anula a magia e ainda drena a mana dele (a defesa mais forte do Espaço, mas só contra magia)
  spatial_mana_domination: {
    id: 'spatial_mana_domination', name: 'Spatial Mana Domination', description: 'Reação contra magia: domina a mana de quem lançou, anula o feitiço e ainda drena a mana dele.', actionText: 'Spatial Mana Domination', gif: 'espaco_spatial_mana_domination.gif', grimoire: 'espaco',
    type: 'reaction', kind: 'capture', onlyVsMagic: true, drainMana: 25, manaCost: 40, emoji: '⬛',
    minLevel: 30, after: 'fallen_angel_gate_reflexo',
  },
  // Leva o alvo para um cubo vermelho: 4 turnos sem se mover e mais difícil de esquivar
  unopening_red_room: {
    id: 'unopening_red_room', name: 'Unopening Red Room', description: 'Prende o alvo num cubo vermelho por vários turnos: ele não se move e fica mais fácil de acertar.', gif: 'espaco_unopening_red_room.gif', grimoire: 'espaco', magic: true, element: 'espaco',
    type: 'attack', range: 4, damage: [8, 12], attribute: 'magiaOfensiva', manaCost: 48, cooldown: 5,
    applies: [{ effect: 'sala_vermelha', turns: 4 }],
    minLevel: 32, after: 'different_dimension_sphere',
  },
  // Figuras com armas brotam do chão: 3 clones aparecem no mapa e atacam sozinhos no fim do seu turno (andam 2 casas e batem
  // se ficarem coladas no inimigo, sem reação possível). Dano baixo cada um: o dano base mais uma fração (22%) do bônus do atributo.
  crevice_men: {
    id: 'crevice_men', name: 'Crevice Men', description: 'Figuras armadas brotam do chão e lutam por você por alguns turnos, andando e atacando os inimigos sozinhas.', gif: 'espaco_crevice_men.gif', grimoire: 'espaco', magic: true,
    type: 'bonus', manaCost: 60, cooldown: 5, attribute: 'magiaOfensiva', summon: { count: 3, duration: 3, damage: [2, 4], share: 0.22 },
    minLevel: 38, after: 'unopening_red_room',
  },

  // ---- Grimório das Trevas (LENDÁRIO) ----
  // Espadeiro: tudo gira em torno da espada imbuída em trevas. Escala de atributo da raridade (1,7x). Sem `ranks`.
  // Árvore: Lâmina Negra -> { Corte da Escuridão -> { Corte Selvagem, Corte Dimensional } }, { Casulo Negro },
  //         { Lâmina Sem Fio -> Lua Negra -> Impulso da Morte }.
  // Lua Negra: buff que apaga parte da magia recebida e libera o Impulso da Morte (que a consome).
  lamina_negra: {
    id: 'lamina_negra', name: 'Lâmina Negra Imbuída em Trevas', description: 'Cobre a espada de escuridão e a transforma numa lâmina mais longa. Um corte que alcança mais longe que um golpe comum.', actionText: 'Lâmina Negra Imbuída em Trevas', gif: 'trevas_lamina_negra.gif', grimoire: 'trevas', magic: true, element: 'trevas',
    type: 'attack', range: 2, damage: [8, 12], attribute: 'magiaOfensiva', manaCost: 22, // a lâmina longa dá alcance 2, mas é o golpe mais fraco
    minLevel: 8, // raiz da árvore das Trevas
  },
  // Onda de escuridão afiada que voa até o alvo (alcance longo)
  corte_da_escuridao: {
    id: 'corte_da_escuridao', name: 'Corte da Escuridão Imbuído em Trevas', description: 'Canaliza a escuridão na espada e a libera num corte afiado que voa até o oponente. Atinge de longe e cega o alvo com a Escuridão.', actionText: 'Corte da Escuridão Imbuído em Trevas', gif: 'trevas_corte_da_escuridao.gif', grimoire: 'trevas', magic: true, element: 'trevas',
    type: 'attack', range: 4, damage: [10, 15], attribute: 'magiaOfensiva', manaCost: 32, applies: [{ effect: 'escuridao', turns: 1 }], // a escuridão cega o alvo por 1 turno
    minLevel: 12, after: 'lamina_negra',
  },
  // Vários cortes desordenados: dano menor, mas difíceis de esquivar
  corte_selvagem: {
    id: 'corte_selvagem', name: 'Corte Selvagem Imbuído em Trevas', description: 'Balança a espada imbuída em trevas de forma desordenada, soltando vários cortes de escuridão. Difícil de esquivar, cega o alvo e atinge quem estiver colado nele.', actionText: 'Corte Selvagem Imbuído em Trevas', gif: 'trevas_corte_selvagem.gif', grimoire: 'trevas', magic: true, element: 'trevas',
    type: 'attack', range: 3, damage: [9, 13], attribute: 'magiaOfensiva', manaCost: 38, cooldown: 2, dodgePenalty: 0.3, splash: { radius: 1, share: 0.5 }, applies: [{ effect: 'escuridao', turns: 2 }], // os cortes desordenados também pegam quem está colado no alvo
    minLevel: 18, after: 'corte_da_escuridao',
  },
  // Barra descendente que corta até magia espacial: ignora Bloqueio e derruba as defesas do Espaço (Reflexo e Captura)
  corte_dimensional: {
    id: 'corte_dimensional', name: 'Corte Dimensional Imbuído em Trevas', description: 'Uma barra descendente de escuridão que voa até o oponente e corta até Magia Espacial. Ignora o Bloqueio e atravessa as defesas do Espaço.', actionText: 'Corte Dimensional Imbuído em Trevas', gif: 'trevas_corte_dimensional.gif', grimoire: 'trevas', magic: true, element: 'trevas',
    type: 'attack', range: 5, damage: [17, 24], attribute: 'magiaOfensiva', manaCost: 52, cooldown: 3, ignoreBlock: true, cutsSpace: true,
    minLevel: 28, after: 'corte_da_escuridao',
  },
  // Esfera oca de escuridão: a defesa mais forte do grimório (absorve como um bloqueio mágico)
  casulo_negro: {
    id: 'casulo_negro', name: 'Casulo Negro', description: 'Cria uma esfera oca de escuridão ao seu redor. Reação que absorve boa parte do golpe recebido.', actionText: 'Casulo Negro', gif: 'trevas_casulo_negro.gif', grimoire: 'trevas',
    type: 'reaction', kind: 'block', absorb: [5, 9], attribute: 'magiaDefensiva', manaCost: 30, emoji: '⚫',
    minLevel: 14, after: 'lamina_negra',
  },
  // Lado cego da lâmina: afasta o alvo do corpo a corpo (sem dano)
  lamina_negra_sem_fio: {
    id: 'lamina_negra_sem_fio', name: 'Lâmina Negra Sem Fio Imbuída em Trevas', description: 'Estende a lâmina de escuridão e acerta o alvo com o lado sem corte. Empurra o inimigo para longe, sem causar dano.', actionText: 'Lâmina Negra Sem Fio Imbuída em Trevas', gif: 'trevas_lamina_negra_sem_fio.gif', grimoire: 'trevas', magic: true,
    type: 'bonus', manaCost: 25, cooldown: 3, targetRange: 2, push: 3,
    minLevel: 14, after: 'lamina_negra',
  },
  // Buraco negro: 3 turnos absorvendo 35% do dano de magia que você sofre; libera o Impulso da Morte
  lua_negra: {
    id: 'lua_negra', name: 'Lua Negra', description: 'Assume o controle da mana ao redor e cria um Buraco Negro que apaga a magia inimiga. Por alguns turnos, absorve parte do dano mágico que você recebe e libera o Impulso da Morte.', actionText: 'Lua Negra', gif: 'trevas_lua_negra.gif', grimoire: 'trevas', magic: true,
    type: 'bonus', manaCost: 40, cooldown: 4, applies: [{ effect: 'lua_negra', turns: 3 }],
    minLevel: 22, after: 'lamina_negra_sem_fio',
  },
  // Explosão focada no braço: só com a Lua Negra ativa (que é gasta no golpe). Corpo a corpo, enorme e ignora Bloqueio
  impulso_da_morte: {
    id: 'impulso_da_morte', name: 'Impulso da Morte', description: 'Condensa a Lua Negra no braço e empurra a espada contra o alvo numa explosão focada. Golpe corpo a corpo enorme que ignora o Bloqueio; exige a Lua Negra ativa e a consome.', actionText: 'Impulso da Morte', gif: 'trevas_impulso_da_morte.gif', grimoire: 'trevas', magic: true, element: 'trevas',
    type: 'attack', range: 1, damage: [24, 32], attribute: 'magiaOfensiva', manaCost: 50, cooldown: 2, ignoreBlock: true, applies: [{ effect: 'escuridao', turns: 2 }],
    requiresEffect: 'lua_negra', consumesEffect: 'lua_negra',
    minLevel: 32, after: 'lua_negra',
  },

  // ---- Grimório da Árvore do Mundo (LENDÁRIO) ----
  // Controle de área e suporte: prende, cura e protege o time. Escala de atributo da raridade (1,7x). Sem `ranks`.
  // Árvore: Semente -> { Descida da Árvore Mágica, Florescer da Yggdrasil, Grande Árvore Mistilteinn -> Formação Dracaena }.
  // Enraizado impede de se mover (ainda pode atacar e reagir).
  // Lança uma semente que vira madeira ao redor do alvo e o prende
  semente_de_mistilteinn: {
    id: 'semente_de_mistilteinn', name: 'Semente de Mistilteinn', description: 'Lança uma semente mágica que vira uma estrutura de madeira em volta do alvo. Causa dano e o enraíza, impedindo que ele se mova.', actionText: 'Semente de Mistilteinn', gif: 'arvore_semente_de_mistilteinn.gif', grimoire: 'arvore_do_mundo', magic: true, element: 'planta',
    type: 'attack', range: 4, damage: [7, 11], attribute: 'magiaOfensiva', manaCost: 28, cooldown: 3,
    applies: [{ effect: 'enraizado', turns: 2 }],
    minLevel: 8, // raiz da árvore
  },
  // Estacas de madeira em alta velocidade: o alvo reage normalmente e quem está perto dele leva 60% do dano
  descida_da_arvore_magica: {
    id: 'descida_da_arvore_magica', name: 'Descida da Árvore Mágica', description: 'Invoca uma árvore gigante acima do campo, que dispara estacas de madeira em alta velocidade. Atinge de longe e também quem estiver perto do alvo.', actionText: 'Descida da Árvore Mágica', gif: 'arvore_descida_da_arvore_magica.gif', grimoire: 'arvore_do_mundo', magic: true, element: 'planta',
    type: 'attack', range: 5, damage: [11, 16], attribute: 'magiaOfensiva', manaCost: 45, cooldown: 3, dodgePenalty: 0.1,
    splash: { radius: 2, share: 0.6 },
    minLevel: 18, after: 'semente_de_mistilteinn',
  },
  // Cura você e os aliados a até `radius` casas (valor sorteado + Magia Suplementar). Sem aliados por perto, cura só você.
  florescer_da_yggdrasil: {
    id: 'florescer_da_yggdrasil', name: 'Florescer da Yggdrasil', description: 'Uma árvore mágica se espalha e seus galhos envolvem os aliados feridos para restaurá-los. Cura você e os aliados por perto.', actionText: 'Florescer da Yggdrasil', gif: 'arvore_florescer_da_yggdrasil.gif', grimoire: 'arvore_do_mundo', magic: true,
    type: 'bonus', manaCost: 55, cooldown: 4, radius: 4, heal: [10, 16], attribute: 'magiaSuplementar',
    minLevel: 16, after: 'semente_de_mistilteinn',
    use(battle, user) {
      const scale = this.attributeScale ?? C.RARITY_SCALE[getGrimoire(this.grimoire)?.rarity] ?? 1;
      const bonus = Math.round((user.attrs[this.attribute] ?? 0) * (C.DAMAGE_PER_POINT[this.attribute] ?? 0) * scale);
      const affected = battle.players.filter(p => p.hp > 0 && (p === user
        || (p.team === user.team && p.pos && user.pos && distance(p.pos, user.pos) <= this.radius)));
      let text = `🌳 ${user.name} usou **Florescer da Yggdrasil**: os galhos curam ${affected.length > 1 ? 'o time' : 'quem os invocou'}.`;
      for (const p of affected) {
        const healed = Math.max(0, Math.min(p.maxHp - p.hp,this.heal[0] + Math.floor(Math.random() * (this.heal[1] - this.heal[0] + 1)) + bonus));
        p.hp += healed;
        text += `${NL}${p.name}: ❤️ +${healed} de vida.`;
      }
      return text;
    },
  },
  // Raízes gigantes prendem todos os inimigos a até 4 casas (sem dano)
  grande_arvore_mistilteinn: {
    id: 'grande_arvore_mistilteinn', name: 'Grande Árvore Mistilteinn', description: 'Libera uma enorme quantidade de mana: raízes gigantes tomam o campo e uma árvore colossal cresce. Enraíza todos os inimigos ao seu redor.', actionText: 'Grande Árvore Mistilteinn', gif: 'arvore_grande_arvore_mistilteinn.gif', grimoire: 'arvore_do_mundo', magic: true,
    type: 'bonus', manaCost: 50, cooldown: 5, area: { radius: 4 }, applies: [{ effect: 'enraizado', turns: 2, to: 'enemy' }],
    minLevel: 24, after: 'semente_de_mistilteinn',
  },
  // Estrutura de madeira: prende os inimigos num raio de 3 casas e protege você e os aliados (-30% de dano por 2 turnos)
  formacao_dracaena: {
    id: 'formacao_dracaena', name: 'Formação Dracaena', description: 'Raízes emergem do solo e formam uma estrutura gigante de madeira. Enraíza os inimigos próximos e protege você e os aliados, que recebem menos dano.', actionText: 'Formação Dracaena', gif: 'arvore_formacao_dracaena.gif', grimoire: 'arvore_do_mundo', magic: true,
    type: 'bonus', manaCost: 70, cooldown: 5, radius: 3,
    minLevel: 34, after: 'grande_arvore_mistilteinn',
    use(battle, user) {
      const near = p => p.hp > 0 && p.pos && user.pos && distance(p.pos, user.pos) <= this.radius;
      const allies = battle.players.filter(p => p === user || (p.team === user.team && near(p)));
      const foes = battle.players.filter(p => p.team !== user.team && near(p));
      const lines = [`🌳 ${user.name} usou **Formação Dracaena**: a madeira protege o time e prende quem está por perto.`];
      for (const p of allies) lines.push(fx.applyEffect(p, 'abrigo_dracaena', { turns: 2 }));
      for (const p of foes) lines.push(fx.applyEffect(p, 'enraizado', { turns: 2 }));
      return lines.join(NL);
    },
  },
};

const TYPE_LABEL = { attack: 'Ataque', bonus: 'Ação bônus', reaction: 'Reação' };

const getAbility = id => abilities[id];

// A habilidade no rank do jogador: os campos de cada rank até ele sobrescrevem os da habilidade base
// (os `ranks` aplicam de forma acumulada: o rank 3 parte do que o rank 2 já mudou).
function resolveAbility(ability, rank = 1) {
  if (!ability || rank <= 1 || !ability.ranks) return ability && { ...ability, rank: 1 };
  const { minLevel, cost, ...changes } = Object.assign({}, ...ability.ranks.slice(0, rank - 1));
  return { ...ability, ...changes, rank: Math.min(rank, ability.ranks.length + 1) };
}

module.exports = { abilities, getAbility, resolveAbility, TYPE_LABEL };
