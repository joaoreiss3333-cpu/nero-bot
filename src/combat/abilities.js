// Catálogo de habilidades. Cada uma tem um `type`:
//   attack   -> gasta a ação de ataque do turno (usada com /habilidade)
//   bonus    -> gasta a ação bônus do turno (usada com /habilidade); precisa de `use(battle, user)` que retorna o log
//   reaction -> usada pelo defensor quando é atacado (aparece como botão)
// Reações têm um `kind` ('dodge' ou 'block') que define como são resolvidas.
// `energyCost` é a energia gasta ao usar a habilidade.
// Ataques causam um dano sorteado em `damage: [mín, máx]` + atributo × multiplicador (config.DAMAGE_PER_POINT);
// `attribute` diz qual atributo conta. A árvore de habilidades vai melhorar esse intervalo.
// `requires: { magiaOfensiva: 3 }` exige pontos nesse atributo para a habilidade aparecer.
//
// Campos opcionais para o aviso da ação (o embed "X utilizou ..." com o GIF):
//   actionText -> como a ação aparece no título, ex: "um Soco" (padrão: o nome)
//   gif        -> URL do GIF, ou nome de um arquivo da pasta assets/gifs (ex: 'soco.gif').
//                 Sem GIF, o aviso aparece só com o título.
//   gifDurationMs -> quanto o jogo espera esse GIF rodar (padrão: ACTION_GIF_WAIT_MS)
const abilities = {
  soco: { id: 'soco', name: 'Soco', actionText: 'um Soco', gif: 'soco.gif', type: 'attack', range: 1, damage: [2, 4], attribute: 'forca', energyCost: 10 },

  esquiva: { id: 'esquiva', name: 'Esquiva', type: 'reaction', kind: 'dodge', chance: 0.5, energyCost: 15, emoji: '💨' }, // 50% (+ Destreza) de evitar todo o dano
  bloqueio: { id: 'bloqueio', name: 'Bloqueio', type: 'reaction', kind: 'block', absorb: 0.4, energyCost: 10, emoji: '🛡️' }, // absorve 40% do dano (+ Resistência)
};

const TYPE_LABEL = { attack: 'Ataque', bonus: 'Ação bônus', reaction: 'Reação' };

const getAbility = id => abilities[id];

module.exports = { abilities, getAbility, TYPE_LABEL };
