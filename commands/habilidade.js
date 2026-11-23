const { SlashCommandBuilder } = require('discord.js');
const { getBattle, currentPlayer, opponentOf, findPlayer, abilitiesOf } = require('../src/combat/battle');
const { panelPayload, asEdit } = require('../src/combat/render');
const { playAction } = require('../src/combat/actions');
const { getAbility, TYPE_LABEL } = require('../src/combat/abilities');
const { getKit } = require('../src/combat/characters');
const { distance } = require('../src/combat/grid');

const fail = (interaction, content) => interaction.reply({ content, ephemeral: true });

module.exports = {
  data: new SlashCommandBuilder()
    .setName('habilidade')
    .setDescription('Usa uma habilidade de ataque ou ação bônus')
    .addStringOption(o => o
      .setName('nome')
      .setDescription('Qual habilidade usar')
      .setRequired(true)
      .setAutocomplete(true)),

  // Lista as habilidades de ataque/bônus do personagem do jogador
  async autocomplete(interaction) {
    const battle = getBattle(interaction.channelId);
    const me = battle && findPlayer(battle, interaction.user.id);
    const ids = me ? me.abilities : getKit(interaction.user.id);
    const focused = interaction.options.getFocused().toLowerCase();

    const choices = ids
      .map(getAbility)
      .filter(a => a && a.type !== 'reaction' && a.name.toLowerCase().includes(focused))
      .map(a => ({ name: `${a.name} (${TYPE_LABEL[a.type]} · ${a.energyCost} energia)`, value: a.id }));
    await interaction.respond(choices.slice(0, 25));
  },

  async execute(interaction) {
    const battle = getBattle(interaction.channelId);
    if (!battle) return fail(interaction, 'Não há batalha neste canal. Use `/batalha iniciar`.');
    const me = findPlayer(battle, interaction.user.id);
    if (!me) return fail(interaction, 'Você não está nessa batalha.');
    if (battle.phase !== 'combat') return fail(interaction, 'A batalha ainda não começou. Escolha seu setor inicial no painel.');
    if (currentPlayer(battle).id !== me.id) return fail(interaction, 'Não é o seu turno.');
    if (battle.pending) return fail(interaction, 'Aguarde a reação do oponente.');

    const ability = getAbility(interaction.options.getString('nome'));
    const owned = ability && abilitiesOf(me, ability.type).some(a => a.id === ability.id);
    if (!owned || ability.type === 'reaction') return fail(interaction, 'Você não possui essa habilidade.');
    if (me.energy < ability.energyCost) {
      return fail(interaction, `Energia insuficiente: **${ability.name}** custa ${ability.energyCost} e você tem ${me.energy}.`);
    }

    if (ability.type === 'attack') {
      if (battle.turn.attacked) return fail(interaction, 'Você já usou sua ação de ataque neste turno.');
      const foe = opponentOf(battle, me.id);
      if (distance(me.pos, foe.pos) > ability.range) {
        return fail(interaction, `Alvo fora de alcance: **${ability.name}** alcança ${ability.range} casa (sem diagonal).`);
      }
      // O ataque só é resolvido quando o atacante encerra o turno (aí o defensor reage)
      battle.turn.attacked = true;
      battle.turn.queuedAttack = ability;
      me.energy -= ability.energyCost;
      await interaction.reply({ content: `✅ **${ability.name}** preparado (-${ability.energyCost} energia). Ele será executado quando você encerrar o turno.`, ephemeral: true });
      return battle.message.edit(asEdit(await panelPayload(battle, `👊 ${me.name} preparou **${ability.name}** (-${ability.energyCost} energia). O golpe acontece ao fim do turno.`)));
    }

    // bonus
    if (battle.turn.bonusUsed) return fail(interaction, 'Você já usou sua ação bônus neste turno.');
    battle.turn.bonusUsed = true;
    me.energy -= ability.energyCost;
    const text = ability.use(battle, me);
    await interaction.reply({ content: `✅ Você usou **${ability.name}**.`, ephemeral: true });
    // A ação bônus acontece na hora: o GIF roda e some sozinho, sem travar o turno
    await playAction(battle.message.channel, me.name, ability, { block: false });
    return battle.message.edit(asEdit(await panelPayload(battle, text)));
  },
};
