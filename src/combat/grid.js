const { COLUMNS, ROWS } = require('./config');

// "C3" -> { col: 2, row: 2 }; retorna null se for inválido ou estiver fora do mapa
function parseCoord(text) {
  const m = /^([A-Za-z])(\d{1,2})$/.exec(String(text).trim());
  if (!m) return null;
  const col = COLUMNS.indexOf(m[1].toUpperCase());
  const row = Number(m[2]) - 1;
  if (col < 0 || row < 0 || row >= ROWS) return null;
  return { col, row };
}

const formatCoord = ({ col, row }) => `${COLUMNS[col]}${row + 1}`;

// Sem diagonais: a distância é a soma dos passos horizontais e verticais
const distance = (a, b) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row);

const samePos = (a, b) => a.col === b.col && a.row === b.row;

const DIRECTIONS = {
  up: { dc: 0, dr: -1 },
  down: { dc: 0, dr: 1 },
  left: { dc: -1, dr: 0 },
  right: { dc: 1, dr: 0 },
};

module.exports = { parseCoord, formatCoord, distance, samePos, DIRECTIONS };
