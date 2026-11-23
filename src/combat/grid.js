const { COLUMNS } = require('./config');

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

module.exports = { formatCoord, distance, samePos, DIRECTIONS };
