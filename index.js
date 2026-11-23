require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, Collection, Events, GatewayIntentBits } = require('discord.js');
const { handleComponent } = require('./src/combat/components');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

for (const file of fs.readdirSync(path.join(__dirname, 'commands')).filter(f => f.endsWith('.js'))) {
  const command = require(`./commands/${file}`);
  client.commands.set(command.data.name, command);
}

client.once(Events.ClientReady, c => console.log(`Online como ${c.user.tag}`));

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isAutocomplete()) {
    try {
      await client.commands.get(interaction.commandName)?.autocomplete?.(interaction);
    } catch (err) {
      console.error(err);
    }
    return;
  }
  const command = interaction.isChatInputCommand() ? client.commands.get(interaction.commandName) : null;
  const isComponent = interaction.isButton() || interaction.isModalSubmit();
  if (!command && !isComponent) return;
  try {
    if (command) await command.execute(interaction);
    else await handleComponent(interaction);
  } catch (err) {
    console.error(err);
    const msg = { content: 'Ocorreu um erro ao executar o comando.', ephemeral: true };
    try {
      if (interaction.replied || interaction.deferred) await interaction.followUp(msg);
      else await interaction.reply(msg);
    } catch (replyErr) {
      console.error('Não foi possível avisar o usuário do erro:', replyErr.message);
    }
  }
});

// Um erro isolado não deve derrubar o bot
client.on(Events.Error, err => console.error('Erro do client:', err));
process.on('unhandledRejection', err => console.error('Promise rejeitada:', err));

client.login(process.env.DISCORD_TOKEN);
