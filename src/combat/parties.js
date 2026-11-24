// Parties: grupos de jogadores que lutam juntos (o mesmo time) numa batalha. Ficam só na memória (somem se o bot reiniciar).
// Cada jogador está em no máximo uma party. O líder é quem desafia e aceita desafios pela party.
const { PARTY_MAX_SIZE } = require('./config');

const parties = new Map(); // id da party -> { id, leaderId, members: [userId] }
const partyOf = new Map(); // userId -> party
let nextId = 1;

const getParty = userId => partyOf.get(userId);

function createParty(leaderId) {
  if (partyOf.has(leaderId)) return { error: 'Você já está em uma party. Saia dela antes de criar outra.' };
  const party = { id: nextId++, leaderId, members: [leaderId] };
  parties.set(party.id, party);
  partyOf.set(leaderId, party);
  return { party };
}

function addMember(party, userId) {
  if (partyOf.has(userId)) return { error: 'Essa pessoa já está em uma party.' };
  if (party.members.length >= PARTY_MAX_SIZE) return { error: `A party está cheia (máximo ${PARTY_MAX_SIZE} jogadores).` };
  party.members.push(userId);
  partyOf.set(userId, party);
  return { party };
}

function disband(party) {
  for (const id of party.members) partyOf.delete(id);
  parties.delete(party.id);
}

// Tira alguém da party. Se era o líder, o próximo membro assume; se ficou vazia, ela é desfeita.
// Retorna { party, disbanded, newLeaderId }
function removeMember(party, userId) {
  party.members = party.members.filter(id => id !== userId);
  partyOf.delete(userId);
  if (!party.members.length) { parties.delete(party.id); return { party, disbanded: true }; }
  let newLeaderId = null;
  if (party.leaderId === userId) { party.leaderId = party.members[0]; newLeaderId = party.leaderId; }
  return { party, disbanded: false, newLeaderId };
}

module.exports = { getParty, createParty, addMember, removeMember, disband };
