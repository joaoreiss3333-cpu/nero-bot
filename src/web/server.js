// Site do servidor: roda no MESMO processo do bot, então lê e grava as mesmas fichas em memória
// (nada de dois programas escrevendo no players.json ao mesmo tempo).
const fs = require('fs');
const path = require('path');
const express = require('express');
const { profileCard, grimoireImagePath } = require('../combat/profileView');
const auth = require('./auth');
const { getProfile, save } = require('../combat/profiles');
const { getAbility } = require('../combat/abilities');
const { learn } = require('../combat/characters');
const { inAnyBattle } = require('../combat/battle');
const view = require('./serialize');

const ROOT = path.join(__dirname, '..', '..');

function start() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));
  app.use(auth.sessionMiddleware);
  auth.mount(app);

  // ---- API pública (guia e catálogo) ----
  app.get('/api/guia', (req, res) => res.json(view.guide()));
  app.get('/api/grimorios', (req, res) => res.json(view.catalog()));

  // ---- API do jogador logado ----
  app.get('/api/me', (req, res) => {
    if (!req.user) return res.json({ user: null });
    res.json(view.playerProfile(getProfile(req.user.id), req.user));
  });

  // Aparência do personagem (a imagem da ficha); sem ficha com imagem, o avatar do Discord
  app.get('/api/me/retrato', auth.requireUser, (req, res) => {
    const file = getProfile(req.user.id).portraitUrl;
    if (file && fs.existsSync(file)) return res.sendFile(file, { maxAge: 0 });
    if (req.user.avatar) return res.redirect(`https://cdn.discordapp.com/avatars/${req.user.id}/${req.user.avatar}.png?size=512`);
    res.status(404).end();
  });

  // O mesmo card do /perfil, em PNG
  app.get('/api/me/card.png', auth.requireUser, async (req, res) => {
    try {
      const { id, username, avatar } = req.user;
      const png = await profileCard(getProfile(id), {
        fallbackName: username,
        avatarUrl: avatar ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.png?size=512` : null,
      });
      res.set('Cache-Control', 'no-store').type('png').send(png);
    } catch (err) {
      console.error('[site] card do perfil:', err);
      res.status(500).end();
    }
  });

  app.get('/api/arvore', auth.requireUser, (req, res) => {
    res.json({ tree: view.playerTree(getProfile(req.user.id)) });
  });

  app.post('/api/arvore/comprar', auth.requireUser, (req, res) => {
    const ability = getAbility(String(req.body?.id ?? ''));
    if (!ability) return res.status(404).json({ error: 'Magia não encontrada.' });
    if (inAnyBattle(req.user.id)) return res.status(409).json({ error: 'Você não pode aprender magias no meio de uma batalha.' });
    const profile = getProfile(req.user.id);
    if (!profile.grimoire) return res.status(400).json({ error: 'Você ainda não tem um grimório. Peça à staff para definir o seu.' });
    const { error, rank, cost } = learn(profile, ability);
    if (error) return res.status(400).json({ error: `Não dá para comprar ${ability.name} agora: ${error.replace(/\*\*/g, '')}.` });
    save();
    res.json({ rank, cost, tree: view.playerTree(profile) });
  });

  // Capa de um grimório (assets/grimoires/<id>.png|jpg...), quando existir
  app.get('/api/grimorios/:id/capa', (req, res) => {
    const file = grimoireImagePath(String(req.params.id).replace(/[^a-z0-9_]/gi, ''));
    if (!file) return res.status(404).end();
    res.sendFile(file, { maxAge: '1d' });
  });

  // ---- Arquivos ----
  app.use('/gifs', express.static(path.join(ROOT, 'assets', 'gifs'), { maxAge: '7d' }));
  app.use(express.static(path.join(ROOT, 'site')));

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => console.log(`[site] No ar em http://localhost:${port}`));
}

module.exports = { start };
