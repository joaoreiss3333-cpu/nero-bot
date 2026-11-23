require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

const token = process.env.DISCORD_TOKEN;
// O ID do cliente é a primeira parte do token, decodificada de base64
const clientId = Buffer.from(token.split('.')[0], 'base64').toString();

const commands = fs
  .readdirSync(path.join(__dirname, 'commands'))
  .filter(f => f.endsWith('.js'))
  .map(f => require(`./commands/${f}`).data.toJSON());

new REST().setToken(token)
  .put(Routes.applicationCommands(clientId), { body: commands })
  .then(d => console.log(`${d.length} comando(s) registrado(s).`))
  .catch(console.error);
