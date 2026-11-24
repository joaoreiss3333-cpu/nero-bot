// Fichas dos jogadores salvas em data/players.json (sobrevivem a reinícios do bot).
const fs = require('fs');
const path = require('path');
const { newProfile, skillPointsForLevel } = require('./progression');

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
  profiles[userId].learned ??= [];
  profiles[userId].ranks ??= {}; // id da magia -> rank comprado (1 = a magia base)
  // Fichas de antes dos pontos de habilidade: recebem os pontos do nível menos o que já foi comprado
  // (nunca negativo: quem já tinha mais magias do que os pontos pagariam fica com elas e 0 pontos)
  if (profiles[userId].skillPoints === undefined) {
    const { spentSkillPoints } = require('./characters'); // aqui dentro para não criar dependência circular no carregamento
    profiles[userId].skillPoints = Math.max(0, skillPointsForLevel(profiles[userId].level) - spentSkillPoints(profiles[userId]));
    save();
  }
  return profiles[userId];
}

module.exports = { getProfile, save };
