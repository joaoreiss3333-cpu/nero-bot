require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, Collection, Events, GatewayIntentBits } = require('discord.js');
const { handleButton } = require('./src/combat/panel');

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
  if (!command && !interaction.isButton()) return;
  try {
    if (command) await command.execute(interaction);
    else await handleButton(interaction);
  } catch (err) {
    console.error(err);
    const msg = { content: 'Ocorreu um erro ao executar o comando.', ephemeral: true };
    if (interaction.replied || interaction.deferred) await interaction.followUp(msg);
    else await interaction.reply(msg);
  }
});

client.login(process.env.DISCORD_TOKEN);
