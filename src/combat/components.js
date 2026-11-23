const { handleChallenge } = require('./challenge');
const { handlePlacement } = require('./placement');
const { handleButton } = require('./panel');
const { handleFicha } = require('../ficha');

// Direciona botões e formulários (modais) para o módulo certo, pelo prefixo do customId
async function handleComponent(interaction) {
  const id = interaction.customId;
  if (id.startsWith('ch:')) return handleChallenge(interaction);
  if (id.startsWith('fc:')) return handleFicha(interaction);
  if (id.startsWith('pl:')) return handlePlacement(interaction);
  if (interaction.isButton()) return handleButton(interaction);
}

module.exports = { handleComponent };
