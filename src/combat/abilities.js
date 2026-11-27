// Catálogo de habilidades. Cada uma tem um `type`:
//   attack   -> gasta a ação de ataque do turno (usada com /habilidade)
//   bonus    -> gasta a ação bônus do turno (usada com /habilidade); precisa de `use(battle, user)` que retorna o log
//               `usesAttack: true` -> magia ofensiva que age na hora como a bônus, mas gasta a AÇÃO DE ATAQUE (aparece como Ataque)
//   reaction -> usada pelo defensor quando é atacado (aparece como botão)
// Reações têm um `kind` ('dodge', 'block' ou 'capture') que define como são resolvidas.
// Defesas `block` usam `absorb: [mín, máx]` + `attribute` (resistencia, magiaDefensiva...) e escalam como um ataque
// (valor sorteado + atributo × config.DEFENSE_PER_POINT).
// `energyCost` é a energia gasta ao usar a habilidade. Magias usam `manaCost` no lugar (gastam mana, não energia).
// Ataques causam um dano sorteado em `damage: [mín, máx]` + atributo × multiplicador (config.DAMAGE_PER_POINT);
// `attribute` diz qual atributo conta. A árvore de habilidades vai melhorar esse intervalo.
// Magias de grimório precisam ser APRENDIDAS (na árvore de habilidades do site) para entrar no kit; é uma árvore:
//   minLevel -> nível mínimo do jogador para poder aprender
//   custo    -> comprar gasta PONTOS DE HABILIDADE (não de atributo): raiz = 1 e +1 a cada nível descendo a árvore
//               (characters.learnCost); `cost: N` sobrescreve. Os atributos só aumentam o dano/defesa das habilidades.
//   after    -> id da magia que precisa ter sido aprendida antes (a raiz da árvore não tem `after`)
//   ranks    -> evoluções da magia dentro da árvore (comprar de novo na árvore sobe para o próximo rank). A habilidade em si é o rank 1;
//               cada item de `ranks` é o rank 2, 3... com `minLevel` (e `cost`, opcional) próprios e os campos que mudam (damage, manaCost,
//               cooldown, applies, absorb...). Os campos se acumulam rank a rank (resolveAbility).
//
// Efeitos de combate (catálogo de debuffs genéricos em effects.js):
//   applies -> lista de efeitos que a habilidade aplica: { effect: 'sangramento', turns: 3, stacks: 1, power: 2, to: 'enemy'|'self', chance: 0.5 }
//              (só `effect` é obrigatório; ataque aplica no alvo se causar dano, ação bônus aplica em quem usou; `to` muda isso)
//   active  -> magia ativa que a habilidade liga em quem usou, com os bônus DELA: { turns, mods, lowHpMods, endsOnElement, id, name, emoji }
//              (ataque liga se acertar; ação bônus liga sempre). Ver effects.js.
//   requiresActive -> id da magia ativa que precisa estar ligada para usar esta; consumesActive -> ela se apaga ao usar esta
//   magic    -> true se for uma magia (reações como Chrono Stasis Grigora só funcionam contra magia)
//   cooldown -> turnos seus até poder usar de novo (1ª vez livre)
//   grimoire -> id do grimório (grimoires.js) a que a habilidade pertence; quem tem esse grimório recebe a habilidade no kit
//   element -> elemento do golpe ('fogo', 'gelo', 'relampago'...), usado nas interações (Encharcado, Congelado)
//
//   O bônus do atributo (config.DAMAGE_PER_POINT) é multiplicado pela escala da raridade do grimório (config.RARITY_SCALE);
//   `attributeScale` na habilidade sobrescreve. Dano base, mana e efeitos também variam por magia (um efeito forte pede dano menor).
//   Depois, a força inteira (valor sorteado + atributo) das magias do grimório de quem lança é multiplicada pelos trevos dele (clovers.js, config.CLOVER_MULT).
//   A árvore de habilidades melhora o `damage` base (e talvez a escala).
//
// Campos opcionais para o aviso da ação (o embed "X utilizou ..." com o GIF):
//   actionText -> como a ação aparece no título, ex: "um Soco" (padrão: o nome)
//   gif        -> URL do GIF, ou nome de um arquivo da pasta assets/gifs (ex: 'soco.gif').
//                 Sem GIF, o aviso aparece só com o título.
//   gifDurationMs -> quanto o jogo espera esse GIF rodar (padrão: ACTION_GIF_WAIT_MS)
const fx = require('./effects');
const { rollPower } = require('./clovers');
const { distance } = require('./grid');
const NL = '\n';

// `user` e os aliados vivos a até `radius` casas dele (curas em grupo)
const alliesNear = (battle, user, radius) => battle.players.filter(p => p.hp > 0 && (p === user || (p.team === user.team && p.pos && user.pos && distance(p.pos, user.pos) <= radius)));
// Inimigos vivos de `user` a até `radius` casas dele (magias de área lançadas por ação bônus)
const foesInArea = (battle, user, radius) => battle.players.filter(p => p.hp > 0 && p.team !== user.team && p.pos && user.pos && distance(p.pos, user.pos) <= radius);

// Dano bruto de uma magia de ação bônus: (valor sorteado + atributo × escala da raridade) × trevos do grimório + bônus de efeitos
function rollMagic(ability, user) {
  return rollPower(user, ability, ability.damage) + fx.getMods(user).damageBonus;
}

// Dano de uma magia de ação bônus (sem reação): o dano bruto vezes `mult`, menos as resistências do alvo.
// Já tira a vida do alvo e retorna o dano causado.
function hitWithMagic(ability, user, foe, mult = 1) {
  const raw = rollMagic(ability, user);
  const resist = Math.min(0.9, fx.getMods(foe).damageResist + fx.getMods(foe).magicResist);
  const dmg = Math.max(1, Math.round(raw * mult * (1 - resist)));
  foe.hp = Math.max(0, foe.hp - dmg);
  return dmg;
}

// Magia de área: as invocações inimigas a até `radius` casas de `user` (pela casa mais próxima de cada uma) também levam o
// dano, uma vez cada (invocações não têm resistências nem efeitos). Retorna as linhas do log.
function hitSummonsInArea(ability, battle, user, radius) {
  const { enemySummons, summonDistance, damageSummon } = require('./battle'); // aqui dentro: battle.js já depende deste arquivo
  if (!user.pos) return [];
  return enemySummons(battle, user)
    .filter(s => summonDistance(s, user.pos) <= radius)
    .flatMap(s => damageSummon(battle, s, Math.max(1, Math.round(rollMagic(ability, user)))));
}

// Instinto Selvagem (Fera): os golpes e a investida acendem a mesma ativa, que só renova (+dano, +1 casa; mais dano com pouca vida)
const instintoSelvagem = turns => ({
  id: 'instinto_selvagem', name: 'Instinto Selvagem', emoji: '🐺', turns,
  mods: { damageBonus: 3, moveDelta: 1 }, lowHpMods: { damageBonus: 3 },
});

const abilities = {
  soco: { id: 'soco', name: 'Soco', description: 'Um golpe físico simples, corpo a corpo. Gasta energia, não mana.', actionText: 'um Soco', gif: 'soco.gif', type: 'attack', range: 1, damage: [2, 4], attribute: 'forca', energyCost: 10 },

  esquiva: { id: 'esquiva', name: 'Esquiva', description: 'Reação: tenta sair do caminho e evitar todo o dano do ataque. A Destreza aumenta a chance.', type: 'reaction', kind: 'dodge', chance: 0.5, energyCost: 15, emoji: '💨' }, // 50% (+ Destreza) de evitar todo o dano
  bloqueio: { id: 'bloqueio', name: 'Bloqueio', description: 'Reação: segura o golpe e absorve parte do dano. A Resistência aumenta o quanto você absorve.', type: 'reaction', kind: 'block', absorb: [1, 2], attribute: 'resistencia', energyCost: 10, emoji: '🛡️' }, // absorve um valor sorteado (1-2) + Resistência × 0,5

  // ---- Grimório do Tempo ----
  // Grimório MÍTICO. Começa com magias mais fracas (Esferas, Raio Refletor, Deslocamento) antes das três fortes.
  // Árvore: Esferas do Tempo -> { Deslocamento Atemporal }, { Raio Refletor do Tempo -> Chrono Stasis -> Chrono Stasis Grigora
  //         -> Chrono Anastasis }.
  // Muitas esferas pequenas de longe: atravessam paredes e algumas defesas (ignora o Bloqueio), dano baixo e barato
  esferas_do_tempo: {
    id: 'esferas_do_tempo', name: 'Esferas do Tempo', description: 'Lança pequenas esferas em grande quantidade, capazes de atravessar estruturas, paredes e alguns poderes. Ataque de longo alcance, barato e que ignora o Bloqueio.', actionText: 'Esferas do Tempo', gif: 'tempo_esferas_do_tempo.gif', grimoire: 'tempo', magic: true,
    type: 'attack', range: 5, damage: [6, 9], attribute: 'magiaOfensiva', manaCost: 16, ignoreBlock: true,
    minLevel: 2, // raiz da árvore do Tempo
    // Rank II: mais esferas
    ranks: [
      { minLevel: 12, damage: [9, 13] },
    ],
  },
  // Esquiva que acompanha golpes velozes: a velocidade do ataque (dodgePenalty) não atrapalha. Por ser mítica, um pouco acima
  // do Salto Fotônico da Luz (65%/75%)
  deslocamento_atemporal: {
    id: 'deslocamento_atemporal', name: 'Deslocamento Atemporal', description: 'Desloca-se rapidamente diante de ataques de alta velocidade. Reação de esquiva que não perde chance contra golpes rápidos ou difíceis de esquivar.', actionText: 'Deslocamento Atemporal', gif: 'tempo_deslocamento_atemporal.gif', grimoire: 'tempo', magic: true,
    type: 'reaction', kind: 'dodge', chance: 0.68, ignoresSpeed: true, manaCost: 18, emoji: '⏱️',
    minLevel: 3, after: 'esferas_do_tempo',
    // Rank II: esquiva mais fácil
    ranks: [
      { minLevel: 14, chance: 0.78 },
    ],
  },
  // Feixe de luz rebatido por Chrono Stasis até acertar: muito difícil de esquivar
  raio_refletor_do_tempo: {
    id: 'raio_refletor_do_tempo', name: 'Raio Refletor do Tempo', description: 'Solta um feixe de luz e cria Chrono Stasis pelo caminho para refletir o feixe de volta na direção do alvo até acertar. Ataque de longo alcance muito difícil de esquivar.', actionText: 'Raio Refletor do Tempo', gif: 'tempo_raio_refletor_do_tempo.gif', grimoire: 'tempo', magic: true,
    type: 'attack', range: 5, damage: [8, 12], attribute: 'magiaOfensiva', manaCost: 24, dodgePenalty: 0.35,
    minLevel: 4, after: 'esferas_do_tempo',
    // Rank II: feixe mais forte
    ranks: [
      { minLevel: 13, damage: [11, 16] },
    ],
  },
  // A magia de ataque mais forte do servidor. Dano bem acima do Soco e deixa o alvo Paralisado (imóvel e sem reação, ainda pode atacar)
  chrono_stasis: {
    id: 'chrono_stasis', name: 'Chrono Stasis', description: 'Prende o alvo numa esfera com um anel de algarismos romanos, onde ele revive o mesmo instante em loop. Causa dano e deixa o alvo Paralisado: não se move nem reage, mas ainda pode atacar.', actionText: 'Chrono Stasis', gif: 'chrono_stasis.gif', grimoire: 'tempo', magic: true,
    type: 'attack', range: 3, damage: [12, 18], attribute: 'magiaOfensiva', manaCost: 40,
    minLevel: 6, after: 'raio_refletor_do_tempo', applies: [{ effect: 'paralisado', turns: 2 }], cooldown: 3,
    // O Paralisado (imóvel + sem reação) é o que a faz forte, então o dano sobe pouco por rank e o controle é limitado por recarga:
    // 2 turnos dão no máximo UM golpe livre; nunca dá para encadear uma paralisia na outra.
    ranks: [
      { minLevel: 15, damage: [17, 24] },
      { minLevel: 26, damage: [23, 32], manaCost: 45, applies: [{ effect: 'paralisado', turns: 3 }], cooldown: 4 },
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
    type: 'bonus', usesAttack: true, manaCost: 36, cooldown: 4, targetRange: 4, applies: [{ effect: 'preso', turns: 2, to: 'enemy' }],
    minLevel: 18, after: 'fallen_angel_gate',
  },
  // Leva o ALVO N casas numa direção (use `direcao` e `casas`): tira o inimigo do alcance ou o joga para longe de você
  blackout: {
    id: 'blackout', name: 'Blackout', description: 'Abre um portal sob o inimigo e o joga para outro lugar do mapa, tirando ele do seu caminho ou do alcance do seu time.', gif: 'espaco_blackout.gif', grimoire: 'espaco', magic: true,
    type: 'bonus', usesAttack: true, manaCost: 40, cooldown: 4, targetRange: 5, teleport: 'enemy', destRange: 5,
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
    applies: [{ effect: 'preso', turns: 4 }, { effect: 'lentidao', turns: 4 }],
    minLevel: 32, after: 'different_dimension_sphere',
  },
  // Figuras com armas brotam do chão: 3 clones aparecem no mapa e atacam sozinhos no fim do seu turno (andam 2 casas e batem
  // se ficarem coladas no inimigo, sem reação possível). Dano baixo cada um: o dano base mais uma fração (22%) do bônus do atributo.
  crevice_men: {
    id: 'crevice_men', name: 'Crevice Men', description: 'Figuras armadas brotam do chão e lutam por você, andando e atacando os inimigos sozinhas até serem destruídas.', gif: 'espaco_crevice_men.gif', grimoire: 'espaco', magic: true,
    type: 'bonus', manaCost: 60, cooldown: 5, attribute: 'magiaOfensiva', summon: { count: 3, hp: 14, damage: [2, 4], share: 0.22, label: 'Crevice Man', icon: 'crevice_men.png' },
    minLevel: 38, after: 'unopening_red_room',
  },

  // ---- Grimório das Trevas (LENDÁRIO) ----
  // Espadeiro: tudo gira em torno da espada imbuída em trevas. Escala de atributo da raridade (1,7x). Sem `ranks`.
  // Árvore: Lâmina Negra -> { Corte da Escuridão -> { Corte Selvagem, Corte Dimensional } }, { Casulo Negro },
  //         { Lâmina Sem Fio -> Lua Negra -> Impulso da Morte }.
  // Lua Negra: magia ativa que apaga parte da magia recebida e libera o Impulso da Morte (que a consome).
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
    type: 'bonus', usesAttack: true, manaCost: 25, cooldown: 3, targetRange: 2, push: 3,
    minLevel: 14, after: 'lamina_negra',
  },
  // Buraco negro: 3 turnos absorvendo 35% do dano de magia que você sofre; libera o Impulso da Morte
  lua_negra: {
    id: 'lua_negra', name: 'Lua Negra', description: 'Assume o controle da mana ao redor e cria um Buraco Negro que apaga a magia inimiga. Por alguns turnos, absorve parte do dano mágico que você recebe e libera o Impulso da Morte.', actionText: 'Lua Negra', gif: 'trevas_lua_negra.gif', grimoire: 'trevas', magic: true,
    type: 'bonus', manaCost: 40, cooldown: 4, active: { emoji: '🌑', turns: 3, mods: { magicResist: 0.35 } },
    minLevel: 22, after: 'lamina_negra_sem_fio',
  },
  // Explosão focada no braço: só com a Lua Negra ativa (que é gasta no golpe). Corpo a corpo, enorme e ignora Bloqueio
  impulso_da_morte: {
    id: 'impulso_da_morte', name: 'Impulso da Morte', description: 'Condensa a Lua Negra no braço e empurra a espada contra o alvo numa explosão focada. Golpe corpo a corpo enorme que ignora o Bloqueio; exige a Lua Negra ativa e a consome.', actionText: 'Impulso da Morte', gif: 'trevas_impulso_da_morte.gif', grimoire: 'trevas', magic: true, element: 'trevas',
    type: 'attack', range: 1, damage: [24, 32], attribute: 'magiaOfensiva', manaCost: 50, cooldown: 2, ignoreBlock: true, applies: [{ effect: 'escuridao', turns: 2 }],
    requiresActive: 'lua_negra', consumesActive: 'lua_negra',
    minLevel: 32, after: 'lua_negra',
  },

  // ---- Grimório da Árvore do Mundo (LENDÁRIO) ----
  // Raízes e árvores mágicas: a semente fura defesas e suga mana, raízes esmagam e atacam em área, a Grande Árvore drena a
  // mana de todos ao redor e prende, a Yggdrasil cura o time e o freixo de Torineko bloqueia feitiços. Escala da raridade (1,7x).
  // Árvore: Semente -> { Proteção de Torineko }, { Florescer da Yggdrasil }, { Descida da Árvore Mágica },
  //         { Formação Dracaena -> Grande Árvore Mistilteinn }.
  // As raízes deixam o alvo Preso: não se move (ainda pode atacar e reagir).
  // Semente atirada de perto: fura as defesas (ignora o Bloqueio), vira uma árvore que engole o alvo e suga a mana dele
  semente_de_mistilteinn: {
    id: 'semente_de_mistilteinn', name: 'Semente de Mistilteinn', description: 'Atira da mão uma semente mágica que fura as defesas do inimigo e, segundos depois, vira uma árvore que o engole e suga a mana dele para a Grande Árvore Mistilteinn. Curto alcance: ignora o Bloqueio, enraíza o alvo e rouba a mana dele.', actionText: 'Semente de Mistilteinn', gif: 'arvore_semente_de_mistilteinn.gif', grimoire: 'arvore_do_mundo', magic: true, element: 'planta',
    type: 'attack', range: 2, damage: [8, 12], attribute: 'magiaOfensiva', manaCost: 26, cooldown: 3, ignoreBlock: true, drainMana: 15,
    applies: [{ effect: 'preso', turns: 2 }],
    minLevel: 8, // raiz da árvore
    // Rank II: mais dano e suga mais. Rank III: a árvore prende por mais tempo.
    ranks: [
      { minLevel: 18, damage: [11, 16], drainMana: 25 },
      { minLevel: 30, damage: [14, 20], drainMana: 35, applies: [{ effect: 'preso', turns: 3 }] },
    ],
  },
  // Freixo gigante: os galhos contornam e bloqueiam o feitiço (só contra magia, absorve muito)
  protecao_magica_de_torineko: {
    id: 'protecao_magica_de_torineko', name: 'Proteção Mágica de Torineko', description: 'Cria um freixo gigante e direciona os galhos para contornar e bloquear feitiços. Reação contra magia que absorve boa parte do dano.', actionText: 'Proteção Mágica de Torineko', gif: 'arvore_protecao_magica_de_torineko.gif', grimoire: 'arvore_do_mundo', magic: true,
    type: 'reaction', kind: 'block', absorb: [7, 11], attribute: 'magiaDefensiva', onlyVsMagic: true, manaCost: 30, emoji: '🌳',
    minLevel: 12, after: 'semente_de_mistilteinn',
    // Rank II: galhos mais grossos
    ranks: [
      { minLevel: 26, absorb: [10, 15] },
    ],
  },
  // Cura você e os aliados a até `radius` casas (valor sorteado + Magia Suplementar). Sem aliados por perto, cura só você.
  florescer_da_yggdrasil: {
    id: 'florescer_da_yggdrasil', name: 'Florescer da Yggdrasil', description: 'Brota uma árvore maciça que se espalha pela área e envolve os feridos com os galhos, levantando-os e curando lesões de todo tipo. Ação bônus que cura você e os aliados por perto.', actionText: 'Florescer da Yggdrasil', gif: 'arvore_florescer_da_yggdrasil.gif', grimoire: 'arvore_do_mundo', magic: true,
    type: 'bonus', manaCost: 55, cooldown: 4, radius: 4, heal: [10, 16], attribute: 'magiaSuplementar',
    minLevel: 16, after: 'semente_de_mistilteinn',
    // Rank II: cura mais. Rank III: cura ainda mais e recarrega mais rápido.
    ranks: [
      { minLevel: 26, heal: [15, 22] },
      { minLevel: 40, heal: [20, 30], cooldown: 3 },
    ],
    use(battle, user) {
      const affected = battle.players.filter(p => p.hp > 0 && (p === user
        || (p.team === user.team && p.pos && user.pos && distance(p.pos, user.pos) <= this.radius)));
      let text = `🌳 ${user.name} usou **Florescer da Yggdrasil**: os galhos curam ${affected.length > 1 ? 'o time' : 'quem os invocou'}.`;
      for (const p of affected) {
        const healed = Math.max(0, Math.min(p.maxHp - p.hp, rollPower(user, this, this.heal)));
        p.hp += healed;
        text += `${NL}${p.name}: ❤️ +${healed} de vida.`;
      }
      return text;
    },
  },
  // Raízes gigantes descem das nuvens e atacam todos os inimigos ao redor
  descida_da_arvore_magica: {
    id: 'descida_da_arvore_magica', name: 'Descida da Árvore Mágica', description: 'Emite um brilho esverdeado enquanto o céu se fecha em nuvens negras e ventanias; das nuvens descem as raízes de uma árvore gigante, que atacam os alvos e depois recuam. Atinge todos os inimigos ao seu redor.', actionText: 'Descida da Árvore Mágica', gif: 'arvore_descida_da_arvore_magica.gif', grimoire: 'arvore_do_mundo', magic: true, element: 'planta',
    type: 'bonus', usesAttack: true, manaCost: 48, cooldown: 4, area: { radius: 4 }, damage: [12, 17], attribute: 'magiaOfensiva',
    minLevel: 20, after: 'semente_de_mistilteinn',
    // Rank II: raízes mais fortes
    ranks: [
      { minLevel: 34, damage: [16, 22] },
    ],
    use(battle, user) {
      const lines = [`🌩️ O céu se fechou em nuvens negras e as raízes da **Árvore Mágica** desceram sobre os inimigos de ${user.name}.`];
      for (const foe of foesInArea(battle, user, this.area.radius)) {
        lines.push(`🌿 As raízes atingiram ${foe.name} (**${hitWithMagic(this, user, foe)}** de dano).`, ...fx.onHit(foe, this.element));
      }
      lines.push(...hitSummonsInArea(this, battle, user, this.area.radius));
      return lines.join(NL);
    },
  },
  // Raízes grandes envolvem um alvo colado e o apertam e torcem: dano alto e prende
  formacao_dracaena: {
    id: 'formacao_dracaena', name: 'Formação Dracaena', description: 'Toca a mão no chão e invoca várias raízes grandes que envolvem o alvo, apertando e torcendo até ele quebrar. Curto alcance: dano alto e o alvo fica enraizado.', actionText: 'Formação Dracaena', gif: 'arvore_formacao_dracaena.gif', grimoire: 'arvore_do_mundo', magic: true, element: 'planta',
    type: 'attack', range: 2, damage: [17, 24], attribute: 'magiaOfensiva', manaCost: 44, cooldown: 3,
    applies: [{ effect: 'preso', turns: 1 }],
    minLevel: 22, after: 'semente_de_mistilteinn',
    // Rank II: aperta mais forte e prende por mais tempo
    ranks: [
      { minLevel: 36, damage: [22, 30], applies: [{ effect: 'preso', turns: 2 }] },
    ],
  },
  // Raízes numa área ampla absorvem a mana de todos os inimigos dentro dela; com essa mana nasce a Grande Árvore, que os prende
  grande_arvore_mistilteinn: {
    id: 'grande_arvore_mistilteinn', name: 'Grande Árvore Mistilteinn', description: 'Espalha raízes por uma área ampla que absorvem a mana de todos dentro dela; com essa mana, cria uma árvore enorme, capaz de engolir uma cidade, que captura os inimigos. Longo alcance: rouba mana e enraíza todos os inimigos ao seu redor.', actionText: 'Grande Árvore Mistilteinn', gif: 'arvore_grande_arvore_mistilteinn.gif', grimoire: 'arvore_do_mundo', magic: true,
    type: 'bonus', usesAttack: true, manaCost: 50, cooldown: 5, area: { radius: 5 }, drainArea: 20,
    applies: [{ effect: 'preso', turns: 2, to: 'enemy' }],
    minLevel: 30, after: 'formacao_dracaena',
    // Rank II: as raízes sugam mais e prendem por mais tempo
    ranks: [
      { minLevel: 42, drainArea: 30, applies: [{ effect: 'preso', turns: 3, to: 'enemy' }] },
    ],
    // A drenagem acontece aqui; o Preso de cada inimigo da área vem do `applies`
    use(battle, user) {
      const lines = [`🌳 As raízes de ${user.name} tomaram o campo e absorveram a mana ao redor: nasceu a **Grande Árvore Mistilteinn**.`];
      let total = 0;
      for (const foe of foesInArea(battle, user, this.area.radius)) {
        const lost = Math.min(foe.mana, this.drainArea);
        foe.mana -= lost;
        total += lost;
        lines.push(`🔷 ${foe.name} perdeu **${lost}** de mana para as raízes.`);
      }
      const gained = Math.min(user.maxMana - user.mana, total);
      user.mana += gained;
      if (gained) lines.push(`💚 ${user.name} absorveu **${gained}** de mana.`);
      return lines.join(NL);
    },
  },

  // ---- Grimório dos Sonhos (LENDÁRIO) ----
  // Controle pelo sono: o Mundo do Glamour puxa os inimigos para um sonho, onde ficam Sonolentos e Vulneráveis às magias
  // dos Sonhos (Sonolento x3 = dormindo, sem agir). As outras magias só funcionam com o Mundo ativo e acontecem DENTRO do sonho:
  // `keepsAsleep` faz elas não acordarem quem está dormindo, e o elemento `sonho` causa +25% em quem está Vulnerável a ele.
  // Qualquer outro golpe acorda o alvo. Escala de atributo da raridade (1,7x). Todas têm ranks: a árvore tem só 4 magias.
  // Árvore: Mundo do Glamour -> { Materialização dos Sonhos -> Manipulação do Mundo dos Sonhos }, { Névoa do Sono -> Fitas do Sono Profundo },
  //         { Materialização de Defesa -> Anéis da Vigília }.
  // Névoa escura em área: puxa os inimigos próximos para o mundo dos sonhos e deixa o Mundo do Glamour ativo em quem usou
  mundo_do_glamour: {
    id: 'mundo_do_glamour', name: 'Mundo do Glamour', description: 'Libera uma névoa escura que puxa os inimigos próximos para um mundo de sonhos, onde ficam Sonolentos e Vulneráveis às magias dos Sonhos. Enquanto o Mundo do Glamour estiver ativo, as outras magias dos Sonhos ficam liberadas.', actionText: 'Mundo do Glamour', gif: 'sonhos_mundo_do_glamour.gif', grimoire: 'sonhos', magic: true,
    type: 'bonus', usesAttack: true, manaCost: 45, cooldown: 5, area: { radius: 4 },
    applies: [{ effect: 'vulneravel', turns: 4, elements: { sonho: 1.25 }, to: 'enemy' }, { effect: 'sonolento', turns: 2, to: 'enemy' }],
    active: { emoji: '🌙', turns: 4 },
    minLevel: 8, // raiz da árvore dos Sonhos
    // Rank II: a névoa puxa de mais longe. Rank III: o sonho dura mais (o inimigo fica vulnerável e o Mundo fica ativo por mais tempo).
    ranks: [
      { minLevel: 20, area: { radius: 5 } },
      { minLevel: 34, applies: [{ effect: 'vulneravel', turns: 5, elements: { sonho: 1.25 }, to: 'enemy' }, { effect: 'sonolento', turns: 2, to: 'enemy' }], active: { emoji: '🌙', turns: 5 } },
    ],
  },
  // A imaginação ganha forma dentro do sonho e ataca o alvo (não o acorda)
  materializacao_dos_sonhos: {
    id: 'materializacao_dos_sonhos', name: 'Materialização dos Sonhos', description: 'Dentro do Mundo do Glamour, a imaginação ganha forma física em objetos, estruturas e criaturas que atacam o alvo. Só funciona com o Mundo do Glamour aberto e não acorda quem está dormindo.', actionText: 'Materialização dos Sonhos', gif: 'sonhos_materializacao_dos_sonhos.gif', grimoire: 'sonhos', magic: true, element: 'sonho',
    type: 'attack', range: 4, damage: [10, 15], attribute: 'magiaOfensiva', manaCost: 34, dodgePenalty: 0.15, keepsAsleep: true,
    requiresActive: 'mundo_do_glamour',
    minLevel: 12, after: 'mundo_do_glamour',
    // Rank II: mais dano. Rank III: as criaturas também atacam quem está colado no alvo.
    ranks: [
      { minLevel: 24, damage: [14, 20] },
      { minLevel: 36, damage: [18, 26], splash: { radius: 1, share: 0.4 } },
    ],
  },
  // Dano baixo e muito sono: com o Mundo do Glamour, o alvo adormece rápido
  nevoa_do_sono: {
    id: 'nevoa_do_sono', name: 'Névoa do Sono', description: 'Manipula o mundo dos sonhos para encher o alvo de uma sonolência crescente. Causa pouco dano, mas deixa o alvo muito Sonolento, e com 3 acúmulos ele adormece.', actionText: 'Névoa do Sono', gif: 'sonhos_nevoa_do_sono.gif', grimoire: 'sonhos', magic: true, element: 'sonho',
    type: 'attack', range: 4, damage: [5, 8], attribute: 'magiaOfensiva', attributeScale: 0.85, manaCost: 36, cooldown: 2, keepsAsleep: true, // metade da escala lendária: o forte dela é o sono, não o dano
    applies: [{ effect: 'sonolento', turns: 2, stacks: 2 }],
    requiresActive: 'mundo_do_glamour',
    minLevel: 16, after: 'mundo_do_glamour',
    // Rank II: o alvo adormece num golpe só (3 acúmulos), mas a recarga sobe
    ranks: [
      { minLevel: 32, applies: [{ effect: 'sonolento', turns: 2, stacks: 3 }], cooldown: 3 },
    ],
  },
  // O cenário muda à vontade de quem usa: você se move pelo sonho (use `direcao` e `casas`) e montanhas e construções te protegem
  manipulacao_do_mundo_dos_sonhos: {
    id: 'manipulacao_do_mundo_dos_sonhos', name: 'Manipulação do Mundo dos Sonhos', description: 'Com um gesto, o cenário do sonho muda por completo: montanhas e construções surgem e desaparecem. Leva você até outro ponto do mapa e ergue o Cenário Onírico, que reduz o dano recebido.', actionText: 'Manipulação do Mundo dos Sonhos', gif: 'sonhos_manipulacao_do_mundo_dos_sonhos.gif', grimoire: 'sonhos', magic: true,
    type: 'bonus', manaCost: 40, cooldown: 4, teleport: 'self', destRange: 6,
    active: { id: 'cenario_onirico', name: 'Cenário Onírico', emoji: '🏔️', turns: 2, mods: { damageResist: 0.25 } },
    teleportText: me => `🏔️ O cenário do sonho se moveu e levou ${me.name} para outro ponto do mapa.`,
    requiresActive: 'mundo_do_glamour',
    minLevel: 22, after: 'materializacao_dos_sonhos',
    // Rank II: leva mais longe e o Cenário Onírico protege por mais um turno
    ranks: [
      { minLevel: 34, destRange: 8, active: { id: 'cenario_onirico', name: 'Cenário Onírico', emoji: '🏔️', turns: 3, mods: { damageResist: 0.25 } } },
    ],
  },
  // Fitas roxas prendem o alvo no sonho: imobilizado, com sono, e enquanto as fitas o prendem nenhum golpe o acorda
  fitas_do_sono_profundo: {
    id: 'fitas_do_sono_profundo', name: 'Fitas do Sono Profundo', description: 'Fitas roxas surgem e prendem o alvo no mundo dos sonhos, onde quem controla tudo é você: quanto mais ele luta, mais elas apertam e mais sono ele sente. O alvo fica Imobilizado e Sonolento e, enquanto as fitas o prendem, nenhum golpe o acorda.', actionText: 'Fitas do Sono Profundo', gif: 'sonhos_fitas_do_sono_profundo.gif', grimoire: 'sonhos', magic: true, element: 'sonho',
    type: 'attack', range: 3, damage: [8, 12], attribute: 'magiaOfensiva', manaCost: 42, cooldown: 3, keepsAsleep: true,
    applies: [{ effect: 'imobilizado', turns: 2, holdsSleep: true }, { effect: 'sonolento', turns: 2, stacks: 2 }],
    requiresActive: 'mundo_do_glamour',
    minLevel: 26, after: 'nevoa_do_sono',
    // Rank II: mais dano e as fitas seguram por mais um turno
    ranks: [
      { minLevel: 38, damage: [11, 16], applies: [{ effect: 'imobilizado', turns: 3, holdsSleep: true }, { effect: 'sonolento', turns: 3, stacks: 2 }] },
    ],
  },
  // Materializa objetos ou magias sob medida para segurar o golpe: absorve mais contra magia
  materializacao_de_defesa: {
    id: 'materializacao_de_defesa', name: 'Materialização de Defesa', description: 'Materializa qualquer objeto, ou até outras magias, para se proteger de ataques de diferentes tipos de magia. Reação de defesa que absorve dano, e absorve ainda mais contra magias. Só funciona com o Mundo do Glamour aberto.', actionText: 'Materialização de Defesa', gif: 'sonhos_materializacao_de_defesa.gif', grimoire: 'sonhos', magic: true,
    type: 'reaction', kind: 'block', absorb: [5, 8], attribute: 'magiaDefensiva', magicBonus: 1.4, manaCost: 28, emoji: '🧸',
    requiresActive: 'mundo_do_glamour',
    minLevel: 14, after: 'mundo_do_glamour',
    // Rank II: segura mais
    ranks: [
      { minLevel: 30, absorb: [7, 11] },
    ],
  },
  // Esfera rosa com anéis de letras de sonho: por alguns turnos segura os ataques que vêm de fora
  aneis_da_vigilia: {
    id: 'aneis_da_vigilia', name: 'Anéis da Vigília', description: 'Materializa ao redor de si uma esfera de luz rosa cercada por anéis com letras de sonho que giram sem parar, e tudo o que você imagina como proteção ganha forma. Ação bônus que reduz bastante o dano recebido por alguns turnos. Só funciona com o Mundo do Glamour aberto.', actionText: 'Anéis da Vigília', gif: 'sonhos_aneis_da_vigilia.gif', grimoire: 'sonhos', magic: true,
    type: 'bonus', manaCost: 45, cooldown: 5, active: { emoji: '💗', turns: 2, mods: { damageResist: 0.35 } },
    requiresActive: 'mundo_do_glamour',
    minLevel: 28, after: 'materializacao_de_defesa',
    // Rank II: a esfera dura mais um turno
    ranks: [
      { minLevel: 40, active: { emoji: '💗', turns: 3, mods: { damageResist: 0.35 } } },
    ],
  },

  // ---- Grimório da Fera (ÉPICO) ----
  // Lutador: auras de animais que deixam o corpo mais forte e rápido. Escala de atributo da raridade (1,4x).
  // Os golpes e a investida acendem o Instinto Selvagem em quem usa (+dano e +1 casa de movimento; mais dano com pouca vida).
  // Todas têm ranks: a árvore tem só 4 magias.
  // Árvore: Garra de Urso -> { Investida de Guepardo -> Beast Magic: Whale }, { Armadura de Rinoceronte }.
  // Garras de aura no braço: corpo a corpo; nos ranks a aura se estende e lança cortes no ar (mais alcance)
  garra_de_urso: {
    id: 'garra_de_urso', name: 'Garra de Urso', description: 'Envolve os braços numa aura alaranjada em forma de garras de urso, aumentando muito a força dos golpes. Ataque corpo a corpo que acende o Instinto Selvagem em você; nos ranks, a aura se estende e lança cortes no ar.', actionText: 'Garra de Urso', gif: 'fera_garra_de_urso.gif', grimoire: 'fera', magic: true,
    type: 'attack', range: 1, damage: [9, 13], attribute: 'magiaOfensiva', manaCost: 20,
    active: instintoSelvagem(2),
    minLevel: 6, // raiz da árvore da Fera
    // Rank II: mais dano e a aura alcança 2 casas. Rank III: cortes no ar até 3 casas e o Instinto dura mais.
    ranks: [
      { minLevel: 16, damage: [12, 17], range: 2 },
      { minLevel: 28, damage: [15, 21], range: 3, active: instintoSelvagem(3) },
    ],
  },
  // Investida rápida: leva você N casas numa direção (use `direcao` e `casas`) e acende o Instinto Selvagem
  investida_de_guepardo: {
    id: 'investida_de_guepardo', name: 'Investida de Guepardo', description: 'Uma aura de guepardo aumenta sua velocidade e permite investidas extremamente rápidas. Leva você até outro ponto do mapa e acende o Instinto Selvagem.', actionText: 'Investida de Guepardo', gif: 'fera_investida_de_guepardo.gif', grimoire: 'fera', magic: true,
    type: 'bonus', manaCost: 25, cooldown: 3, teleport: 'self', destRange: 4,
    active: instintoSelvagem(2),
    teleportText: me => `🐆 ${me.name} disparou numa investida de guepardo até outro ponto do mapa.`,
    minLevel: 10, after: 'garra_de_urso',
    // Rank II: investida mais longa e mais frequente
    ranks: [
      { minLevel: 22, destRange: 6, cooldown: 2 },
    ],
  },
  // Aura de rinoceronte: bloqueio mágico que segura impactos fortes
  armadura_de_rinoceronte: {
    id: 'armadura_de_rinoceronte', name: 'Armadura de Rinoceronte', description: 'Gera uma aura em forma de rinoceronte ao redor do corpo, capaz de impedir impactos poderosos. Reação que absorve boa parte do golpe recebido.', actionText: 'Armadura de Rinoceronte', gif: 'fera_armadura_de_rinoceronte.gif', grimoire: 'fera',
    type: 'reaction', kind: 'block', absorb: [4, 7], attribute: 'magiaDefensiva', manaCost: 26, emoji: '🦏',
    minLevel: 12, after: 'garra_de_urso',
    // Rank II e III: a aura fica mais resistente
    ranks: [
      { minLevel: 24, absorb: [7, 11] },
      { minLevel: 36, absorb: [10, 15], manaCost: 30 },
    ],
  },
  // Baleia de mana: o golpe mais forte da Fera; o tamanho esmaga também quem está perto do alvo
  beast_magic_whale: {
    id: 'beast_magic_whale', name: 'Beast Magic: Whale', description: 'Uma enorme baleia feita de mana avança contra os adversários e os esmaga com seu tamanho e força. O golpe mais forte da Fera: atinge também quem está perto do alvo e acende o Instinto Selvagem.', actionText: 'Beast Magic: Whale', gif: 'fera_beast_magic_whale.gif', grimoire: 'fera', magic: true,
    type: 'attack', range: 4, damage: [16, 23], attribute: 'magiaOfensiva', manaCost: 48, cooldown: 3,
    splash: { radius: 1, share: 0.5 }, active: instintoSelvagem(2),
    minLevel: 20, after: 'investida_de_guepardo',
    // Rank II: baleia maior: mais dano e esmaga numa área maior
    ranks: [
      { minLevel: 34, damage: [21, 29], splash: { radius: 2, share: 0.6 } },
    ],
  },

  // ---- Grimório da Cópia (ÉPICO) ----
  // Uma magia só, que vira as magias do inimigo: tocando o grimório dele, quem usa ESCOLHE (opção `copiar` do /habilidade)
  // uma magia de grimório que o inimigo aprendeu e pode lançá-la (ataque, bônus ou reação) enquanto durar o efeito
  // Magia Copiada, com os próprios atributos.
  // Limites: só de inimigos e com alcance de toque; só copia magias cujo nível mínimo você já tem; a escala de atributo da
  // cópia nunca passa a de um épico (ver battle.abilityOf); não copia magias que dependem de outro efeito (ex: Impulso da Morte).
  // Cada uso copia UMA magia: os ranks aumentam quantas cópias você guarda ao mesmo tempo (`slots`; a mais antiga sai
  // quando enche), por quantos turnos e, no III, a cópia vem no rank do inimigo (até o rank que o seu nível permite).
  // Os ranks são caros (`cost`), porque a árvore tem uma magia só.
  magia_de_copia: {
    id: 'magia_de_copia', name: 'Magia de Cópia', description: 'Ao tocar o grimório de outro mago, copia o atributo mágico dele e reproduz seus feitiços. Você escolhe uma magia que o inimigo aprendeu (de ataque, defesa ou suporte) e pode usá-la por alguns turnos, com os seus atributos, desde que já tenha o nível dela.', actionText: 'Magia de Cópia', gif: 'copia_magia_de_copia.gif', grimoire: 'copia', magic: true,
    type: 'bonus', manaCost: 30, cooldown: 5, targetRange: 1,
    copy: { slots: 1, turns: 3, keepRank: false },
    minLevel: 6, cost: 2, // raiz (e única magia) da árvore da Cópia
    // Rank II: alcança 2 casas, guarda 2 cópias por 4 turnos. Rank III: guarda 3 cópias por 5 turnos, no rank do inimigo.
    ranks: [
      { minLevel: 20, cost: 4, targetRange: 2, copy: { slots: 2, turns: 4, keepRank: false } },
      { minLevel: 36, cost: 6, copy: { slots: 3, turns: 5, keepRank: true } },
    ],
    // Magias do inimigo que entram na lista: de grimório, aprendidas por ele, que não dependem de outra magia ativa e que você não tem
    copyable(user, foe) {
      return foe.abilities.map(id => abilities[id])
        .filter(a => a?.grimoire && !a.requiresActive && !a.copy && !user.abilities.includes(a.id));
    },
    // Por que não dá para copiar essa magia (texto) ou null
    copyBlocker(user, a) {
      return (a.minLevel ?? 1) > user.level ? `você precisa do nível ${a.minLevel} para copiar **${a.name}** (está no ${user.level})` : null;
    },
    // Rank da cópia: 1, ou (no rank III da Cópia) o rank do inimigo, até o maior rank cujo nível você já tem
    copyRank(user, foe, a) {
      if (!this.copy.keepRank) return 1;
      let rank = 1;
      for (let r = 2; r <= (foe.ranks?.[a.id] ?? 1); r++) if ((a.ranks?.[r - 2]?.minLevel ?? 1) <= user.level) rank = r;
      return rank;
    },
    // A magia escolhida (opção `copiar`); sem escolha, só vale se houver exatamente uma possível
    pick(user, foe, copyId) {
      const list = this.copyable(user, foe);
      if (!list.length) return { error: `${foe.name} não tem nenhuma magia de grimório que dê para copiar.` };
      if (!copyId) {
        const allowed = list.filter(a => !this.copyBlocker(user, a));
        if (allowed.length === 1) return { ability: allowed[0] };
        if (!allowed.length) return { error: `Você ainda não tem nível para copiar nenhuma magia de ${foe.name}.` };
        return { error: `Escolha qual magia copiar na opção \`copiar\`. De ${foe.name} dá para copiar: ${allowed.map(a => `**${a.name}**`).join(', ')}.` };
      }
      const ability = list.find(a => a.id === copyId);
      if (!ability) return { error: `${foe.name} não tem essa magia para copiar.` };
      const blocker = this.copyBlocker(user, ability);
      return blocker ? { error: `Não dá: ${blocker}.` } : { ability };
    },
    canUse(battle, user, foe, { copyId } = {}) {
      return this.pick(user, foe, copyId).error ?? null;
    },
    use(battle, user, foe, { copyId } = {}) {
      const { ability: a } = this.pick(user, foe, copyId);
      if (!fx.hasActive(user, 'magia_copiada')) user.copied = {}; // as cópias antigas já tinham se desfeito
      const copies = user.copied ??= {};
      delete copies[a.id];
      copies[a.id] = { rank: this.copyRank(user, foe, a) };
      let dropped = '';
      while (Object.keys(copies).length > this.copy.slots) {
        const oldest = Object.keys(copies)[0];
        delete copies[oldest];
        dropped = ` A cópia de **${abilities[oldest].name}** se desfez para dar lugar.`;
      }
      fx.setActive(user, { id: 'magia_copiada', name: 'Magia Copiada', emoji: '📋', turns: this.copy.turns });
      const rank = copies[a.id].rank;
      return `📋 ${user.name} tocou o grimório de ${foe.name} e copiou **${a.name}**${rank > 1 ? ` (rank ${rank})` : ''} por ${this.copy.turns} turno(s).${dropped} Use pelo /habilidade.`;
    },
  },

  // ---- Grimório do Corte (ÉPICO) ----
  // Lâminas de mana nos antebraços: cortes que fazem sangrar (Sangramento acumula e ignora defesas) e uma defesa que parte
  // até golpes que ignoram Bloqueio (`cutsThrough`). Escala de atributo da raridade (1,4x). Todas têm ranks: são só 4 magias.
  // Árvore: Foice da Morte -> { Corte da Insanidade -> Foice Giratória da Morte }, { Foice Defensiva }.
  // Corte poderoso disparado da lâmina do antebraço: média distância e faz sangrar
  foice_da_morte: {
    id: 'foice_da_morte', name: 'Foice da Morte', description: 'Com a lâmina de mana no antebraço, dispara um corte poderoso, forte o bastante para partir rocha. Atinge de média distância e faz o alvo sangrar.', actionText: 'Foice da Morte', gif: 'corte_foice_da_morte.gif', grimoire: 'corte', magic: true,
    type: 'attack', range: 3, damage: [10, 15], attribute: 'magiaOfensiva', manaCost: 24,
    applies: [{ effect: 'sangramento', turns: 2, stacks: 1, power: 2 }],
    minLevel: 6, // raiz da árvore do Corte
    // Rank II: mais dano. Rank III: mais dano e o corte abre um sangramento mais fundo.
    ranks: [
      { minLevel: 16, damage: [13, 18] },
      { minLevel: 28, damage: [16, 22], applies: [{ effect: 'sangramento', turns: 3, stacks: 2, power: 2 }] },
    ],
  },
  // Enxurrada caótica de cortes voadores: difícil de esquivar, pega quem está colado no alvo e faz sangrar muito
  corte_da_insanidade: {
    id: 'corte_da_insanidade', name: 'Foice da Morte: Corte da Insanidade', description: 'As lâminas dos antebraços soltam uma enxurrada caótica de cortes voadores. Difícil de esquivar, também atinge quem está colado no alvo e abre vários sangramentos.', actionText: 'Foice da Morte: Corte da Insanidade', gif: 'corte_corte_da_insanidade.gif', grimoire: 'corte', magic: true,
    type: 'attack', range: 3, damage: [8, 12], attribute: 'magiaOfensiva', manaCost: 36, cooldown: 2, dodgePenalty: 0.3,
    splash: { radius: 1, share: 0.5 }, applies: [{ effect: 'sangramento', turns: 3, stacks: 2, power: 2 }],
    minLevel: 14, after: 'foice_da_morte',
    // Rank II: mais dano e mais sangramento
    ranks: [
      { minLevel: 30, damage: [11, 16], applies: [{ effect: 'sangramento', turns: 3, stacks: 3, power: 2 }] },
    ],
  },
  // Cortes precisos contra o golpe que chega: bloqueia e parte até golpes que ignoram Bloqueio (magia espacial, Corte Dimensional...)
  foice_defensiva: {
    id: 'foice_defensiva', name: 'Foice Defensiva', description: 'Cortes precisos contra o ataque que se aproxima, tentando parti-lo antes que atinja o corpo. Reação que absorve parte do golpe e funciona até contra ataques que atravessam o Bloqueio, como magias espaciais.', actionText: 'Foice Defensiva', gif: 'corte_foice_defensiva.gif', grimoire: 'corte',
    type: 'reaction', kind: 'block', absorb: [4, 7], attribute: 'magiaDefensiva', manaCost: 24, cutsThrough: true, emoji: '🗡️',
    minLevel: 10, after: 'foice_da_morte',
    // Rank II e III: cortes mais precisos, absorvem mais
    ranks: [
      { minLevel: 22, absorb: [7, 11] },
      { minLevel: 34, absorb: [10, 15], manaCost: 28 },
    ],
  },
  // Disco de foice girando: alcance longo e atravessa defesas (ignora Bloqueio)
  foice_giratoria_da_morte: {
    id: 'foice_giratoria_da_morte', name: 'Foice Giratória da Morte', description: 'Uma enorme lâmina circular em forma de foice gira em alta velocidade e avança como um disco cortante. Alcance longo, atravessa o Bloqueio e faz o alvo sangrar.', actionText: 'Foice Giratória da Morte', gif: 'corte_foice_giratoria_da_morte.gif', grimoire: 'corte', magic: true,
    type: 'attack', range: 5, damage: [15, 22], attribute: 'magiaOfensiva', manaCost: 46, cooldown: 3, ignoreBlock: true, dodgePenalty: 0.15,
    applies: [{ effect: 'sangramento', turns: 2, stacks: 1, power: 3 }],
    minLevel: 20, after: 'corte_da_insanidade',
    // Rank II: disco maior, mais dano e sangramento mais forte
    ranks: [
      { minLevel: 34, damage: [20, 28], applies: [{ effect: 'sangramento', turns: 3, stacks: 2, power: 3 }] },
    ],
  },

  // ---- Grimório do Sangue (ÉPICO) ----
  // Sangue moldado em armas e criaturas. Os golpes de sangue fazem o alvo sangrar, e a Marionete só controla
  // quem está com Sangramento. A Foice rouba vida (`lifesteal`), a Besta protege quem a usa (muita água a dissolve), o Rebanho
  // invoca feras soltas e o Casulo cura o aliado mais ferido. Escala de atributo da raridade (1,4x).
  // Árvore: Foice -> { Andaime -> Marionete }, { Besta Vermelha -> Rebanho }, { Casulo de Sangue }.
  // Foice gigante de sangue: corpo a corpo, forte, rouba vida e faz o alvo sangrar
  foice_de_sangue_vital: {
    id: 'foice_de_sangue_vital', name: 'Foice de Sangue Vital', description: 'Molda uma grande quantidade de sangue numa foice gigante empunhada com a mão. Golpe corpo a corpo forte que drena parte do dano em vida e faz o alvo sangrar.', actionText: 'Foice de Sangue Vital', gif: 'sangue_foice_de_sangue_vital.gif', grimoire: 'sangue', magic: true,
    type: 'attack', range: 1, damage: [11, 16], attribute: 'magiaOfensiva', manaCost: 22, lifesteal: 0.25,
    applies: [{ effect: 'sangramento', turns: 2, stacks: 1, power: 1 }],
    minLevel: 6, // raiz da árvore do Sangue
    // Rank II: mais dano. Rank III: mais dano e drena mais vida.
    ranks: [
      { minLevel: 16, damage: [14, 20] },
      { minLevel: 28, damage: [18, 25], lifesteal: 0.35 },
    ],
  },
  // Sangue cobre o chão e crucifixos prendem os inimigos ao redor (sem dano): imóveis, sem esquiva e sangrando
  andaime_de_sangue_fresco: {
    id: 'andaime_de_sangue_fresco', name: 'Andaime de Sangue Fresco', description: 'Libera uma grande quantidade de sangue que cobre o chão, e crucifixos surgem prendendo pelos pulsos e pelo estômago quem estiver por perto. Os inimigos ao redor ficam Imobilizados (sem se mover nem esquivar) e sangrando.', actionText: 'Andaime de Sangue Fresco', gif: 'sangue_andaime_de_sangue_fresco.gif', grimoire: 'sangue', magic: true,
    type: 'bonus', usesAttack: true, manaCost: 45, cooldown: 5, area: { radius: 3 },
    applies: [{ effect: 'imobilizado', turns: 2, to: 'enemy' }, { effect: 'sangramento', turns: 3, stacks: 1, power: 1, to: 'enemy' }],
    minLevel: 14, after: 'foice_de_sangue_vital',
    // Rank II: o sangue se espalha mais e os crucifixos prendem por mais tempo
    ranks: [
      { minLevel: 26, area: { radius: 4 }, applies: [{ effect: 'imobilizado', turns: 3, to: 'enemy' }, { effect: 'sangramento', turns: 4, stacks: 1, power: 1, to: 'enemy' }] },
    ],
  },
  // Controla quem está sangrando pelo próprio sangue: leva o alvo para onde quiser (use `direcao` e `casas`),
  // ele fica Paralisado e sangra forte
  fluxo_sanguineo_da_marionete: {
    id: 'fluxo_sanguineo_da_marionete', name: 'Fluxo Sanguíneo da Marionete', description: 'Controla pelo sangue alguém que já foi atingido pela sua magia: o alvo sente dor intensa e seus olhos ficam brancos. Só funciona em quem está com Sangramento: você o move pelo mapa, e ele fica Paralisado (sem se mover nem reagir) e sangra forte.', actionText: 'Fluxo Sanguíneo da Marionete', gif: 'sangue_fluxo_sanguineo_da_marionete.gif', grimoire: 'sangue', magic: true,
    type: 'bonus', usesAttack: true, manaCost: 40, cooldown: 4, targetRange: 5, teleport: 'enemy', destRange: 3,
    requiresTargetEffect: 'sangramento',
    applies: [{ effect: 'paralisado', turns: 2, to: 'enemy' }, { effect: 'sangramento', turns: 2, stacks: 1, power: 3, to: 'enemy' }],
    teleportText: (me, foe) => `🪢 ${me.name} controlou o sangue de ${foe.name} e o arrastou como uma marionete.`,
    minLevel: 18, after: 'andaime_de_sangue_fresco',
    canUse(battle, user, foe) {
      return fx.hasEffect(foe, 'sangramento') ? null : `${foe.name} não está sangrando: faça-o sangrar antes (por exemplo, com uma magia de sangue).`;
    },
  },
  // Criatura de sangue presa ao usuário: golpe de perto que rasga defesas, e o sangue denso protege quem a usa
  besta_vermelha: {
    id: 'besta_vermelha', name: 'Besta Vermelha', description: 'Molda o sangue numa grande criatura sem olhos, presa a você por fios de sangue. Suas garras dilaceram defesas (ignora o Bloqueio) e fazem o alvo sangrar, e o sangue denso protege você, que recebe menos dano por alguns turnos; muita água a dissolve.', actionText: 'Besta Vermelha', gif: 'sangue_besta_vermelha.gif', grimoire: 'sangue', magic: true,
    type: 'attack', range: 2, damage: [16, 23], attribute: 'magiaOfensiva', manaCost: 50, cooldown: 3, ignoreBlock: true,
    applies: [{ effect: 'sangramento', turns: 3, stacks: 1, power: 1 }], active: { emoji: '👹', turns: 2, mods: { damageResist: 0.3 }, endsOnElement: 'agua' },
    minLevel: 22, after: 'foice_de_sangue_vital',
    // Rank II: garras mais fortes e a besta protege por mais tempo
    ranks: [
      { minLevel: 34, damage: [21, 29], active: { emoji: '👹', turns: 3, mods: { damageResist: 0.3 }, endsOnElement: 'agua' } },
    ],
  },
  // Várias feras de sangue menores e soltas: aparecem no mapa e atacam sozinhas no fim do seu turno
  rebanho_de_feras_vermelhas: {
    id: 'rebanho_de_feras_vermelhas', name: 'Rebanho de Feras Vermelhas', description: 'Molda o sangue em várias Bestas Vermelhas menores, de corpo inteiro e soltas de você. Elas aparecem no mapa e atacam os inimigos sozinhas até serem destruídas.', actionText: 'Rebanho de Feras Vermelhas', gif: 'sangue_rebanho_de_feras_vermelhas.gif', grimoire: 'sangue', magic: true,
    type: 'bonus', manaCost: 60, cooldown: 5, attribute: 'magiaOfensiva',
    summon: {
      count: 3, hp: 18, damage: [3, 5], share: 0.25, label: 'Fera Vermelha', icon: 'fera_vermelha.png',
      text: (owner, n, hp) => `👹 ${owner.name} moldou ${n} Fera(s) Vermelha(s) de sangue, com ${hp} de vida cada. Elas atacam sozinhas até serem destruídas.`,
    },
    minLevel: 30, after: 'besta_vermelha',
  },
  // Veias de sangue envolvem o aliado mais ferido por perto (ou você): curam, quebram as maldições (debuffs) e o fortalecem
  casulo_de_sangue: {
    id: 'casulo_de_sangue', name: 'Casulo de Sangue Quebra-Maldição', description: 'Veias de sangue saem do seu dedo e envolvem o alvo num orbe escuro que cura seus ferimentos. Cura o aliado mais ferido por perto (ou você), remove os efeitos negativos dele e o fortalece com a Transfusão.', actionText: 'Casulo de Sangue Quebra-Maldição', gif: 'sangue_casulo_de_sangue.gif', grimoire: 'sangue', magic: true,
    type: 'bonus', manaCost: 45, cooldown: 4, radius: 2, heal: [12, 18], attribute: 'magiaSuplementar',
    minLevel: 16, after: 'foice_de_sangue_vital',
    // Rank II: cura mais e recarrega mais rápido
    ranks: [
      { minLevel: 28, heal: [18, 26], cooldown: 3 },
    ],
    use(battle, user) {
      const near = battle.players.filter(p => p.hp > 0 && (p === user
        || (p.team === user.team && p.pos && user.pos && distance(p.pos, user.pos) <= this.radius)));
      const target = near.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0]; // o mais ferido
      const healed = Math.max(0, Math.min(target.maxHp - target.hp, rollPower(user, this, this.heal)));
      target.hp += healed;
      const cleared = fx.clearDebuffs(target);
      const lines = [`🩸 ${user.name} envolveu ${target === user ? 'a si mesmo' : target.name} num **Casulo de Sangue**: ❤️ +${healed} de vida.`];
      if (cleared.length) lines.push(`✨ A maldição se quebrou: removeu ${cleared.join(', ')}.`);
      lines.push(fx.setActive(target, { id: 'transfusao', name: 'Transfusão', emoji: '💉', turns: 2, mods: { damageBonus: 4 } }));
      return lines.join(NL);
    },
  },

  // ---- Grimório da Pintura (ÉPICO) ----
  // Pincel e paleta: cada pincelada vira uma figura com um papel diferente (queimar, devolver magia, prender, explodir em
  // área, efeitos elementais ao acaso, soco que atordoa). Escala de atributo da raridade (1,4x).
  // Árvore: Deux Tempêtes -> { Vouivre -> Lindworm }, { Primavera da Restrição -> Gigante Souterrain }, { Brincadeira de Deus }.
  // Dois tornados, de fogo e de água: queima o alvo; a água dilui a Besta Vermelha (elemento `agua`)
  deux_tempetes: {
    id: 'deux_tempetes', name: 'Deux Tempêtes de Fogo e Gelo', description: 'Com uma pincelada, cria dois tornados, um de fogo e outro de água, feitos para combater feitiços de gelo e de fogo. Atinge de média distância e deixa o alvo com Queimadura; a água dissolve criaturas de sangue.', actionText: 'Deux Tempêtes de Fogo e Gelo', gif: 'pintura_deux_tempetes.gif', grimoire: 'pintura', magic: true, element: 'agua',
    type: 'attack', range: 3, damage: [10, 15], attribute: 'magiaOfensiva', manaCost: 24,
    applies: [{ effect: 'queimadura', turns: 2, power: 2 }],
    minLevel: 6, // raiz da árvore da Pintura
    // Rank II: mais dano. Rank III: mais dano e o fogo queima mais forte e por mais tempo.
    ranks: [
      { minLevel: 16, damage: [13, 18] },
      { minLevel: 28, damage: [16, 22], applies: [{ effect: 'queimadura', turns: 3, power: 3 }] },
    ],
  },
  // Figura barbuda pintada: a magia inimiga contorna a figura e volta para quem a lançou (só contra magia; nunca mata)
  brincadeira_de_deus: {
    id: 'brincadeira_de_deus', name: 'Brincadeira de Deus', description: 'Com uma pincelada, cria uma grande figura barbuda: o feitiço disparado contra você se curva ao redor dela e volta para quem o lançou. Reação contra magia que devolve parte do dano ao atacante.', actionText: 'Brincadeira de Deus', gif: 'pintura_brincadeira_de_deus.gif', grimoire: 'pintura',
    type: 'reaction', kind: 'reflect', reflect: 0.4, onlyVsMagic: true, manaCost: 40, emoji: '🧔',
    minLevel: 12, after: 'deux_tempetes',
    // Rank II: a figura devolve mais da magia
    ranks: [
      { minLevel: 26, reflect: 0.55 },
    ],
  },
  // A vouivre pintada solta uma explosão mágica na direção apontada: atinge também quem está perto do alvo
  vouivre_fantasma: {
    id: 'vouivre_fantasma', name: 'Urro Vívido do Dragão Vouivre Fantasma', description: 'Pinta uma vouivre, com cabeça e tronco de mulher, asas de morcego e cauda escamosa, que solta uma explosão mágica na direção do pincel. Atinge o alvo e também quem está perto dele.', actionText: 'Urro Vívido do Dragão Vouivre Fantasma', gif: 'pintura_vouivre_fantasma.gif', grimoire: 'pintura', magic: true,
    type: 'attack', range: 4, damage: [14, 20], attribute: 'magiaOfensiva', manaCost: 40, cooldown: 2,
    splash: { radius: 1, share: 0.5 },
    minLevel: 16, after: 'deux_tempetes',
    // Rank II: explosão maior e mais forte
    ranks: [
      { minLevel: 32, damage: [18, 25], splash: { radius: 2, share: 0.5 } },
    ],
  },
  // Serpente de quatro cabeças: cada cabeça tem uma chance de aplicar um elemento (fogo, gelo, vento, veneno)
  lindworm_de_quatro_cabecas: {
    id: 'lindworm_de_quatro_cabecas', name: 'Lindworm de Quatro Cabeças', description: 'Pinta uma grande serpente de quatro cabeças, cada uma soltando uma explosão de um elemento diferente. Cada cabeça tem uma chance de deixar o alvo com Queimadura, Lentidão, Sufocamento ou Envenenado.', actionText: 'Lindworm de Quatro Cabeças', gif: 'pintura_lindworm_de_quatro_cabecas.gif', grimoire: 'pintura', magic: true,
    type: 'attack', range: 4, damage: [12, 17], attribute: 'magiaOfensiva', manaCost: 46, cooldown: 3,
    applies: [
      { effect: 'queimadura', turns: 2, power: 2, chance: 0.4 }, // cabeça de fogo
      { effect: 'lentidao', turns: 2, chance: 0.4 }, // cabeça de gelo
      { effect: 'sufocamento', turns: 2, chance: 0.4 }, // cabeça de vento
      { effect: 'envenenado', turns: 3, power: 2, chance: 0.4 }, // cabeça de veneno
    ],
    minLevel: 24, after: 'vouivre_fantasma',
  },
  // Poço de tinta em forma de mola: prende o alvo (sem se mover e mais fácil de acertar), sem dano
  primavera_da_restricao: {
    id: 'primavera_da_restricao', name: 'Primavera da Restrição', description: 'Manipula a tinta da paleta para prender o alvo num poço em forma de mola. Ele não consegue se mover e fica mais fácil de acertar por alguns turnos.', actionText: 'Primavera da Restrição', gif: 'pintura_primavera_da_restricao.gif', grimoire: 'pintura', magic: true,
    type: 'bonus', usesAttack: true, manaCost: 30, cooldown: 4, targetRange: 4,
    applies: [{ effect: 'preso', turns: 2, to: 'enemy' }, { effect: 'lentidao', turns: 2, to: 'enemy' }],
    minLevel: 14, after: 'deux_tempetes',
    // Rank II: alcança mais longe e prende por mais tempo
    ranks: [
      { minLevel: 26, targetRange: 5, applies: [{ effect: 'preso', turns: 3, to: 'enemy' }, { effect: 'lentidao', turns: 3, to: 'enemy' }] },
    ],
  },
  // Gigante pintado meio saído do chão dá um soco de longe: muito forte e pode atordoar
  gigante_souterrain: {
    id: 'gigante_souterrain', name: 'Braço Forte do Gigante Souterrain', description: 'Pinta um gigante meio saído do chão, que dá um soco no alvo com um punho incrivelmente denso. Alcance longo, dano alto e uma chance de deixar o alvo Atordoado.', actionText: 'Braço Forte do Gigante Souterrain', gif: 'pintura_gigante_souterrain.gif', grimoire: 'pintura', magic: true,
    type: 'attack', range: 6, damage: [18, 25], attribute: 'magiaOfensiva', manaCost: 52, cooldown: 3,
    applies: [{ effect: 'atordoado', turns: 1, chance: 0.25 }],
    minLevel: 26, after: 'primavera_da_restricao',
  },

  // ---- Grimório da Roseira (ÉPICO) ----
  // Rosas selvagens e espinhos: lança perfurante, vinhas que perseguem e prendem, um jardim em área que fica mais forte
  // contra inimigos amaldiçoados e uma barreira de espinhos com perfume que confunde. Escala de atributo da raridade (1,4x).
  // Árvore: Lança Escarlate -> { Roseiral Caçador -> Paraíso de Rosa Azul }, { Barreira de Espinhos e Rosas }.
  // Lança gigante de rosas torcidas, arremessada de longe: os espinhos fazem sangrar
  lanca_de_fios_escarlate: {
    id: 'lanca_de_fios_escarlate', name: 'Lança de Batalha Elegante de Fios Escarlate', description: 'Torce várias mechas de rosas selvagens na forma de uma lança gigante, com uma grande rosa na ponta do eixo, e a arremessa com a mão. Atinge de longe e os espinhos fazem o alvo sangrar.', actionText: 'Lança de Batalha Elegante de Fios Escarlate', gif: 'roseira_lanca_de_fios_escarlate.gif', grimoire: 'roseira', magic: true,
    type: 'attack', range: 4, damage: [10, 15], attribute: 'magiaOfensiva', manaCost: 24,
    applies: [{ effect: 'sangramento', turns: 2, stacks: 1, power: 2 }],
    minLevel: 6, // raiz da árvore da Roseira
    // Rank II: mais dano. Rank III: mais dano e os espinhos abrem um sangramento mais fundo.
    ranks: [
      { minLevel: 16, damage: [13, 18] },
      { minLevel: 28, damage: [16, 22], applies: [{ effect: 'sangramento', turns: 3, stacks: 2, power: 2 }] },
    ],
  },
  // Cabo de espada com vinhas no lugar da lâmina: perseguem o alvo (difícil de esquivar), prendem e viram uma árvore de espinhos
  roseiral_cacador: {
    id: 'roseiral_cacador', name: 'Roseiral Caçador de Cadáveres', description: 'Puxa do grimório o cabo de uma espada com vinhas espinhosas no lugar da lâmina. Elas perseguem o alvo mesmo que ele fuja e, ao capturá-lo, se erguem numa árvore de espinhos. Difícil de esquivar, prende o alvo no lugar e o faz sangrar.', actionText: 'Roseiral Caçador de Cadáveres', gif: 'roseira_roseiral_cacador.gif', grimoire: 'roseira', magic: true,
    type: 'attack', range: 4, damage: [12, 17], attribute: 'magiaOfensiva', manaCost: 36, cooldown: 2, dodgePenalty: 0.25,
    applies: [{ effect: 'preso', turns: 1 }, { effect: 'sangramento', turns: 2, stacks: 1, power: 2 }],
    minLevel: 12, after: 'lanca_de_fios_escarlate',
    // Rank II: mais dano e prende por mais tempo. Rank III: várias árvores de uma vez (atinge quem está perto do alvo).
    ranks: [
      { minLevel: 22, damage: [15, 21], applies: [{ effect: 'preso', turns: 2 }, { effect: 'sangramento', turns: 2, stacks: 1, power: 2 }] },
      { minLevel: 34, damage: [18, 25], splash: { radius: 2, share: 0.5 } },
    ],
  },
  // Jardim de rosas azuis em área: as vinhas prendem quem estiver perto e ficam mais fortes contra alvos amaldiçoados
  paraiso_de_rosa_azul: {
    id: 'paraiso_de_rosa_azul', name: 'Paraíso de Rosa Azul', description: 'Cria dois círculos mágicos no chão que geram roseiras azuis, cobrindo tudo ao redor e capturando os inimigos que tocam as vinhas. Contra alvos amaldiçoados (com algum efeito negativo), as vinhas ficam mais fortes e absorvem o poder da maldição.', actionText: 'Paraíso de Rosa Azul', gif: 'roseira_paraiso_de_rosa_azul.gif', grimoire: 'roseira', magic: true,
    type: 'bonus', usesAttack: true, manaCost: 50, cooldown: 4, area: { radius: 3 }, damage: [10, 14], attribute: 'magiaOfensiva',
    cursedBonus: 1.5, cursedDrain: 8,
    applies: [{ effect: 'preso', turns: 2, to: 'enemy' }],
    minLevel: 24, after: 'roseiral_cacador',
    // Rank II: o jardim cobre mais chão e as vinhas batem mais forte
    ranks: [
      { minLevel: 36, area: { radius: 4 }, damage: [13, 18] },
    ],
    // Dano em todos os inimigos da área (antes de prendê-los). Amaldiçoado = já tem algum debuff:
    // leva mais dano e a Roseira absorve parte da mana dele.
    use(battle, user) {
      const lines = [`🌹 ${user.name} abriu o **Paraíso de Rosa Azul**: roseiras azuis cobrem o chão ao redor.`];
      for (const foe of foesInArea(battle, user, this.area.radius)) {
        const cursed = Object.keys(foe.effects ?? {}).length > 0; // todo efeito é negativo
        const dmg = hitWithMagic(this, user, foe, cursed ? this.cursedBonus : 1);
        lines.push(`🥀 As vinhas atingiram ${foe.name} (**${dmg}** de dano).`);
        if (cursed) {
          const drained = Math.min(foe.mana, this.cursedDrain);
          foe.mana -= drained;
          user.mana = Math.min(user.maxMana, user.mana + drained);
          lines.push(`💙 ${foe.name} está amaldiçoado: as vinhas ficaram mais fortes e absorveram ${drained} de mana da maldição.`);
        }
        lines.push(...fx.onHit(foe));
      }
      lines.push(...hitSummonsInArea(this, battle, user, this.area.radius));
      return lines.join(NL);
    },
  },
  // Barreira de roseiras: absorve o golpe, os espinhos ferem quem atacou e o perfume atrapalha os sentidos dele
  barreira_de_espinhos: {
    id: 'barreira_de_espinhos', name: 'Barreira de Espinhos e Rosas', description: 'Ergue uma barreira de roseiras que protege você e fere com espinhos quem a toca. As rosas soltam um perfume que inibe os sentidos do atacante. Reação que absorve parte do golpe, devolve dano de espinhos e deixa o atacante com Cegueira (erra mais golpes).', actionText: 'Barreira de Espinhos e Rosas', gif: 'roseira_barreira_de_espinhos.gif', grimoire: 'roseira',
    type: 'reaction', kind: 'block', absorb: [4, 7], attribute: 'magiaDefensiva', manaCost: 26, emoji: '🌹',
    thorns: [3, 5],
    applies: [{ effect: 'cegueira', turns: 2, power: 0.2 }],
    minLevel: 10, after: 'lanca_de_fios_escarlate',
    // Rank II: barreira mais grossa, espinhos maiores e as vinhas podem atar o atacante
    ranks: [
      { minLevel: 24, absorb: [7, 11], thorns: [5, 8], applies: [{ effect: 'cegueira', turns: 2, power: 0.2 }, { effect: 'preso', turns: 1, chance: 0.35 }] },
    ],
  },

  // ---- Grimório da Luz (LENDÁRIO) ----
  // Velocidade da luz: golpes difíceis de esquivar, feixes em área, cura e um avatar gigante. O Raio do Castigo Divino
  // é impossível de esquivar e a Escuridão não consegue absorvê-lo. Escala de atributo da raridade (1,7x).
  // Árvore: Espada de Luz -> { Chicote -> Luz de Avior -> Raio do Castigo Divino }, { Flash Cortador -> Flechas do Julgamento }, { Salto Fotônico },
  //         { Partículas de Cura -> Monarca Absoluto }.
  // Fragmentos de luz lançados em alta velocidade: rápidos demais para esquivar com facilidade
  espada_de_luz_do_julgamento: {
    id: 'espada_de_luz_do_julgamento', name: 'Espada de Luz do Julgamento', description: 'Cria vários fragmentos de luz ao redor, quatro menores passando por um maior, e os lança em alta velocidade no alvo. Atinge de longe e, por ser veloz como a luz, é mais difícil de esquivar.', actionText: 'Espada de Luz do Julgamento', gif: 'luz_espada_de_luz_do_julgamento.gif', grimoire: 'luz', magic: true,
    type: 'attack', range: 4, damage: [10, 15], attribute: 'magiaOfensiva', manaCost: 24, dodgePenalty: 0.15,
    minLevel: 6, // raiz da árvore da Luz
    // Rank II: mais fragmentos, mais dano
    ranks: [
      { minLevel: 18, damage: [13, 19] },
    ],
  },
  // Chicote longo de movimentos imprevisíveis: muito difícil de esquivar
  chicote_de_luz_do_julgamento: {
    id: 'chicote_de_luz_do_julgamento', name: 'Chicote de Luz do Julgamento', description: 'Manifesta um longo chicote de luz que se estende da mão, com movimentos imprevisíveis ao ser balançado, forte e veloz o bastante para destruir o teto de uma caverna. Alcance médio e muito difícil de esquivar.', actionText: 'Chicote de Luz do Julgamento', gif: 'luz_chicote_de_luz_do_julgamento.gif', grimoire: 'luz', magic: true,
    type: 'attack', range: 3, damage: [12, 17], attribute: 'magiaOfensiva', manaCost: 30, dodgePenalty: 0.3,
    minLevel: 10, after: 'espada_de_luz_do_julgamento',
    // Rank II: o chicote bate mais forte
    ranks: [
      { minLevel: 24, damage: [15, 21] },
    ],
  },
  // Orbes ao redor disparam feixes finos: atinge o alvo e quem está perto dele
  flash_cortador_dos_ceus: {
    id: 'flash_cortador_dos_ceus', name: 'Flash Cortador dos Céus', description: 'Cria vários orbes de luz ao redor, que disparam finos feixes de luz. Alcance longo, e os feixes também acertam quem está perto do alvo.', actionText: 'Flash Cortador dos Céus', gif: 'luz_flash_cortador_dos_ceus.gif', grimoire: 'luz', magic: true,
    type: 'attack', range: 5, damage: [11, 16], attribute: 'magiaOfensiva', manaCost: 36, cooldown: 2, splash: { radius: 1, share: 0.4 },
    minLevel: 14, after: 'espada_de_luz_do_julgamento',
  },
  // Vira luz e se teletransporta: esquiva com chance alta e, se der certo, reaparece longe do atacante (`blink` casas)
  salto_fotonico: {
    id: 'salto_fotonico', name: 'Salto Fotônico', description: 'Vira luz pura por um instante e se teletransporta na velocidade da luz: o ataque acerta só o rastro de brilho deixado para trás. Reação de esquiva com chance alta; se der certo, você reaparece até 3 casas longe do atacante.', actionText: 'Salto Fotônico', gif: 'luz_salto_fotonico.gif', grimoire: 'luz', magic: true,
    type: 'reaction', kind: 'dodge', chance: 0.65, blink: 3, manaCost: 28, emoji: '✨',
    minLevel: 12, after: 'espada_de_luz_do_julgamento',
    // Rank II: esquiva ainda mais fácil e mais barata
    ranks: [
      { minLevel: 28, chance: 0.75, manaCost: 22 },
    ],
  },
  // Grãos de luz envolvem o ferimento e o curam
  particulas_de_cura_de_luz: {
    id: 'particulas_de_cura_de_luz', name: 'Partículas de Cura de Luz', description: 'Gera uma esfera de luz ao redor da parte ferida do corpo; pequenos grãos de luz envolvem a lesão e a curam. Ação bônus que recupera a sua vida.', actionText: 'Partículas de Cura de Luz', gif: 'luz_particulas_de_cura_de_luz.gif', grimoire: 'luz', magic: true,
    type: 'bonus', manaCost: 35, cooldown: 3, heal: [12, 18], attribute: 'magiaSuplementar',
    minLevel: 10, after: 'espada_de_luz_do_julgamento',
    // Rank II: cura mais e recarrega mais rápido
    ranks: [
      { minLevel: 26, heal: [18, 26], cooldown: 2 },
    ],
    use(battle, user) {
      const healed = Math.max(0, Math.min(user.maxHp - user.hp, rollPower(user, this, this.heal)));
      user.hp += healed;
      return `✨ Grãos de luz envolveram os ferimentos de ${user.name}: ❤️ +${healed} de vida.`;
    },
  },
  // Esfera de poder que se aplana em lâminas de luz e cai sobre todos os inimigos ao redor
  flechas_do_julgamento: {
    id: 'flechas_do_julgamento', name: 'Flechas do Julgamento', description: 'Libera o poder mágico numa esfera que se expande, se aplana e vira inúmeras lâminas de luz, que caem sozinhas sobre os alvos. Ação bônus que atinge todos os inimigos ao seu redor.', actionText: 'Flechas do Julgamento', gif: 'luz_flechas_do_julgamento.gif', grimoire: 'luz', magic: true,
    type: 'bonus', usesAttack: true, manaCost: 50, cooldown: 4, area: { radius: 4 }, damage: [9, 13], attribute: 'magiaOfensiva',
    minLevel: 20, after: 'flash_cortador_dos_ceus',
    use(battle, user) {
      const lines = [`🗡️ A esfera de luz de ${user.name} se abriu em inúmeras lâminas, que caíram sobre os inimigos.`];
      for (const foe of foesInArea(battle, user, this.area.radius)) {
        lines.push(`✨ ${foe.name} foi atingido pelas lâminas (**${hitWithMagic(this, user, foe)}** de dano).`, ...fx.onHit(foe));
      }
      lines.push(...hitSummonsInArea(this, battle, user, this.area.radius));
      return lines.join(NL);
    },
  },
  // Luz concentrada lançada com o braço: explosão forte o bastante para parar um tornado (empurra o alvo)
  luz_de_avior: {
    id: 'luz_de_avior', name: 'Luz de Avior', description: 'Cerca-se de luz e, estendendo o braço, lança a luz concentrada no alvo. A explosão é forte o bastante para parar um tornado: dano alto e empurra o alvo para trás.', actionText: 'Luz de Avior', gif: 'luz_luz_de_avior.gif', grimoire: 'luz', magic: true,
    type: 'attack', range: 4, damage: [17, 24], attribute: 'magiaOfensiva', manaCost: 46, cooldown: 3, push: 2,
    minLevel: 22, after: 'chicote_de_luz_do_julgamento',
  },
  // Avatar gigante de luz: por alguns turnos você bate mais forte e sofre menos dano (lento: recarga longa)
  monarca_absoluto: {
    id: 'monarca_absoluto', name: 'Monarca Absoluto do Brilho Sagrado', description: 'Emite luz do corpo e projeta uma imagem gigante de si mesmo. Por alguns turnos você causa mais dano e sofre menos; é lento para a Magia de Luz, então demora a recarregar.', actionText: 'Monarca Absoluto do Brilho Sagrado', gif: 'luz_monarca_absoluto.gif', grimoire: 'luz', magic: true,
    type: 'bonus', manaCost: 60, cooldown: 6, active: { name: 'Monarca Absoluto', emoji: '👑', turns: 3, mods: { damageBonus: 6, damageResist: 0.2 } },
    minLevel: 26, after: 'particulas_de_cura_de_luz',
  },
  // Coluna de luz enorme: alcance muito amplo, impossível de esquivar e a Escuridão não consegue absorvê-la
  raio_do_castigo_divino: {
    id: 'raio_do_castigo_divino', name: 'Raio do Castigo Divino', description: 'Concentra a luz numa esfera entre as mãos até ela crescer e a libera numa enorme coluna de luz contra o oponente. Alcance muito amplo, rápido demais para esquivar, e a dispersão de energia é tão grande que a Magia de Escuridão não consegue absorvê-la.', actionText: 'Raio do Castigo Divino', gif: 'luz_raio_do_castigo_divino.gif', grimoire: 'luz', magic: true,
    type: 'attack', range: 7, damage: [22, 30], attribute: 'magiaOfensiva', manaCost: 65, cooldown: 4, dodgePenalty: 1, piercesDarkness: true,
    minLevel: 34, after: 'luz_de_avior',
  },

  // ---- Grimório do Mercúrio (ÉPICO) ----
  // Metal líquido e pesado que alterna entre ataque e defesa: balas, lanças, lâmina flutuante, chuva em área,
  // um escudo forte contra golpes físicos e uma gaiola que prende o alvo. Escala de atributo da raridade (1,4x).
  // Árvore: Bala de Prata -> { Lanças de Prata -> Lança Real }, { Lâmina de Prata -> Chuva Prateada }, { Escudo -> Estrela de Prata }.
  // Pequenas esferas de mercúrio condensado disparadas no alvo
  bala_de_prata: {
    id: 'bala_de_prata', name: 'Bala de Prata', description: 'Condensa mercúrio em pequenas esferas e as dispara contra o alvo. Ataque básico de média distância do grimório.', actionText: 'Bala de Prata', gif: 'mercurio_bala_de_prata.gif', grimoire: 'mercurio', magic: true,
    type: 'attack', range: 3, damage: [10, 15], attribute: 'magiaOfensiva', manaCost: 22,
    minLevel: 6, // raiz da árvore do Mercúrio
    // Rank II e III: esferas mais densas, mais dano
    ranks: [
      { minLevel: 16, damage: [13, 18] },
      { minLevel: 28, damage: [16, 22] },
    ],
  },
  // Lança de mercúrio arremessada de longe; no rank II várias lanças saem juntas
  lancas_de_prata: {
    id: 'lancas_de_prata', name: 'Lanças de Prata', description: 'Gera uma lança de mercúrio e a arremessa contra o alvo, de longe. Várias lanças podem ser disparadas ao mesmo tempo, atingindo também quem está perto do alvo.', actionText: 'Lanças de Prata', gif: 'mercurio_lancas_de_prata.gif', grimoire: 'mercurio', magic: true,
    type: 'attack', range: 5, damage: [12, 17], attribute: 'magiaOfensiva', manaCost: 32, cooldown: 1,
    minLevel: 12, after: 'bala_de_prata',
    // Rank II: múltiplas lanças (respingo em quem está perto do alvo)
    ranks: [
      { minLevel: 24, damage: [14, 20], splash: { radius: 1, share: 0.4 } },
    ],
  },
  // Espada de dois gumes que flutua e ataca sozinha: difícil de prever, faz sangrar
  lamina_de_prata: {
    id: 'lamina_de_prata', name: 'Lâmina de Prata', description: 'Cria uma espada de dois gumes feita de mercúrio, que flutua no ar e ataca sem precisar da mão do usuário. Média distância, mais difícil de esquivar e faz o alvo sangrar.', actionText: 'Lâmina de Prata', gif: 'mercurio_lamina_de_prata.gif', grimoire: 'mercurio', magic: true,
    type: 'attack', range: 3, damage: [12, 17], attribute: 'magiaOfensiva', manaCost: 30, dodgePenalty: 0.15,
    applies: [{ effect: 'sangramento', turns: 2, stacks: 1, power: 2 }],
    minLevel: 10, after: 'bala_de_prata',
  },
  // Barreira de metal pesado: absorve bem, e ainda mais contra golpes físicos e projéteis
  escudo_de_mercurio: {
    id: 'escudo_de_mercurio', name: 'Escudo de Mercúrio', description: 'Molda mercúrio líquido numa barreira metálica densa e espessa ao redor do corpo, que se recompõe com facilidade. Reação que absorve parte do golpe, e absorve ainda mais contra ataques físicos.', actionText: 'Escudo de Mercúrio', gif: 'mercurio_escudo_de_mercurio.gif', grimoire: 'mercurio',
    type: 'reaction', kind: 'block', absorb: [5, 8], attribute: 'magiaDefensiva', manaCost: 22, physicalBonus: 1.5, emoji: '🪩',
    minLevel: 10, after: 'bala_de_prata',
    // Rank II: barreira mais espessa
    ranks: [
      { minLevel: 24, absorb: [8, 12] },
    ],
  },
  // Feixe de mercúrio brilhante que segue a palma da mão: perfura rocha (ignora Bloqueio) e alcança longe
  lanca_real_prateada: {
    id: 'lanca_real_prateada', name: 'Lança Real Prateada Brilhante', description: 'Estende a palma da mão e dela sai um longo feixe de mercúrio brilhante, que segue o movimento da mão e é afiado o bastante para perfurar metros de rocha. Alcance longo, dano alto e atravessa o Bloqueio.', actionText: 'Lança Real Prateada Brilhante', gif: 'mercurio_lanca_real_prateada.gif', grimoire: 'mercurio', magic: true,
    type: 'attack', range: 6, damage: [17, 24], attribute: 'magiaOfensiva', manaCost: 50, cooldown: 3, ignoreBlock: true,
    minLevel: 26, after: 'lancas_de_prata',
  },
  // Gotas de mercúrio caem do céu sobre todos os inimigos ao redor; o usuário desvia as gotas de si mesmo
  chuva_prateada: {
    id: 'chuva_prateada', name: 'Chuva Prateada', description: 'Invoca inúmeras gotas de mercúrio do céu, tão densas que rompem tudo no caminho. Ação bônus que atinge todos os inimigos ao seu redor; você controla as gotas para não ser atingido.', actionText: 'Chuva Prateada', gif: 'mercurio_chuva_prateada.gif', grimoire: 'mercurio', magic: true,
    type: 'bonus', usesAttack: true, manaCost: 48, cooldown: 4, area: { radius: 3 }, damage: [10, 14], attribute: 'magiaOfensiva',
    minLevel: 20, after: 'lamina_de_prata',
    use(battle, user) {
      const lines = [`🌧️ ${user.name} fez cair uma **Chuva Prateada**: as gotas de mercúrio desviam dele e caem sobre os inimigos.`];
      for (const foe of foesInArea(battle, user, this.area.radius)) {
        lines.push(`🪩 ${foe.name} foi atingido pelas gotas (**${hitWithMagic(this, user, foe)}** de dano).`, ...fx.onHit(foe));
      }
      lines.push(...hitSummonsInArea(this, battle, user, this.area.radius));
      return lines.join(NL);
    },
  },
  // Gaiola gigante de mercúrio: as barras lançam lanças no alvo e bloqueiam fuga e contra-ataques
  estrela_de_prata: {
    id: 'estrela_de_prata', name: 'Estrela de Prata da Execução', description: 'Espalha fios e gotas de mercúrio pela área e os reúne numa gaiola gigante ao redor do alvo. As barras disparam Lanças de Prata nele e bloqueiam fugas e contra-ataques: causa dano e deixa o alvo sem se mover e sem reagir.', actionText: 'Estrela de Prata da Execução', gif: 'mercurio_estrela_de_prata.gif', grimoire: 'mercurio', magic: true,
    type: 'bonus', usesAttack: true, manaCost: 55, cooldown: 5, targetRange: 4, damage: [10, 14], attribute: 'magiaOfensiva',
    applies: [{ effect: 'paralisado', turns: 2, to: 'enemy' }],
    minLevel: 28, after: 'escudo_de_mercurio',
    use(battle, user, foe) {
      return [`⭐ ${user.name} prendeu ${foe.name} na **Estrela de Prata da Execução**: as barras dispararam lanças de prata (**${hitWithMagic(this, user, foe)}** de dano).`, ...fx.onHit(foe)].join(NL);
    },
  },

  // ---- Grimório do Algodão (RARO) ----
  // Ovelhas de algodão: cordas que prendem, ovelhas cozinheiras que curam vida e mana, uma almofada que lança o golpe de volta
  // e um carneiro gigante invocado (ocupa 2×2 casas) que arremessa o alvo para longe. Escala de atributo da raridade (1,15x).
  // Árvore: Laços de Ovelha -> { Almofada Macia de Ovelha }, { Ovelha Cozinheira -> Mestre Cozinheiro }, { Ovelha Dorminhoca }.
  // Cordas de algodão prendem o alvo ao ambiente: suspenso no ar, sem se mover e sem esquivar
  lacos_de_ovelha: {
    id: 'lacos_de_ovelha', name: 'Laços de Ovelha', description: 'Cria várias cordas de algodão que envolvem o alvo e se prendem ao ambiente ao redor, deixando-o suspenso no ar. Causa pouco dano, mas o alvo fica sem se mover e sem esquivar.', actionText: 'Laços de Ovelha', gif: 'algodao_lacos_de_ovelha.gif', grimoire: 'algodao', magic: true,
    type: 'attack', range: 3, damage: [6, 10], attribute: 'magiaOfensiva', manaCost: 22, cooldown: 2,
    applies: [{ effect: 'imobilizado', turns: 1 }],
    minLevel: 4, // raiz da árvore do Algodão
    // Rank II: mais cordas, mais dano e o alvo fica preso por mais um turno
    ranks: [
      { minLevel: 16, damage: [9, 13], applies: [{ effect: 'imobilizado', turns: 2 }] },
    ],
  },
  // Um carneiro grande de algodão segura o golpe na barriga e lança de volta em alta velocidade
  almofada_macia_de_ovelha: {
    id: 'almofada_macia_de_ovelha', name: 'Almofada Macia de Ovelha', description: 'Cria um grande carneiro de algodão que segura o golpe na barriga, puxa o estômago para trás e lança o que recebeu de volta em alta velocidade. Reação de defesa que absorve dano e fere quem atacou.', actionText: 'Almofada Macia de Ovelha', gif: 'algodao_almofada_macia_de_ovelha.gif', grimoire: 'algodao', magic: true,
    type: 'reaction', kind: 'block', absorb: [4, 7], attribute: 'magiaDefensiva', manaCost: 22, thorns: [3, 6], emoji: '🐑',
    thornsText: (attacker, hurt) => `🐑 A almofada de algodão lançou o golpe de volta em ${attacker.name} (**${hurt}** de dano).`,
    minLevel: 8, after: 'lacos_de_ovelha',
    // Rank II: segura e devolve mais
    ranks: [
      { minLevel: 22, absorb: [6, 10], thorns: [5, 8] },
    ],
  },
  // Uma semente vira tufo de algodão e depois uma ovelha de chef: a comida cura você e os aliados por perto
  ovelha_cozinheira: {
    id: 'ovelha_cozinheira', name: 'Ovelha Cozinheira', description: 'Uma pequena semente cresce até virar um tufo de algodão e depois ovelhas de chapéu de chef, que soltam pó do corpo e obedecem aos seus comandos, quase sempre para cozinhar. Ação bônus: a comida cura a sua vida e a dos aliados por perto.', actionText: 'Ovelha Cozinheira', gif: 'algodao_ovelha_cozinheira.gif', grimoire: 'algodao', magic: true,
    type: 'bonus', manaCost: 30, cooldown: 3, radius: 2, heal: [8, 12], attribute: 'magiaSuplementar',
    minLevel: 10, after: 'lacos_de_ovelha',
    // Rank II: mais ovelhas, mais comida
    ranks: [
      { minLevel: 24, heal: [12, 18] },
    ],
    use(battle, user) {
      const lines = [`🐑 As Ovelhas Cozinheiras de ${user.name} prepararam um banquete.`];
      for (const p of alliesNear(battle, user, this.radius)) {
        const healed = Math.max(0, Math.min(p.maxHp - p.hp, rollPower(user, this, this.heal)));
        p.hp += healed;
        lines.push(`🍲 ${p.name} comeu: ❤️ +${healed} de vida.`);
      }
      return lines.join(NL);
    },
  },
  // A ovelha de bigode e lenço no pescoço: a comida dela devolve o poder mágico de quem come
  mestre_cozinheiro: {
    id: 'mestre_cozinheiro', name: 'Ovelha Cozinheira: Mestre Cozinheiro', description: 'Manifesta uma Ovelha Cozinheira de bigode e lenço no pescoço, capaz de preparar comida que restaura o poder mágico. Ação bônus: a comida recupera a sua mana e a dos aliados por perto.', actionText: 'Ovelha Cozinheira: Mestre Cozinheiro', gif: 'algodao_mestre_cozinheiro.gif', grimoire: 'algodao', magic: true,
    type: 'bonus', manaCost: 10, cooldown: 4, radius: 2, restoreMana: [25, 35], attribute: 'magiaSuplementar',
    minLevel: 20, after: 'ovelha_cozinheira',
    // Rank II: pratos mais fortes e recarga menor
    ranks: [
      { minLevel: 32, restoreMana: [35, 45], cooldown: 3 },
    ],
    use(battle, user) {
      const lines = [`👨‍🍳 O Mestre Cozinheiro de ${user.name} serviu um prato cheio de mana.`];
      for (const p of alliesNear(battle, user, this.radius)) {
        const got = Math.max(0, Math.min(p.maxMana - p.mana, rollPower(user, this, this.restoreMana)));
        p.mana += got;
        lines.push(`🍽️ ${p.name} comeu: 🔷 +${got} de mana.`);
      }
      return lines.join(NL);
    },
  },
  // Carneiro gigante de algodão invocado no mapa (2×2 casas): persegue o inimigo e, como um aríete, o arremessa longe
  ovelha_dorminhoca: {
    id: 'ovelha_dorminhoca', name: 'Ataque da Ovelha Dorminhoca', description: 'Gera uma grande quantidade de algodão e a molda num carneiro gigante com chifres, que funciona como um aríete de curto alcance. Ação bônus que invoca o carneiro no mapa (ocupa 2×2 casas): ele persegue o inimigo, e o impacto o arremessa para longe.', actionText: 'Ataque da Ovelha Dorminhoca', gif: 'algodao_ovelha_dorminhoca.gif', grimoire: 'algodao', magic: true,
    type: 'bonus', manaCost: 50, cooldown: 5, attribute: 'magiaOfensiva',
    summon: {
      count: 1, size: 2, hp: 50, damage: [8, 12], share: 0.5, push: 3, label: 'Ovelha Dorminhoca', look: 'ovelha', icon: 'ovelha_dorminhoca.png', emoji: '🐏',
      text: (owner, n, hp) => (n
        ? `🐏 ${owner.name} moldou uma **Ovelha Dorminhoca** gigante de algodão, com ${hp} de vida. Ela investe sozinha contra os inimigos até ser destruída.`
        : `🐏 O algodão de ${owner.name} não encontrou espaço livre para formar a Ovelha Dorminhoca.`),
    },
    minLevel: 18, after: 'lacos_de_ovelha',
    // Rank II: o carneiro bate mais forte e aguenta mais
    ranks: [
      { minLevel: 30, summon: {
        count: 1, size: 2, hp: 70, damage: [11, 16], share: 0.5, push: 4, label: 'Ovelha Dorminhoca', look: 'ovelha', icon: 'ovelha_dorminhoca.png', emoji: '🐏',
        text: (owner, n, hp) => (n
          ? `🐏 ${owner.name} moldou uma **Ovelha Dorminhoca** gigante de algodão, com ${hp} de vida. Ela investe sozinha contra os inimigos até ser destruída.`
          : `🐏 O algodão de ${owner.name} não encontrou espaço livre para formar a Ovelha Dorminhoca.`),
      } },
    ],
  },

  // ---- Grimório do Aço (RARO) ----
  // Lanças de aço com a cabeça girando em espiral (perfuram defesas), um muro de aço que brota do chão e correntes que prendem.
  // Escala de atributo da raridade (1,15x).
  // Árvore: Lança Espiral Impetuosa -> { Parede Armada do Castelo de Aço }, { Lança Espiral Flamejante }, { Restrição de Aço }.
  // Lança que estica o cabo a partir do chão até a cabeça em espiral acertar o alvo: longo alcance, barata
  lanca_espiral_impetuosa: {
    id: 'lanca_espiral_impetuosa', name: 'Lança Espiral Impetuosa', description: 'Bate a mão no chão e invoca uma longa lança de cabeça em espiral, que estica o cabo até acertar o oponente; também pode ser disparada pelo ar, ou só a cabeça, como uma bala de aço. Ataque de longo alcance; nos ranks, a ponta gira mais rápido e chega a perfurar o Bloqueio.', actionText: 'Lança Espiral Impetuosa', gif: 'aco_lanca_espiral_impetuosa.gif', grimoire: 'aco', magic: true,
    type: 'attack', range: 5, damage: [8, 12], attribute: 'magiaOfensiva', manaCost: 20,
    minLevel: 4, // raiz da árvore do Aço
    // Rank II: mais dano. Rank III: a bala de aço gira tão rápido que fura o Bloqueio e é mais difícil de esquivar.
    ranks: [
      { minLevel: 16, damage: [11, 16] },
      { minLevel: 28, damage: [14, 20], ignoreBlock: true, dodgePenalty: 0.1, manaCost: 26, cooldown: 2 },
    ],
  },
  // Muro de aço que brota do chão: segura muito, mas só cobre uma direção (golpes que se espalham passam pelos lados)
  parede_armada_do_castelo_de_aco: {
    id: 'parede_armada_do_castelo_de_aco', name: 'Parede Armada do Castelo de Aço', description: 'Invoca do chão um muro de aço com o desenho da capa do seu grimório na frente, forte o bastante para quebrar até um cristal afiado que o atinja. Reação que absorve muito dano, mas só cobre uma direção: contra golpes que se espalham em área ela segura metade.', actionText: 'Parede Armada do Castelo de Aço', gif: 'aco_parede_armada_do_castelo_de_aco.gif', grimoire: 'aco', magic: true,
    type: 'reaction', kind: 'block', absorb: [6, 10], attribute: 'magiaDefensiva', manaCost: 26, emoji: '🏰', weakVsSplash: 0.5,
    minLevel: 8, after: 'lanca_espiral_impetuosa',
    // Rank II: o muro fica mais grosso e segura até golpes que atravessam o Bloqueio
    ranks: [
      { minLevel: 22, absorb: [9, 14], cutsThrough: true },
    ],
  },
  // Lança enorme girando em alta velocidade, empurrada de perto: perfura a defesa
  lanca_espiral_flamejante: {
    id: 'lanca_espiral_flamejante', name: 'Lança Espiral Flamejante', description: 'Cria uma lança enorme de cabeça em espiral que gira em alta velocidade e, com um impulso, perfura blocos grossos de pedra. Golpe de curto alcance, forte, que atravessa o Bloqueio.', actionText: 'Lança Espiral Flamejante', gif: 'aco_lanca_espiral_flamejante.gif', grimoire: 'aco', magic: true,
    type: 'attack', range: 2, damage: [13, 18], attribute: 'magiaOfensiva', manaCost: 32, cooldown: 2, ignoreBlock: true,
    minLevel: 10, after: 'lanca_espiral_impetuosa',
    // Rank II: lança maior, mais dano
    ranks: [
      { minLevel: 24, damage: [17, 24] },
    ],
  },
  // Correntes de aço enrolam braços, pernas e tronco: o alvo fica sem se mover e sem esquivar
  restricao_de_aco: {
    id: 'restricao_de_aco', name: 'Restrição de Aço', description: 'Faz surgirem correntes de aço que se enrolam nos braços, nas pernas e no tronco do alvo, e apertam mais quanto mais ele tenta escapar. O alvo fica Imobilizado (sem se mover nem esquivar).', actionText: 'Restrição de Aço', gif: 'aco_restricao_de_aco.gif', grimoire: 'aco', magic: true,
    type: 'bonus', usesAttack: true, manaCost: 30, cooldown: 4, targetRange: 4,
    applies: [{ effect: 'imobilizado', turns: 2, to: 'enemy' }],
    minLevel: 14, after: 'lanca_espiral_impetuosa',
    // Rank II: alcança mais longe e as correntes seguram por mais um turno
    ranks: [
      { minLevel: 26, targetRange: 5, applies: [{ effect: 'imobilizado', turns: 3, to: 'enemy' }] },
    ],
  },

  // ---- Grimório do Espelho (RARO) ----
  // Espelhos que disparam e refletem raios de luz (longo alcance), teletransporte até um espelho, reflexo de magias e
  // a Duplicata Real: um clone saído do espelho que luta sozinho e libera o Refrão de Reflexão Dupla. Escala da raridade (1,15x).
  // Árvore: Raio Refletido -> { Refrão de Reflexão -> Refrão de Reflexão Grande }, { Raio de Reflexão Grande },
  //         { Reflexão Completa }, { Magia de Espelhos -> Mudança de Espelhos }, { Duplicata Real -> Refrão de Reflexão Dupla }.
  // Raio de luz disparado de um espelho, sem gesto nenhum: longo alcance, barato e rápido
  raio_refletido: {
    id: 'raio_refletido', name: 'Raio Refletido', description: 'Manifesta um espelho e dispara dele um raio de luz mágica no alvo, sem precisar de gesto nenhum, rápido e forte o bastante para atravessar uma parede. Ataque de longo alcance, barato e difícil de esquivar.', actionText: 'Raio Refletido', gif: 'espelho_raio_refletido.gif', grimoire: 'espelho', magic: true,
    type: 'attack', range: 5, damage: [8, 12], attribute: 'magiaOfensiva', manaCost: 18, dodgePenalty: 0.1,
    minLevel: 4, // raiz da árvore do Espelho
    // Rank II: raios em sucessão mais rápida, mais dano
    ranks: [
      { minLevel: 16, damage: [11, 16] },
    ],
  },
  // Teletransporte até um espelho invocado onde você quiser (use `direcao` e `casas`)
  magia_de_espelhos: {
    id: 'magia_de_espelhos', name: 'Magia de Espelhos', description: 'Invoca um espelho no lugar que quiser e se teletransporta na hora até ele, surgindo à sua frente. Ação bônus para escapar, se reposicionar ou surpreender o adversário.', actionText: 'Magia de Espelhos', gif: 'espelho_magia_de_espelhos.gif', grimoire: 'espelho', magic: true,
    type: 'bonus', manaCost: 24, cooldown: 2, teleport: 'self', destRange: 5,
    teleportText: me => `🪞 ${me.name} entrou num espelho e surgiu na frente de outro, em outro ponto do mapa.`,
    minLevel: 8, after: 'raio_refletido',
    // Rank II: espelhos mais longe
    ranks: [
      { minLevel: 22, destRange: 7 },
    ],
  },
  // Espelho ampliado até o tamanho da magia: devolve o feitiço para quem lançou
  reflexao_completa: {
    id: 'reflexao_completa', name: 'Reflexão Completa', description: 'Salta na frente da magia que se aproxima com um espelho e o amplia até o tamanho dela, refletindo-a de volta para o conjurador. Reação contra magia: você não sofre dano e quem lançou recebe parte dele.', actionText: 'Reflexão Completa', gif: 'espelho_reflexao_completa.gif', grimoire: 'espelho', magic: true,
    type: 'reaction', kind: 'reflect', reflect: 0.5, onlyVsMagic: true, manaCost: 40, emoji: '🪞',
    minLevel: 10, after: 'raio_refletido',
    // Rank II: devolve mais
    ranks: [
      { minLevel: 26, reflect: 0.65 },
    ],
  },
  // Espelhos refletem a luz uns nos outros: acerta o alvo e quem está entre os espelhos (perto dele)
  refrao_de_reflexao: {
    id: 'refrao_de_reflexao', name: 'Refrão de Reflexão', description: 'Manifesta vários espelhos que refletem a luz uns nos outros e destroem tudo o que estiver entre eles. Ataque de longo alcance que também acerta quem está perto do alvo.', actionText: 'Refrão de Reflexão', gif: 'espelho_refrao_de_reflexao.gif', grimoire: 'espelho', magic: true,
    type: 'attack', range: 5, damage: [10, 15], attribute: 'magiaOfensiva', manaCost: 32, cooldown: 2, splash: { radius: 1, share: 0.5 },
    minLevel: 12, after: 'raio_refletido',
    // Rank II: mais espelhos, mais dano
    ranks: [
      { minLevel: 26, damage: [13, 19] },
    ],
  },
  // Esquiva por espelho: some na frente do golpe e reaparece colado no atacante
  mudanca_de_espelhos: {
    id: 'mudanca_de_espelhos', name: 'Mudança de Espelhos', description: 'Invoca um espelho num ponto que quiser e aparece na hora em frente a ele, esquivando o ataque ou ganhando uma posição melhor. Reação de esquiva; se der certo, você reaparece colado em quem atacou.', actionText: 'Mudança de Espelhos', gif: 'espelho_mudanca_de_espelhos.gif', grimoire: 'espelho', magic: true,
    type: 'reaction', kind: 'dodge', chance: 0.55, blink: 5, blinkTo: 'attacker', manaCost: 24, emoji: '🪞',
    blinkText: (me, foe) => `🪞 ${me.name} sumiu num espelho e reapareceu bem ao lado de ${foe.name}.`,
    minLevel: 16, after: 'magia_de_espelhos',
    // Rank II: esquiva mais fácil
    ranks: [
      { minLevel: 30, chance: 0.65 },
    ],
  },
  // Espelho grande: raio enorme, mais dano e mais difícil de esquivar, mas gasta muita mana
  raio_de_reflexao_grande: {
    id: 'raio_de_reflexao_grande', name: 'Raio de Reflexão Grande', description: 'Manifesta um grande espelho e dispara dele um grande raio de luz no alvo. O espelho ampliado pede mais magia: dano alto, longo alcance e difícil de esquivar, mas custa caro.', actionText: 'Raio de Reflexão Grande', gif: 'espelho_raio_de_reflexao_grande.gif', grimoire: 'espelho', magic: true,
    type: 'attack', range: 6, damage: [16, 23], attribute: 'magiaOfensiva', manaCost: 46, cooldown: 3, dodgePenalty: 0.2,
    minLevel: 18, after: 'raio_refletido',
    // Rank II: espelho ainda maior
    ranks: [
      { minLevel: 32, damage: [20, 28] },
    ],
  },
  // O reflexo sai do espelho: luta sozinho no mapa e repete as suas magias (mais dano); libera o Refrão de Reflexão Dupla
  duplicata_real: {
    id: 'duplicata_real', name: 'Duplicata Real', description: 'Manifesta um espelho e invoca dele o seu reflexo, com tudo invertido. O clone usa as mesmas magias que você: aparece no mapa e luta sozinho até ser destruído, e enquanto ele existir seus golpes ficam mais fortes e o Refrão de Reflexão Dupla fica liberado.', actionText: 'Duplicata Real', gif: 'espelho_duplicata_real.gif', grimoire: 'espelho', magic: true,
    type: 'bonus', manaCost: 45, cooldown: 5, attribute: 'magiaOfensiva',
    summon: {
      count: 1, hp: 30, damage: [5, 8], share: 0.4, label: 'Reflexo', look: 'espelho', emoji: '🪞', linkedActive: { id: 'duplicata_real', name: 'Duplicata Real', emoji: '🪞', mods: { damageBonus: 4 } },
      text: (owner, n, hp) => (n
        ? `🪞 O reflexo de ${owner.name} saiu do espelho, com ${hp} de vida. Ele luta sozinho até ser destruído.`
        : `🪞 Não havia espaço livre para o reflexo de ${owner.name} sair do espelho.`),
    },
    minLevel: 22, after: 'raio_refletido',
    // Rank II: o reflexo bate mais forte e aguenta mais
    ranks: [
      { minLevel: 34, summon: {
        count: 1, hp: 45, damage: [7, 11], share: 0.4, label: 'Reflexo', look: 'espelho', emoji: '🪞', linkedActive: { id: 'duplicata_real', name: 'Duplicata Real', emoji: '🪞', mods: { damageBonus: 4 } },
        text: (owner, n, hp) => (n
          ? `🪞 O reflexo de ${owner.name} saiu do espelho, com ${hp} de vida. Ele luta sozinho até ser destruído.`
          : `🪞 Não havia espaço livre para o reflexo de ${owner.name} sair do espelho.`),
      } },
    ],
  },
  // Série de espelhos grandes ao seu redor: a luz refletida atinge todos os inimigos por perto
  refrao_de_reflexao_grande: {
    id: 'refrao_de_reflexao_grande', name: 'Refrão de Reflexão Grande', description: 'Manifesta uma série de grandes espelhos que refletem luz mágica uns nos outros e destroem tudo o que estiver entre eles. Os espelhos ampliados pedem mais magia: atinge todos os inimigos ao seu redor.', actionText: 'Refrão de Reflexão Grande', gif: 'espelho_refrao_de_reflexao_grande.gif', grimoire: 'espelho', magic: true,
    type: 'bonus', usesAttack: true, manaCost: 58, cooldown: 4, area: { radius: 4 }, damage: [13, 19], attribute: 'magiaOfensiva',
    minLevel: 30, after: 'refrao_de_reflexao',
    use(battle, user) {
      const lines = [`🪞 Os grandes espelhos de ${user.name} refletiram a luz uns nos outros.`];
      for (const foe of foesInArea(battle, user, this.area.radius)) {
        lines.push(`✨ ${foe.name} foi atingido pela luz refletida (**${hitWithMagic(this, user, foe)}** de dano).`, ...fx.onHit(foe));
      }
      lines.push(...hitSummonsInArea(this, battle, user, this.area.radius));
      return lines.join(NL);
    },
  },
  // Com a Duplicata Real ativa: o dobro de espelhos, médio alcance e dano muito alto em volta do alvo
  refrao_de_reflexao_dupla: {
    id: 'refrao_de_reflexao_dupla', name: 'Refrão de Reflexão Dupla', description: 'Com a Duplicata Real ativa, você e o reflexo manifestam o dobro de espelhos do Refrão de Reflexão, e a luz refletida destrói tudo o que estiver entre eles. Médio alcance, dano muito alto, e acerta também quem está perto do alvo.', actionText: 'Refrão de Reflexão Dupla', gif: 'espelho_refrao_de_reflexao_dupla.gif', grimoire: 'espelho', magic: true,
    type: 'attack', range: 3, damage: [20, 28], attribute: 'magiaOfensiva', manaCost: 52, cooldown: 3, splash: { radius: 1, share: 0.6 },
    requiresActive: 'duplicata_real',
    minLevel: 34, after: 'duplicata_real',
  },
};

const TYPE_LABEL = { attack: 'Ataque', bonus: 'Ação bônus', reaction: 'Reação' };
// Rótulo de uma habilidade: magias ofensivas que agem na hora (`usesAttack`) aparecem como Ataque, pois gastam a ação de ataque
const typeLabel = a => (a.usesAttack ? TYPE_LABEL.attack : TYPE_LABEL[a.type]);

const getAbility = id => abilities[id];

// A habilidade no rank do jogador: os campos de cada rank até ele sobrescrevem os da habilidade base
// (os `ranks` aplicam de forma acumulada: o rank 3 parte do que o rank 2 já mudou).
function resolveAbility(ability, rank = 1) {
  if (!ability || rank <= 1 || !ability.ranks) return ability && { ...ability, rank: 1 };
  const { minLevel, cost, ...changes } = Object.assign({}, ...ability.ranks.slice(0, rank - 1));
  return { ...ability, ...changes, rank: Math.min(rank, ability.ranks.length + 1) };
}

module.exports = { abilities, getAbility, resolveAbility, TYPE_LABEL, typeLabel };
