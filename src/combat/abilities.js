// Catálogo de habilidades. Cada uma tem um `type`:
//   attack   -> gasta a ação de ataque do turno (usada com /habilidade)
//   bonus    -> gasta a ação bônus do turno (usada com /habilidade); precisa de `use(battle, user)` que retorna o log
//   reaction -> usada pelo defensor quando é atacado (aparece como botão)
// Reações têm um `kind` ('dodge' ou 'block') que define como são resolvidas.
// `energyCost` é a energia gasta ao usar a habilidade.
const abilities = {
  soco: { id: 'soco', name: 'Soco', type: 'attack', range: 1, damage: [4, 8], energyCost: 10 },

  esquiva: { id: 'esquiva', name: 'Esquiva', type: 'reaction', kind: 'dodge', chance: 0.5, energyCost: 15, emoji: '💨' }, // 50% de evitar todo o dano
  bloqueio: { id: 'bloqueio', name: 'Bloqueio', type: 'reaction', kind: 'block', absorb: 6, energyCost: 10, emoji: '🛡️' }, // absorve até 6 de dano
};

const TYPE_LABEL = { attack: 'Ataque', bonus: 'Ação bônus', reaction: 'Reação' };

const getAbility = id => abilities[id];

module.exports = { abilities, getAbility, TYPE_LABEL };
