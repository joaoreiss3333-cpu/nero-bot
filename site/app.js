// Site do servidor: SPA simples com rotas por hash (#/guia, #/arvore...). Os dados vêm da API do bot (/api/...).
const $app = document.getElementById('app');
let me = null; // ficha do jogador logado (ou null)

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = n => `${Math.round(n * 100)}%`;

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Erro no servidor.'), { status: res.status });
  return data;
}

function toast(msg, kind = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.className = 'toast'), 3500);
}

// ================= Desenhos (SVG) =================
// Trevo de `n` folhas. O de 5 folhas sai escuro com contorno dourado (o grimório do demônio, como no /perfil).
function clover(n = 4, { fill, stroke = '#17121c', sw = 3 } = {}) {
  const demon = n >= 5;
  const leaf = 'M0,-3 C-7,-9 -17,-13 -13,-23 C-10,-29 -2,-27 0,-21 C2,-27 10,-29 13,-23 C17,-13 7,-9 0,-3Z';
  const s = n >= 5 ? 0.86 : 1;
  const leaves = Array.from({ length: n }, (_, i) => `<path d="${leaf}" transform="rotate(${(360 / n) * i}) scale(${s})"/>`).join('');
  return `<svg viewBox="-30 -30 60 60" aria-hidden="true"><g fill="${fill ?? (demon ? '#2a1f2f' : '#f2b632')}" stroke="${demon ? '#f2b632' : stroke}" stroke-width="${sw}" stroke-linejoin="round">${leaves}</g><circle r="3.4" fill="${demon ? '#c8342c' : '#17121c'}"/></svg>`;
}

// Ícones de traço grosso (24×24): contorno de tinta + preenchimento colorido
const I = (body, fill = 'none') => `<svg viewBox="0 0 24 24" fill="${fill}" stroke="#17121c" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICONS = {
  tree: I('<path d="M12 21v-7M9 21h6"/><path d="M12 14c-4.5 0-7-2.3-7-5.2C5 6 7.6 3 12 3s7 3 7 5.8c0 2.9-2.5 5.2-7 5.2Z" fill="#3f9a55"/><path d="M12 14l-3-3M12 12l3-2.5"/>'),
  scroll: I('<path d="M6 4h11a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8" fill="#f4e7c9"/><path d="M6 4a2 2 0 0 0-2 2v2h4V6a2 2 0 0 0-2-2Z" fill="#e9d6ac"/><path d="M8 20a2 2 0 0 1-2-2v-2h4v2a2 2 0 0 1-2 2ZM10 9h6M10 12h6M10 15h4"/>'),
  book: I('<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5Z" fill="#c8342c"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3"/><path d="M12 7.5l1.2 2.3 2.3.3-1.7 1.6.4 2.3-2.2-1.2-2.2 1.2.4-2.3-1.7-1.6 2.3-.3Z" fill="#f2b632" stroke-width="1.4"/>'),
  hood: I('<path d="M12 3c-4 0-6.5 3.5-6.5 8 0 2-.6 3.8-1.5 5h16c-.9-1.2-1.5-3-1.5-5 0-4.5-2.5-8-6.5-8Z" fill="#2f7dd1"/><path d="M9 11.5c0-1.8 1.3-3 3-3s3 1.2 3 3-1.3 3-3 3-3-1.2-3-3Z" fill="#f4e7c9"/><path d="M4 16c1 2.8 4.2 5 8 5s7-2.2 8-5" fill="#2f7dd1"/>'),
  heart: I('<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z" fill="#c8342c"/><path d="M8 9.5c.3-.9 1-1.5 1.8-1.6" stroke="#fff"/>'),
  crystal: I('<path d="M12 2.5 18.5 9 12 21.5 5.5 9Z" fill="#2f7dd1"/><path d="M5.5 9h13M9 9l3 12.5M15 9l-3 12.5M9 9l3-6.5L15 9"/>'),
  bolt: I('<path d="M13.5 2.5 5 13.5h6l-1 8 8.5-11h-6Z" fill="#f2b632"/>'),
  wind: I('<path d="M3 8h10.5a2.5 2.5 0 1 0-2.4-3.2M3 12h15.5a2.5 2.5 0 1 1-2.4 3.2M3 16h8"/>'),
  cart: I('<path d="M3 4h2.5l2.2 10.5h10.6L20.5 7H7" fill="#f2b632"/><circle cx="9" cy="19" r="1.6" fill="#17121c"/><circle cx="17" cy="19" r="1.6" fill="#17121c"/>'),
  lock: I('<path d="M7 11V8a5 5 0 0 1 10 0v3"/><rect x="4.5" y="11" width="15" height="10" rx="2.5" fill="#f2b632"/><path d="M12 15v2.5"/>'),
  download: I('<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14"/>'),
};

// Selo de estrela da capa dos grimórios na estante
const STAR = '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17" fill="rgba(23,18,28,.45)" stroke="#f2b632" stroke-width="3"/><path d="M20 8l3.4 7.4 8 .9-6 5.4 1.7 7.9L20 25.5l-7.1 4.1 1.7-7.9-6-5.4 8-.9Z" fill="#f2b632" stroke="#17121c" stroke-width="2" stroke-linejoin="round"/></svg>';

// O grimório fechado da página inicial (capa com o trevo, cantoneiras e brilhos)
const heroBook = () => `
<svg viewBox="0 0 300 340" aria-hidden="true">
  <g stroke="#17121c" stroke-width="6" stroke-linejoin="round">
    <path d="M70 40h170a16 16 0 0 1 16 16v232a16 16 0 0 1-16 16H70Z" fill="#f4e7c9"/>
    <path d="M78 50h160v240H78" fill="none" stroke-width="3" stroke-dasharray="2 9"/>
    <rect x="40" y="26" width="196" height="276" rx="16" fill="#8f1f1b"/>
    <rect x="40" y="26" width="34" height="276" rx="12" fill="#5e1412"/>
    <path d="M74 26v276" />
    <path d="M40 70h34M40 258h34" stroke="#f2b632" stroke-width="7"/>
    <path d="M196 26h40v40M236 262v40h-40M114 26H90v24M90 278v24h24" fill="none" stroke="#f2b632" stroke-width="7"/>
    <circle cx="155" cy="164" r="66" fill="#2a1f2f"/>
    <circle cx="155" cy="164" r="54" fill="none" stroke="#f2b632" stroke-width="3" stroke-dasharray="4 7"/>
  </g>
  <g transform="translate(155 166) scale(1.75)">${clover(4, { sw: 2.6 }).replace(/<\/?svg[^>]*>/g, '')}</g>
  <g fill="#f2b632" stroke="#17121c" stroke-width="3" stroke-linejoin="round">
    <path d="M262 52l5 12 12 5-12 5-5 12-5-12-12-5 12-5Z"/>
    <path d="M24 196l4 9 9 4-9 4-4 9-4-9-9-4 9-4Z"/>
    <path d="M268 230l3 7 7 3-7 3-3 7-3-7-7-3 7-3Z"/>
  </g>
</svg>`;

const loginButton = () => '<a class="btn discord" href="/auth/login">Entrar com Discord</a>';
const needLogin = what => `
  <div class="card empty-state">
    ${ICONS.lock}
    <h2>Entre para ver ${what}</h2>
    <p class="muted">Use a mesma conta do Discord com que você joga no servidor.</p>
    ${loginButton()}
  </div>`;

function renderAccount() {
  const el = document.getElementById('account');
  if (!me?.user) { el.innerHTML = loginButton(); return; }
  el.innerHTML = `
    ${me.character?.portrait || me.user.avatar ? `<img class="avatar" src="${esc(me.character?.portrait ?? me.user.avatar)}" alt="">` : '<span class="avatar"></span>'}
    <span>${esc(me.character?.name ?? me.user.username)}</span>
    <button class="btn small" id="logout">Sair</button>`;
  document.getElementById('logout').onclick = async () => {
    await api('/auth/logout', { method: 'POST' });
    me = null;
    renderAccount();
    route();
  };
}

// ================= Início =================
function pageHome() {
  const who = me?.character?.name ?? me?.user?.username;
  $app.innerHTML = `
    <section class="hero">
      <div>
        <div class="kicker">${who ? `Bem-vindo de volta, ${esc(who)}` : 'RPG de batalhas no Discord'}</div>
        <h1>Desperte o seu <em>grimório</em></h1>
        <p>Batalhas táticas por turnos, num mapa em grade. Suba de nível, distribua atributos e escolha o seu
           caminho na árvore de magias do seu grimório.</p>
        <div class="actions">
          ${me?.user ? '<a class="btn primary" href="#/arvore">Abrir minha árvore</a><a class="btn" href="#/perfil">Ver minha ficha</a>' : loginButton()}
          <a class="btn" href="#/guia">Ler o guia</a>
        </div>
      </div>
      <div class="hero-art">${heroBook()}</div>
    </section>
    <div class="grid features">
      <a class="card feature" href="#/arvore"><div class="icon ico-green">${ICONS.tree}</div><h3>Árvore de magias</h3>
        <p>Gaste pontos de habilidade para aprender magias e evoluir os ranks.</p><span class="go">Abrir →</span></a>
      <a class="card feature" href="#/perfil"><div class="icon ico-blue">${ICONS.hood}</div><h3>Sua ficha</h3>
        <p>O seu personagem, com aparência, história, atributos e magias.</p><span class="go">Ver ficha →</span></a>
      <a class="card feature" href="#/grimorios"><div class="icon ico-red">${ICONS.book}</div><h3>Grimórios</h3>
        <p>Todos os grimórios do servidor, as raridades e as magias de cada um.</p><span class="go">Ver estante →</span></a>
      <a class="card feature" href="#/guia"><div class="icon ico-gold">${ICONS.scroll}</div><h3>Guia</h3>
        <p>Combate, progressão, atributos, efeitos e parties explicados.</p><span class="go">Ler →</span></a>
    </div>`;
}

// ================= Guia =================
async function pageGuide() {
  const g = await api('/api/guia');
  const steps = s => s.map(([lvl, v]) => `nível ${lvl}+: <b>${v}</b>`).join(' · ');
  const basic = g.basics.map(a => `<tr><td><b>${esc(a.name)}</b></td><td>${esc(a.typeLabel)}</td>
    <td>${a.ranks[0].resourceCost.amount} ${a.ranks[0].resourceCost.resource}</td><td>${esc(a.ranks[0].details.join(' · '))}</td></tr>`).join('');
  const sections = [
    ['comecar', 'Começando', `
      <ol>
        <li>Crie sua ficha com <code>/ficha</code> no canal de criação de fichas.</li>
        <li>Veja seu personagem com <code>/perfil</code> (ou aqui no site, em <a href="#/perfil">Perfil</a>).</li>
        <li>Distribua seus pontos de atributo com <code>/distribuir</code>.</li>
        <li>Quando a staff definir o seu grimório, compre magias na <a href="#/arvore">Árvore</a>.</li>
        <li>Desafie alguém com <code>/batalha desafiar</code>.</li>
      </ol>`],
    ['progressao', 'Progressão', `
      <p>O nível máximo é <b>${g.maxLevel}</b>. Cada nível dá <b>${g.pointsPerLevel}</b> pontos de atributo
         (você começa com ${g.startingPoints}). Você ganha <b>${g.skillPointsStart}</b> ponto de habilidade no nível 1
         e mais <b>1 a cada ${g.skillPointsEvery} níveis</b>: não dá para comprar uma árvore inteira, então escolha um caminho.</p>
      <table><tr><th>Nível</th><th>XP para o próximo</th></tr>
        ${g.xpTable.map(r => `<tr><td>${r.level}</td><td>${r.xp.toLocaleString('pt-BR')}</td></tr>`).join('')}</table>
      <h3 style="margin-top:1.2em">Vida, mana e energia</h3>
      <p>Vida: <b>${g.hp.base}</b> no nível 1, +<b>${g.hp.perLevel}</b> por nível.<br>
         Mana: ${steps(g.manaSteps)}<br>Energia: ${steps(g.energySteps)}</p>`],
    ['atributos', 'Atributos', (() => { const pct = (v, d = 0) => `${(v * 100).toFixed(d).replace('.', ',')}%`; const dexAt = d => g.dodge.max * d / (d + g.dodge.half); return `
      <p>Cada atributo vai até <b>${g.attributeCap}</b>.</p>
      <table style="margin-top:1em"><tr><th>Atributo</th><th>O que faz</th></tr>
        <tr><td><b>Força</b></td><td>Dano do Soco e dos golpes físicos.</td></tr>
        <tr><td><b>Destreza</b></td><td>Decide quem começa a batalha e soma em <b>toda</b> esquiva (normal e mágicas). Rende cada vez menos:
          30 pontos = +${pct(dexAt(30))}, 60 = +${pct(dexAt(60))}, 100 = +${pct(dexAt(100))}. A chance de esquiva nunca passa de <b>${pct(g.dodge.cap)}</b>.</td></tr>
        <tr><td><b>Resistência</b></td><td>Corta <b>${pct(g.resistPerPoint, 2)}</b> de qualquer golpe por ponto (100 pontos = ${pct(g.resistPerPoint * 100)}) e aumenta o Bloqueio.
          Somada às proteções das magias, a redução vai até ${pct(g.resistCap)}.</td></tr>
        <tr><td><b>Inteligência</b></td><td>Fabricação de itens (em breve).</td></tr>
        <tr><td><b>Armas Brancas</b></td><td>Dano com armas e magias de espada (em breve).</td></tr>
        <tr><td><b>Magia Ofensiva / Suplementar</b></td><td>Dano e cura das magias desse tipo.</td></tr>
        <tr><td><b>Magia Defensiva</b></td><td>Quanto as barreiras mágicas (reações de bloqueio) absorvem.</td></tr>
      </table>
      <p class="muted">As reações de esquiva têm recarga: a Esquiva só pode ser usada uma vez por rodada, e as esquivas mágicas precisam de mais tempo.</p>`; })()],
    ['combate', 'Combate', `
      <p>As batalhas acontecem num mapa em grade. No seu turno você primeiro se move (até <b>${g.movesPerTurn}</b> casas, sem diagonal)
         e depois age:</p>
      <ul>
        <li><b>Ataque</b>: uma por turno. O golpe é resolvido quando você encerra o turno, e aí o defensor escolhe a reação.</li>
        <li><b>Ação bônus</b>: uma por turno, acontece na hora (portais, curas, magias ativas...).</li>
        <li><b>Reação</b>: usada quando você é atacado (esquiva, bloqueio, capturas de magia...).</li>
      </ul>
      <p>Ataques gastam energia (golpes físicos) ou mana (magias). Todo ataque tem <b>${pct(g.critChance)}</b> de chance de crítico,
         que multiplica o dano por <b>${g.critMultiplier}</b>.</p>
      <h3>Habilidades de todo mundo</h3>
      <table><tr><th>Habilidade</th><th>Tipo</th><th>Custo</th><th>Detalhes</th></tr>${basic}</table>`],
    ['grimorios', 'Grimórios e raridades', `
      <p>O grimório define a sua árvore de magias. Quanto mais raro, maior a escala do bônus de atributo nas magias dele.</p>
      <table><tr><th>Raridade</th><th>Chance</th><th>Escala do atributo</th></tr>
        ${g.rarities.map(r => `<tr><td><span class="tag rar-${r.id}">${esc(r.name)}</span></td><td>${esc(r.chance)}</td><td>${g.raritiesScale[r.id]}×</td></tr>`).join('')}</table>
      <p style="margin-top:1em"><a href="#/grimorios">Ver todos os grimórios →</a></p>`],
    ['efeitos', 'Efeitos', `
      <p>Efeitos negativos que as magias colocam no alvo. São os mesmos para todos os grimórios: cada magia escolhe quais
         aplica, por quantos turnos e com que força.</p>
      <table><tr><th>Efeito</th><th>O que faz</th></tr>
        ${g.effects.map(e => `<tr><td>${e.emoji} <b>${esc(e.name)}</b></td><td>${esc(e.desc ?? '')}</td></tr>`).join('')}</table>
      <p style="margin-top:1em">Os fortalecimentos não são efeitos: são <b>magias ativas</b>. Cada magia diz o que dá enquanto
         estiver ativa (mais dano, menos dano recebido, mais movimento...), e algumas liberam outras magias do grimório.
         Veja os detalhes de cada uma na árvore do grimório.</p>`],
    ['parties', 'Parties', `
      <p>Monte um grupo de até <b>${g.partyMaxSize}</b> jogadores com <code>/party criar</code> e <code>/party convidar</code>.
         Em party, o líder desafia e todos lutam juntos. O mapa cresce com o número de jogadores.</p>`],
  ];
  $app.innerHTML = `
    <div class="page-title"><div><div class="kicker">Manual do mago</div><h1>Guia</h1></div>
      <p class="muted">Tudo o que você precisa saber para lutar, evoluir e montar o seu grimório.</p></div>
    <div class="guide">
      <nav class="toc">${sections.map(([id, t]) => `<a href="#/guia" data-jump="${id}">${t}</a>`).join('')}</nav>
      <div>${sections.map(([id, t, body]) => `<section id="g-${id}" class="card"><h2>${t}</h2>${body}</section>`).join('')}</div>
    </div>`;
  $app.querySelectorAll('[data-jump]').forEach(a => a.onclick = e => {
    e.preventDefault();
    document.getElementById(`g-${a.dataset.jump}`).scrollIntoView({ behavior: 'smooth' });
  });
}

// ================= Grimórios =================
async function pageGrimoires(id) {
  const all = await api('/api/grimorios');
  const g = id && all.find(x => x.id === id);
  if (g) {
    if (!g.abilities.length) {
      $app.innerHTML = `<p><a href="#/grimorios">← Todos os grimórios</a></p>
        <div class="card empty-state">${ICONS.book}<h2>Grimório ${esc(g.name)}</h2><p class="muted">A árvore deste grimório ainda está sendo preparada.</p></div>`;
      return;
    }
    // O grimório do próprio jogador abre a árvore com compra; os outros abrem como prévia
    if (me?.grimoire?.id === g.id) return pageArvore();
    return renderTree(previewTree(g));
  }
  const order = ['mitico', 'lendario', 'epico', 'raro', 'comum'];
  $app.innerHTML = `
    <div class="page-title"><div><div class="kicker">A estante</div><h1>Grimórios</h1></div>
      <p class="muted">Abra um grimório para ver a árvore de magias. Os apagados ainda estão sendo escritos.</p></div>
    ${order.map(rar => {
      const list = all.filter(x => x.rarity === rar);
      if (!list.length) return '';
      const ready = list.filter(x => x.abilities.length).length;
      return `<div class="shelf-head"><span class="tag rar-${rar}">${esc(list[0].rarityName)}</span>
          <span>${list.length} grimório${list.length === 1 ? '' : 's'}${ready ? ` · ${ready} com magias` : ''}</span></div>
        <div class="books">${list.map(x => `
          <div class="book rar-${rar} ${x.abilities.length ? '' : 'empty'} ${me?.grimoire?.id === x.id ? 'mine' : ''}" data-id="${x.abilities.length ? x.id : ''}"
               ${x.abilities.length ? 'role="link" tabindex="0"' : ''}>
            ${me?.grimoire?.id === x.id ? '<span class="tag mine-tag">Seu grimório</span>' : ''}
            <span class="seal">${STAR}</span>
            <h3>${esc(x.name)}</h3>
            <span class="count">${x.abilities.length ? `${x.abilities.length} magia${x.abilities.length === 1 ? '' : 's'}` : 'Em breve'}</span>
          </div>`).join('')}</div>`;
    }).join('')}`;
  $app.querySelectorAll('.book[data-id]').forEach(c => {
    if (!c.dataset.id) return;
    const open = () => (location.hash = `#/grimorios/${c.dataset.id}`);
    c.onclick = open;
    c.onkeydown = e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open());
  });
}

// ================= Perfil =================
// Medalha de nível: selo dourado com borda recortada
const levelBadge = level => `
  <div class="level-badge" title="Nível">
    <svg viewBox="-52 -52 104 104" aria-hidden="true">
      <path d="${Array.from({ length: 24 }, (_, i) => { const a = (i / 24) * Math.PI * 2, r = i % 2 ? 44 : 50; return `${i ? 'L' : 'M'}${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`; }).join('')}Z"
        fill="#f2b632" stroke="#17121c" stroke-width="4" stroke-linejoin="round"/>
      <circle r="34" fill="#f7d77e" stroke="#17121c" stroke-width="3"/>
      <circle r="28" fill="none" stroke="#c4861a" stroke-width="2" stroke-dasharray="3 5"/>
    </svg>
    <div class="lv"><small>NÍVEL</small><b>${level}</b></div>
  </div>`;

// Barra de 10 gomos (como no /perfil): cada gomo vale um décimo do limite do atributo
function segments(value, cap) {
  const filled = (value / cap) * 10;
  return `<div class="segs">${Array.from({ length: 10 }, (_, i) => {
    if (filled >= i + 1) return '<i class="on"></i>';
    if (filled > i) return `<i class="part" style="--p:${Math.round((filled - i) * 100)}%"></i>`;
    return '<i></i>';
  }).join('')}</div>`;
}

function pagePerfil() {
  if (!me?.user) { $app.innerHTML = needLogin('a sua ficha'); return; }
  const p = me;
  const c = p.character ?? {};
  const name = c.name ?? p.user.username;
  const portrait = c.portrait ?? p.user.avatar;
  const xpPct = p.xpToNext ? Math.min(100, (p.xp / p.xpToNext) * 100) : 100;
  const group = (id, title) => `
    <div class="attr-group ${id}"><h3>${title}</h3>${p.attrs.filter(a => a.group === id).map(a => `
      <div class="attr"><span>${esc(a.name)}</span>${segments(a.value, p.attributeCap)}<b>${a.value}</b></div>`).join('')}</div>`;

  $app.innerHTML = `
    ${!c.name ? `<div class="notice">Você ainda não criou a ficha do personagem. Use <code>/ficha</code> no Discord para dar nome, idade,
      aparência e história a ele; por enquanto aparecem o seu nome e o seu avatar do Discord.</div>` : ''}
    <section class="card sheet">
      <div>
        <div class="portrait">${portrait ? `<img src="${esc(portrait)}" alt="Aparência de ${esc(name)}">` : `<div class="no-pic">${clover(4)}</div>`}</div>
        <div class="nameplate"><span class="tag">@${esc(p.user.username)}</span></div>
      </div>
      <div class="sheet-main">
        <div class="sheet-head">
          <div>
            <div class="kicker" style="color:var(--red-deep)">Ficha do mago</div>
            <h1>${esc(name)}</h1>
            <div class="sub">${c.age != null ? `${esc(c.age)} anos` : 'Idade desconhecida'}</div>
          </div>
          ${levelBadge(p.level)}
        </div>
        <div class="xp">
          <div class="xp-top"><span>Experiência</span><span>${p.xpToNext ? `${p.xp.toLocaleString('pt-BR')} / ${p.xpToNext.toLocaleString('pt-BR')} XP` : 'Nível máximo'}</span></div>
          <div class="meter"><span style="width:${xpPct}%"></span></div>
        </div>
        <div class="grim-row">
          ${p.grimoire ? `
            <div class="grim-book">${p.grimoire.cover ? `<img src="${esc(p.grimoire.cover)}" alt="">` : bookIcon(p.grimoire.rarity)}</div>
            <div style="flex:1;min-width:160px">
              <div class="muted" style="font-weight:800;font-size:13px;letter-spacing:.08em">GRIMÓRIO</div>
              <div class="gname">${esc(p.grimoire.name)}</div>
              <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:6px">
                <span class="tag rar-${p.grimoire.rarity}">${esc(p.grimoire.rarityName)}</span>
                ${p.grimoire.clovers ? `<span class="clover-count" title="As folhas do trevo fortalecem as magias do grimório">${clover(p.grimoire.clovers)} Trevo de ${p.grimoire.clovers} folhas</span>` : ''}
              </div>
            </div>
            <a class="btn small" href="#/arvore">Árvore →</a>`
          : `<div class="grim-book">${bookIcon('comum')}</div>
             <div><div class="gname">Sem grimório</div><div class="muted">A staff define o seu grimório.</div></div>`}
        </div>
        <div class="points">
          <span class="pt-chip ${p.points ? 'hot' : ''}"><b>${p.points}</b> ponto${p.points === 1 ? '' : 's'} de atributo</span>
          <span class="pt-chip ${p.skillPoints ? 'hot' : ''}"><b>${p.skillPoints}</b> ponto${p.skillPoints === 1 ? '' : 's'} de habilidade</span>
        </div>
      </div>
    </section>

    <div class="stats">
      <div class="stat hp">${ICONS.heart}<div><small>VIDA</small><b>${p.stats.hp}</b></div></div>
      <div class="stat mana">${ICONS.crystal}<div><small>MANA</small><b>${p.stats.mana}</b></div></div>
      <div class="stat energy">${ICONS.bolt}<div><small>ENERGIA</small><b>${p.stats.energy}</b></div></div>
      <div class="stat speed">${ICONS.wind}<div><small>VELOCIDADE</small><b>${p.stats.speed}</b></div></div>
    </div>

    <h2>Atributos</h2>
    <div class="card">
      <div class="attr-cols">${group('fisico', 'Físicos')}${group('magico', 'Mágicos')}</div>
      ${p.points ? `<p class="muted" style="margin:14px 0 0">Você tem ${p.points} ponto(s) para distribuir com <code>/distribuir</code> no Discord.</p>` : ''}
    </div>

    ${c.story ? `<h2>História</h2><div class="card"><p class="story">${esc(c.story)}</p></div>` : ''}

    <h2>Magias aprendidas</h2>
    <div class="card">
      ${p.learned.length ? `<div class="spells">${p.learned.map(a => `
        <a class="spell" href="#/arvore" title="${esc(a.name)}">
          <span class="medal">${a.gif ? `<img src="${esc(a.gif)}" alt="" loading="lazy">` : `<b>${esc(a.name[0])}</b>`}</span>
          <span class="sname">${esc(a.name)}</span>
          <span class="stype">${esc(a.typeLabel)}</span>
          ${a.ranks > 1 ? `<span class="pips">${Array.from({ length: a.ranks }, (_, i) => `<i class="${i < a.rank ? 'on' : ''}"></i>`).join('')}</span>` : ''}
        </a>`).join('')}</div>`
      : `<p class="muted" style="margin:0">Nenhuma ainda. ${p.grimoire ? '<a href="#/arvore">Abra a árvore</a> para comprar a primeira.' : ''}</p>`}
    </div>

    <h2>Card do /perfil</h2>
    <div class="card" style="text-align:center">
      <img class="card-img" src="/api/me/card.png?t=${Date.now()}" alt="Card do perfil de ${esc(name)}" loading="lazy">
      <a class="btn" style="margin-top:16px" href="/api/me/card.png" download="perfil-${esc(name)}.png">${ICONS.download} Baixar imagem</a>
    </div>`;
}

// Livro desenhado (quando o grimório não tem imagem de capa), na cor da raridade
const bookIcon = rarity => `
  <svg viewBox="0 0 70 86" aria-hidden="true" style="width:100%;height:100%">
    <rect x="3" y="3" width="62" height="78" rx="6" fill="var(--${rarity})" stroke="#17121c" stroke-width="4"/>
    <rect x="3" y="3" width="14" height="78" rx="4" fill="rgba(23,18,28,.35)" stroke="#17121c" stroke-width="4"/>
    <path d="M3 20h14M3 64h14" stroke="#f2b632" stroke-width="4"/>
    <circle cx="41" cy="42" r="15" fill="#2a1f2f" stroke="#17121c" stroke-width="3"/>
    <g transform="translate(41 43) scale(.42)" fill="#f2b632" stroke="#17121c" stroke-width="4">
      ${[0, 90, 180, 270].map(r => `<path transform="rotate(${r})" d="M0,-3 C-7,-9 -17,-13 -13,-23 C-10,-29 -2,-27 0,-21 C2,-27 10,-29 13,-23 C17,-13 7,-9 0,-3Z"/>`).join('')}
    </g>
  </svg>`;

// ================= Árvore de habilidades =================
// Cada magia é um nó, e cada rank extra dela (II, III...) é outro nó logo abaixo, no mesmo galho.
// `after` liga a magia à anterior: é preciso aprender a de cima para liberar a de baixo.
// A mesma tela serve para a árvore do jogador (compra) e para a prévia de qualquer grimório (só leitura).
const NODE_W = 136, NODE_H = 150, GAP_X = 26, GAP_Y = 54, ORB = 84;
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
let selectedId = null;
let justBought = null;

const nodeKey = (id, r) => (r === 1 ? id : `${id}#${r}`);

// Os nós da árvore: um por rank de cada magia. O rank 1 fica sob a magia anterior (`after`);
// o rank N fica sob o rank N-1. Os ranks vêm antes das magias filhas, para o galho da melhoria ficar junto.
function buildNodes(abilities) {
  const ids = new Set(abilities.map(a => a.id));
  const nodes = [];
  for (const a of abilities) {
    a.ranks.forEach((spec, i) => {
      const r = i + 1;
      nodes.push({
        key: nodeKey(a.id, r), a, r, spec,
        parent: r > 1 ? nodeKey(a.id, r - 1) : a.after && ids.has(a.after) ? a.after : null,
      });
    });
  }
  return nodes;
}

// Posição de cada nó: filhos abaixo do pai, folhas lado a lado e o pai centralizado sobre os filhos
function layoutTree(nodes) {
  const kids = {};
  for (const n of nodes) if (n.parent) (kids[n.parent] ||= []).push(n);
  for (const list of Object.values(kids)) list.sort((x, y) => (y.r > 1) - (x.r > 1)); // galho dos ranks primeiro
  const pos = {};
  let leaf = 0, maxDepth = 0;
  const place = (n, depth) => {
    maxDepth = Math.max(maxDepth, depth);
    const c = kids[n.key] || [];
    let x;
    if (!c.length) x = leaf++;
    else { const xs = c.map(k => place(k, depth + 1)); x = (xs[0] + xs[xs.length - 1]) / 2; }
    pos[n.key] = { x: x * (NODE_W + GAP_X), y: depth * (NODE_H + GAP_Y) };
    return x;
  };
  nodes.filter(n => !n.parent).forEach(n => place(n, 0));
  return { pos, kids, width: Math.max(leaf, 1) * (NODE_W + GAP_X) - GAP_X, height: (maxDepth + 1) * (NODE_H + GAP_Y) - GAP_Y };
}

// Estado do nó para o jogador
function stateOf(n, tree) {
  if (tree.preview) return 'preview';
  const { a, r } = n;
  if (a.rank >= r) return r === a.ranks.length ? 'maxed' : 'learned';
  if (a.rank < r - 1) return 'locked';                                            // falta o rank anterior
  if (r === 1 && a.after && !((tree.byId[a.after]?.rank ?? 0) > 0)) return 'locked'; // falta a magia anterior
  return a.blocker ? 'reachable' : 'available'; // é o próximo passo, mas pode faltar nível ou pontos
}

// Uma árvore "de vitrine" a partir do catálogo (ninguém aprendeu nada)
const previewTree = g => ({
  grimoire: g, preview: true,
  abilities: g.abilities.map(a => ({ ...a, rank: 0, next: { rank: 1, cost: a.ranks[0].cost }, blocker: null })),
});

function renderTree(tree) {
  tree.byId = Object.fromEntries(tree.abilities.map(a => [a.id, a]));
  tree.nodes = buildNodes(tree.abilities);
  const nodeByKey = Object.fromEntries(tree.nodes.map(n => [n.key, n]));
  const { pos, kids, width, height } = layoutTree(tree.nodes);
  tree.kids = kids;
  if (!nodeByKey[selectedId]) {
    selectedId = (tree.nodes.find(n => stateOf(n, tree) === 'available') || tree.nodes.find(n => !n.parent) || tree.nodes[0])?.key;
  }

  const edges = tree.nodes.filter(n => n.parent && pos[n.parent]).map(n => {
    const p = pos[n.parent], c = pos[n.key];
    const x1 = p.x + NODE_W / 2, y1 = p.y + ORB + 4, x2 = c.x + NODE_W / 2, y2 = c.y - 4, my = (y1 + y2) / 2;
    const parentOwned = nodeByKey[n.parent].a.rank >= nodeByKey[n.parent].r;
    const cls = tree.preview ? '' : n.a.rank >= n.r ? 'on' : parentOwned ? 'open' : '';
    return `<path class="${cls} ${n.r > 1 ? 'upgrade' : ''}" d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}"/>`;
  }).join('');

  const nodes = tree.nodes.map(n => {
    const { a, r, spec } = n;
    const st = stateOf(n, tree);
    return `<button class="node ${st} ${r > 1 ? 'upgrade' : ''} ${n.key === selectedId ? 'selected' : ''} ${n.key === justBought ? 'burst' : ''}" data-key="${esc(n.key)}"
        style="left:${pos[n.key].x}px;top:${pos[n.key].y}px;width:${NODE_W}px" title="${esc(a.name)}${r > 1 ? ` — Rank ${ROMAN[r - 1]}` : ''}">
      <span class="orb">${a.gif ? `<img src="${esc(a.gif)}" alt="" loading="lazy">` : `<b>${esc(a.name[0])}</b>`}
        ${r > 1 ? `<span class="roman">${ROMAN[r - 1]}</span>` : ''}</span>
      <span class="lvl">Nv ${spec.minLevel}</span>
      <span class="price">${st === 'learned' || st === 'maxed' ? '✓' : `${spec.cost} pt`}</span>
      <span class="n-name">${r > 1 ? `<small>Rank ${ROMAN[r - 1]}</small>` : ''}${esc(a.name)}</span>
    </button>`;
  }).join('');

  const g = tree.grimoire;
  const owned = !tree.preview;
  const learnedCount = tree.abilities.filter(a => a.rank > 0).length;
  const note = owned ? '' : !me?.user
    ? `<div class="banner">Prévia do grimório. ${loginButton()} <span class="muted">para comprar as magias do seu.</span></div>`
    : me.grimoire
      ? `<div class="banner">Prévia: este não é o seu grimório. <a href="#/arvore">Abrir a árvore do ${esc(me.grimoire.name)} →</a></div>`
      : '<div class="banner">Prévia. Você ainda não tem grimório: a staff define o seu.</div>';

  $app.innerHTML = `
    <p style="margin-bottom:8px"><a href="#/grimorios">← Estante de grimórios</a></p>
    <div class="tree-head">
      <div>
        <div class="kicker">Árvore de magias</div>
        <h1>Grimório ${esc(g.name)}</h1>
        <div class="meta"><span class="tag rar-${g.rarity}">${esc(g.rarityName)}</span>
          <span>${tree.abilities.length} magia${tree.abilities.length === 1 ? '' : 's'}${owned ? ` · ${learnedCount} aprendida(s) · nível ${tree.level}` : ''}</span></div>
      </div>
      ${owned ? `<span class="points-pill">${tree.skillPoints} ponto${tree.skillPoints === 1 ? '' : 's'} de habilidade</span>` : ''}
    </div>
    ${note}
    <div class="tree-layout">
      <div class="tree-wrap"><div class="tree" style="width:${width}px;height:${height}px">
        <svg width="${width}" height="${height}">${edges}</svg>${nodes}</div></div>
      <aside class="card detail" id="detail"></aside>
    </div>
    <div class="legend">
      ${owned ? `<span><i class="dot available"></i> Pode comprar</span>
      <span><i class="dot reachable"></i> Liberada, falta nível ou pontos</span>
      <span><i class="dot learned"></i> Aprendida</span>
      <span><i class="dot maxed"></i> Rank máximo</span>
      <span><i class="dot locked"></i> Bloqueada: compre o nó de cima</span>` : ''}
      <span><i class="dot upgrade"></i> Melhoria (rank II, III...) da magia de cima</span>
    </div>`;

  justBought = null;
  // Árvore larga: diminui para caber na caixa (até 55%); se precisar diminuir mais (celular), rola para o lado,
  // começando centralizada na raiz
  const wrap = $app.querySelector('.tree-wrap');
  const treeEl = wrap.querySelector('.tree');
  const room = wrap.clientWidth - 54; // padding lateral da caixa + bordas
  const fit = room / width;
  treeEl.style.zoom = fit < 1 && fit >= 0.55 ? fit : '';
  wrap.scrollLeft = (wrap.scrollWidth - wrap.clientWidth) / 2;
  $app.querySelectorAll('.node').forEach(el => el.onclick = () => {
    selectedId = el.dataset.key;
    $app.querySelectorAll('.node.selected').forEach(x => x.classList.remove('selected'));
    el.classList.add('selected');
    renderDetail(nodeByKey[selectedId], tree);
    if (window.innerWidth <= 900) document.getElementById('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  renderDetail(nodeByKey[selectedId], tree);
}

const rankLine = r => `${r.resourceCost.amount} ${r.resourceCost.resource}${r.cooldown ? ` · recarga ${r.cooldown}` : ''}`;
const nodeName = n => `${n.a.name}${n.r > 1 ? ` (Rank ${ROMAN[n.r - 1]})` : ''}`;
const selLink = n => `<a href="#" data-sel="${esc(n.key)}">${esc(nodeName(n))}</a>`;

function renderDetail(n, tree) {
  const el = document.getElementById('detail');
  if (!n) { el.innerHTML = ''; return; }
  const { a, r, spec } = n;
  const st = stateOf(n, tree);
  const parent = n.parent && tree.nodes.find(x => x.key === n.parent);
  const parentOwned = parent && parent.a.rank >= parent.r;
  const children = tree.kids[n.key] || [];
  const isNext = !tree.preview && a.next && a.next.rank === r;
  const prev = r > 1 && a.ranks[r - 2];

  let action = '';
  if (st === 'maxed' || st === 'learned') action = `<div class="maxed-note">✓ ${r > 1 ? `Rank ${ROMAN[r - 1]} comprado` : 'Aprendida'}${st === 'maxed' && a.ranks.length > 1 ? ' · rank máximo' : ''}</div>`;
  else if (isNext) {
    action = `${a.blocker ? `<div class="blocker">🔒 ${esc(a.blocker.replace(/\*\*/g, ''))}</div>` : ''}
      <button class="btn primary buy" id="buy" ${a.blocker ? 'disabled' : ''}>
        ${r === 1 ? 'Aprender' : `Evoluir para rank ${ROMAN[r - 1]}`} · ${spec.cost} pt</button>`;
  } else if (st === 'locked') action = `<div class="blocker">🔒 Compre antes ${esc(nodeName(parent))}</div>`;

  el.innerHTML = `
    ${a.gif ? `<img src="${esc(a.gif)}" alt="">` : ''}
    <h3>${esc(a.name)}${r > 1 ? ` <span class="rank-tag">Rank ${ROMAN[r - 1]}</span>` : ''}</h3>
    <div class="muted" style="font-size:13px">${esc(a.typeLabel)}${r > 1 ? ' · melhoria' : ''}${a.ranks.length > 1 ? ` · ${a.ranks.length} ranks` : ''}${!tree.preview && a.rank ? ` · você tem o rank ${ROMAN[a.rank - 1]}` : ''}</div>
    ${a.description ? `<p class="desc">${esc(a.description)}</p>` : ''}
    ${parent ? `<div class="req ${parentOwned || tree.preview ? '' : 'missing'}">${tree.preview ? '↑' : parentOwned ? '✓' : '✗'} Requer: ${selLink(parent)}</div>`
      : '<div class="req">◆ Início da árvore</div>'}
    ${children.length ? `<div class="req">↓ Libera: ${children.map(selLink).join(', ')}</div>` : ''}
    <div class="rank-block">
      <b>${r > 1 ? `Rank ${ROMAN[r - 1]}` : 'Rank I'}</b> · nível ${spec.minLevel} · ${spec.cost} pt · ${rankLine(spec)}
      <ul>${spec.details.map(d => `<li>${esc(d)}</li>`).join('')}</ul>
    </div>
    ${prev ? `<div class="rank-block muted" style="font-size:13px"><b>Antes (rank ${ROMAN[r - 2]})</b> · ${rankLine(prev)}
      <ul>${prev.details.map(d => `<li>${esc(d)}</li>`).join('')}</ul></div>` : ''}
    ${action}`;

  el.querySelectorAll('[data-sel]').forEach(l => l.onclick = e => {
    e.preventDefault();
    document.querySelector(`.node[data-key="${CSS.escape(l.dataset.sel)}"]`)?.click();
  });

  const buy = document.getElementById('buy');
  if (buy && !a.blocker) buy.onclick = async () => {
    buy.disabled = true;
    try {
      const res = await api('/api/arvore/comprar', { method: 'POST', body: JSON.stringify({ id: a.id }) });
      const freed = [
        ...(res.rank === 1 ? res.tree.abilities.filter(x => x.after === a.id).map(x => x.name) : []),
        ...(res.rank < a.ranks.length ? [`Rank ${ROMAN[res.rank]}`] : []),
      ];
      toast(`${res.rank === 1 ? `📖 Você aprendeu ${a.name}!` : `⬆️ ${a.name} subiu para o rank ${ROMAN[res.rank - 1]}!`}${freed.length ? ` Liberou: ${freed.join(', ')}.` : ''}`, 'ok');
      me = await api('/api/me');
      justBought = nodeKey(a.id, res.rank);
      selectedId = justBought;
      renderTree(res.tree);
    } catch (err) {
      toast(err.message, 'error');
      buy.disabled = false;
    }
  };
}

async function pageArvore() {
  if (!me?.user) { $app.innerHTML = needLogin('a sua árvore de habilidades'); return; }
  const { tree } = await api('/api/arvore');
  if (!tree) {
    $app.innerHTML = `<div class="card empty-state">${ICONS.book}<h2>Você ainda não tem um grimório</h2>
      <p class="muted">Quando a staff definir o seu grimório, a árvore de magias aparece aqui.</p>
      <a class="btn" href="#/grimorios">Conhecer os grimórios</a></div>`;
    return;
  }
  renderTree(tree);
}

// ================= Loja =================
function pageLoja() {
  $app.innerHTML = `
    <div class="page-title"><div><div class="kicker">Mercado do reino</div><h1>Loja</h1></div></div>
    <div class="card empty-state">${ICONS.cart}<h2>Em breve</h2>
      <p class="muted">A loja do servidor está sendo preparada. Os itens aparecem aqui assim que ela abrir.</p></div>`;
}

// ================= Rotas =================
const routes = { '': pageHome, guia: pageGuide, grimorios: pageGrimoires, arvore: pageArvore, perfil: pagePerfil, loja: pageLoja };

async function route() {
  const [name = '', arg] = location.hash.replace(/^#\/?/, '').split('/');
  document.body.classList.remove('menu-open');
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.dataset.route === name));
  const page = routes[name] || pageHome;
  try {
    await page(arg);
  } catch (err) {
    if (err.status === 401) { me = null; renderAccount(); $app.innerHTML = needLogin('esta página'); return; }
    $app.innerHTML = `<div class="card empty-state"><h2>Algo deu errado</h2><p class="muted">${esc(err.message)}</p></div>`;
  }
  window.scrollTo(0, 0);
}

(async function init() {
  if (new URLSearchParams(location.search).get('erro') === 'login') {
    toast('Não foi possível entrar com o Discord. Tente de novo.', 'error');
    history.replaceState(null, '', location.pathname + location.hash);
  }
  document.getElementById('brand').insertAdjacentHTML('afterbegin', clover(4));
  document.getElementById('footer').innerHTML = `${clover(4)} Grimórios RPG · um jogo do servidor, jogado no Discord`;
  try { me = await api('/api/me'); if (!me.user) me = null; } catch { me = null; }
  renderAccount();
  window.addEventListener('hashchange', route);
  route();
})();
