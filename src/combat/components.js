const { handleChallenge } = require('./challenge');
const { handlePlacement } = require('./placement');
const { handleButton } = require('./panel');
const { handlePartyInvite } = require('./partyInvites');
const { handleFicha } = require('../ficha');

// Direciona botões e formulários (modais) para o módulo certo, pelo prefixo do customId
async function handleComponent(interaction) {
  const id = interaction.customId;
  if (id.startsWith('ch:')) return handleChallenge(interaction);
  if (id.startsWith('pt:')) return handlePartyInvite(interaction);
  if (id.startsWith('fc:')) return handleFicha(interaction);
  if (id.startsWith('pl:')) return handlePlacement(interaction);
  if (id.startsWith('rs:')) return require('../../commands/resetar').handleReset(interaction); // confirmação do /resetar
  if (interaction.isButton()) return handleButton(interaction);
}

module.exports = { handleComponent };
