// Catálogo de habilidades. Cada uma tem um `type`:
//   attack   -> gasta a ação de ataque do turno (usada com /habilidade)
//   bonus    -> gasta a ação bônus do turno (usada com /habilidade); precisa de `use(battle, user)` que retorna o log
//   reaction -> usada pelo defensor quando é atacado (aparece como botão)
// Reações têm um `kind` ('dodge', 'block' ou 'capture') que define como são resolvidas.
// Defesas `block` usam `absorb: [mín, máx]` + `attribute` (resistencia, magiaDefensiva...) e escalam como um ataque
// (valor sorteado + atributo × config.DEFENSE_PER_POINT); `attributeScale` reforça o bônus do atributo.
// `energyCost` é a energia gasta ao usar a habilidade. Magias usam `manaCost` no lugar (gastam mana, não energia).
// Ataques causam um dano sorteado em `damage: [mín, máx]` + atributo × multiplicador (config.DAMAGE_PER_POINT);
// `attribute` diz qual atributo conta. A árvore de habilidades vai melhorar esse intervalo.
// `requires: { magiaOfensiva: 3 }` exige pontos nesse atributo para a habilidade aparecer.
//
// Efeitos de combate (catálogo em effects.js):
//   applies -> lista de efeitos que a habilidade aplica: { effect: 'sangramento', turns: 3, stacks: 1, power: 2, to: 'enemy'|'self', chance: 0.5 }
//              (só `effect` é obrigatório; ataque aplica no alvo se causar dano, ação bônus aplica em quem usou; `to` muda isso)
//   magic    -> true se for uma magia (reações como Chrono Stasis Grigora só funcionam contra magia)
//   cooldown -> turnos seus até poder usar de novo (1ª vez livre)
//   grimoire -> id do grimório (grimoires.js) a que a habilidade pertence; quem tem esse grimório recebe a habilidade no kit
//   element -> elemento do golpe ('fogo', 'gelo', 'relampago'...), usado nas interações (Encharcado, Congelado)
//
//   attributeScale -> multiplica o bônus de dano do atributo (padrão 1); magias fortes usam valores maiores, e o Tempo (mítico) usa 2.5
//
// Campos opcionais para o aviso da ação (o embed "X utilizou ..." com o GIF):
//   actionText -> como a ação aparece no título, ex: "um Soco" (padrão: o nome)
//   gif        -> URL do GIF, ou nome de um arquivo da pasta assets/gifs (ex: 'soco.gif').
//                 Sem GIF, o aviso aparece só com o título.
//   gifDurationMs -> quanto o jogo espera esse GIF rodar (padrão: ACTION_GIF_WAIT_MS)
const fx = require('./effects');
const NL = '\n';

const abilities = {
  soco: { id: 'soco', name: 'Soco', actionText: 'um Soco', gif: 'soco.gif', type: 'attack', range: 1, damage: [2, 4], attribute: 'forca', energyCost: 10 },

  esquiva: { id: 'esquiva', name: 'Esquiva', type: 'reaction', kind: 'dodge', chance: 0.5, energyCost: 15, emoji: '💨' }, // 50% (+ Destreza) de evitar todo o dano
  bloqueio: { id: 'bloqueio', name: 'Bloqueio', type: 'reaction', kind: 'block', absorb: [1, 2], attribute: 'resistencia', energyCost: 10, emoji: '🛡️' }, // absorve um valor sorteado (1-2) + Resistência × 0,5

  // ---- Grimório do Tempo ----
  // Grimório MÍTICO: a magia de ataque mais forte do servidor. Dano bem acima do Soco e prende o alvo em Estase Temporal (imóvel e sem reação, ainda pode atacar)
  chrono_stasis: {
    id: 'chrono_stasis', name: 'Chrono Stasis', actionText: 'Chrono Stasis', gif: 'chrono_stasis.gif', grimoire: 'tempo', magic: true,
    type: 'attack', range: 3, damage: [8, 12], attributeScale: 2.5, attribute: 'magiaOfensiva', manaCost: 25,
    requires: { magiaOfensiva: 3 }, applies: [{ effect: 'estase', turns: 3 }],
  },
  // Captura a magia inimiga (ela é anulada) e prende quem a lançou em Estase Temporal. Só funciona contra magia.
  chrono_stasis_grigora: {
    id: 'chrono_stasis_grigora', name: 'Chrono Stasis Grigora', actionText: 'Chrono Stasis Grigora', gif: 'chrono_stasis_grigora.gif', grimoire: 'tempo',
    type: 'reaction', kind: 'capture', onlyVsMagic: true, manaCost: 30, emoji: '🕰️',
    requires: { magiaDefensiva: 3 }, applies: [{ effect: 'estase', turns: 3 }],
  },
  // Volta no tempo: a vida retorna ao que era no início do seu turno anterior e os debuffs somem
  chrono_anastasis: {
    id: 'chrono_anastasis', name: 'Chrono Anastasis', actionText: 'Chrono Anastasis', gif: 'chrono_anastasis.gif', grimoire: 'tempo', magic: true,
    type: 'bonus', manaCost: 30, cooldown: 3, requires: { magiaSuplementar: 3 },
    use(battle, user) {
      const target = Math.max(user.hp, user.hpHistory[0] ?? user.hp);
      const healed = target - user.hp;
      user.hp = target;
      user.mana = Math.min(user.maxMana, user.mana + 15); // o tempo volta também para a mana gasta (reembolsa metade do custo)
      const cleared = fx.clearDebuffs(user);
      let text = `⏪ ${user.name} usou **Chrono Anastasis** e voltou no tempo.`;
      text += healed > 0 ? `${NL}❤️ Recuperou **${healed}** de vida.` : `${NL}Nenhum dano para desfazer.`;
      if (cleared.length) text += `${NL}✨ Removeu: ${cleared.join(', ')}.`;
      text += `${NL}🔷 Recuperou 15 de mana.`;
      return text;
    },
  },
};

const TYPE_LABEL = { attack: 'Ataque', bonus: 'Ação bônus', reaction: 'Reação' };

const getAbility = id => abilities[id];

module.exports = { abilities, getAbility, TYPE_LABEL };
