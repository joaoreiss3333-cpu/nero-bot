// Links do site para as mensagens do bot. Só aparecem quando o SITE_URL está no .env (um localhost não serve para os outros
// jogadores); sem ele, a mensagem só cita a página.
const siteUrl = () => process.env.SITE_URL?.replace(/\/$/, '') || null;

// "na **Árvore de Habilidades** do site" (+ o link, se houver): onde se compram as magias
const treeHint = () => `na **Árvore de Habilidades** do site${siteUrl() ? ` (${siteUrl()}/#/arvore)` : ''}`;

module.exports = { siteUrl, treeHint };
