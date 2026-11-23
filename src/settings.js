// Configurações do servidor guardadas em data/settings.json (ex: canal de criação de ficha)
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'settings.json');
let settings = {};
try {
  settings = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch (err) {
  if (err.code !== 'ENOENT') console.error('Não foi possível ler as configurações:', err.message);
}

const getSetting = key => settings[key];
function setSetting(key, value) {
  settings[key] = value;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(settings, null, 2));
}

module.exports = { getSetting, setSetting };
