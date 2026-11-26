// Trevos do grimório: além do tipo e da raridade, todo grimório tem 3, 4 ou 5 folhas (profile.clovers, definido pela staff no
// /grimorio; sem valor = 3). As folhas multiplicam a força das magias DO PRÓPRIO grimório (dano, defesa, cura, invocações):
// config.CLOVER_MULT. O de 5 folhas tem a mesma força do de 4; o que o diferencia é a ligação com a magia de demônio (a definir).
const C = require('./config');
const { getGrimoire } = require('./grimoires');

const CLOVER_COUNTS = [3, 4, 5];
const DEFAULT_CLOVERS = 3;

const cloversOf = holder => (CLOVER_COUNTS.includes(holder?.clovers) ? holder.clovers : DEFAULT_CLOVERS);
const cloverName = n => `Trevo de ${n} folhas`;

// Multiplicador das folhas para `ability` nas mãos de `user` (jogador da batalha). Só vale para magias do grimório de quem lança:
// uma magia copiada de outro grimório não ganha as folhas de quem copiou.
const cloverMult = (user, ability) =>
  (ability?.grimoire && !ability.copied && ability.grimoire === user?.grimoire ? C.CLOVER_MULT[cloversOf(user)] ?? 1 : 1);

// Escala do bônus de atributo: `attributeScale` da habilidade, ou a da raridade do grimório dela, ou 1
const rarityScale = ability => ability.attributeScale ?? C.RARITY_SCALE[getGrimoire(ability.grimoire)?.rarity] ?? 1;

// Bônus de atributo da habilidade: atributo × multiplicador do atributo (`perPoint`: DAMAGE_PER_POINT ou DEFENSE_PER_POINT) × escala da raridade
const attributeBonus = (user, ability, perPoint = C.DAMAGE_PER_POINT) =>
  Math.round((user.attrs[ability.attribute] ?? 0) * (perPoint[ability.attribute] ?? 0) * rarityScale(ability));

const rollRange = ([min, max]) => min + Math.floor(Math.random() * (max - min + 1));

// Força de uma magia de cura/restauração: valor sorteado em `range` + bônus de atributo, tudo × as folhas do grimório
const rollPower = (user, ability, range) => Math.round((rollRange(range) + attributeBonus(user, ability)) * cloverMult(user, ability));

module.exports = { CLOVER_COUNTS, DEFAULT_CLOVERS, cloversOf, cloverName, cloverMult, rarityScale, attributeBonus, rollPower };
