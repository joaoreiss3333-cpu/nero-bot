// Fichas dos jogadores salvas em data/players.json (sobrevivem a reinícios do bot).
const fs = require('fs');
const path = require('path');
const { newProfile } = require('./progression');

const FILE = path.join(__dirname, '..', '..', 'data', 'players.json');

let profiles = {};
try {
  profiles = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch (err) {
  if (err.code !== 'ENOENT') console.error('Não foi possível ler as fichas:', err.message);
}

// Grava num arquivo temporário e renomeia, para uma queda no meio não corromper as fichas
function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(profiles, null, 2));
  fs.renameSync(`${FILE}.tmp`, FILE);
}

// Devolve a ficha do jogador (criando uma nova no primeiro acesso). Depois de alterá-la, chame save().
function getProfile(userId) {
  if (!profiles[userId]) {
    profiles[userId] = newProfile();
    save();
  }
  // Atributos novos adicionados no futuro entram zerados nas fichas antigas
  profiles[userId].attrs = { ...newProfile().attrs, ...profiles[userId].attrs };
  return profiles[userId];
}

module.exports = { getProfile, save };
