// Login com Discord (OAuth2) e sessão em cookie assinado (sem banco de dados: o cookie guarda quem é o usuário).
// Precisa no .env: DISCORD_CLIENT_SECRET e SITE_URL (ex: http://localhost:3000). O link
// `${SITE_URL}/auth/callback` precisa estar cadastrado em Developer Portal -> OAuth2 -> Redirects.
const crypto = require('crypto');

const COOKIE = 'sid';
const STATE_COOKIE = 'oauth_state';
const SESSION_DAYS = 30;

const siteUrl = () => (process.env.SITE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
const redirectUri = () => `${siteUrl()}/auth/callback`;
// O ID do app é a primeira parte do token, como no deploy-commands.js
const clientId = () => process.env.DISCORD_CLIENT_ID || Buffer.from(process.env.DISCORD_TOKEN.split('.')[0], 'base64').toString();

let secret = process.env.SESSION_SECRET;
if (!secret) {
  secret = crypto.randomBytes(32).toString('hex');
  console.warn('[site] SESSION_SECRET não definido no .env: os logins vão cair sempre que o bot reiniciar.');
}

const sign = value => crypto.createHmac('sha256', secret).update(value).digest('base64url');

function encodeSession(data) {
  const body = Buffer.from(JSON.stringify(data)).toString('base64url');
  return `${body}.${sign(body)}`;
}

function decodeSession(raw) {
  if (!raw) return null;
  const [body, sig] = raw.split('.');
  if (!body || !sig) return null;
  const expected = sign(body);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

function readCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(c => {
    const i = c.indexOf('=');
    return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
  }));
}

const secure = () => siteUrl().startsWith('https://');
const cookieOpts = maxAge => ({ httpOnly: true, sameSite: 'lax', secure: secure(), maxAge, path: '/' });

// Coloca req.user ({ id, username, avatar }) quando o cookie de sessão é válido
function sessionMiddleware(req, res, next) {
  req.cookies = readCookies(req);
  req.user = decodeSession(req.cookies[COOKIE]);
  next();
}

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Faça login com o Discord.' });
  next();
}

function mount(app) {
  app.get('/auth/login', (req, res) => {
    if (!process.env.DISCORD_CLIENT_SECRET) return res.status(500).send('Login desativado: defina DISCORD_CLIENT_SECRET no .env.');
    const state = crypto.randomBytes(16).toString('hex');
    res.cookie(STATE_COOKIE, state, cookieOpts(10 * 60 * 1000));
    const params = new URLSearchParams({
      client_id: clientId(), redirect_uri: redirectUri(), response_type: 'code', scope: 'identify', state, prompt: 'none',
    });
    res.redirect(`https://discord.com/oauth2/authorize?${params}`);
  });

  app.get('/auth/callback', async (req, res) => {
    const { code, state } = req.query;
    if (!code || !state || state !== req.cookies[STATE_COOKIE]) return res.redirect('/?erro=login');
    res.clearCookie(STATE_COOKIE, { path: '/' });
    try {
      const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId(), client_secret: process.env.DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code', code, redirect_uri: redirectUri(),
        }),
      });
      if (!tokenRes.ok) throw new Error(`token: ${tokenRes.status} ${await tokenRes.text()}`);
      const { access_token } = await tokenRes.json();
      const userRes = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${access_token}` } });
      if (!userRes.ok) throw new Error(`usuário: ${userRes.status}`);
      const u = await userRes.json();
      const session = { id: u.id, username: u.global_name || u.username, avatar: u.avatar, exp: Date.now() + SESSION_DAYS * 864e5 };
      res.cookie(COOKIE, encodeSession(session), cookieOpts(SESSION_DAYS * 864e5));
      res.redirect('/#/perfil');
    } catch (err) {
      console.error('[site] Falha no login com Discord:', err.message);
      res.redirect('/?erro=login');
    }
  });

  app.post('/auth/logout', (req, res) => {
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });
}

module.exports = { mount, sessionMiddleware, requireUser };
