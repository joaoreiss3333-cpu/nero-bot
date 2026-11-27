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

const loginButton = () => '<a class="btn discord" href="/auth/login">Entrar com Discord</a>';
const needLogin = what => `
  <div class="card empty-state">
    <h2>Entre para ver ${what}</h2>
    <p class="muted">Use a mesma conta do Discord com que você joga no servidor.</p>
    ${loginButton()}
  </div>`;

function renderAccount() {
  const el = document.getElementById('account');
  if (!me?.user) { el.innerHTML = loginButton(); return; }
  el.innerHTML = `
    ${me.user.avatar ? `<img class="avatar" src="${esc(me.user.avatar)}" alt="">` : '<span class="avatar"></span>'}
    <span>${esc(me.user.username)}</span>
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
  $app.innerHTML = `
    <section class="hero">
      <h1>Desperte o seu grimório</h1>
      <p>Um RPG de batalhas táticas por turnos no Discord. Suba de nível, distribua atributos e
         monte o seu caminho na árvore de magias do seu grimório.</p>
      <div class="actions">
        ${me?.user ? '<a class="btn primary" href="#/arvore">Abrir minha árvore</a>' : loginButton()}
        <a class="btn" href="#/guia">Ler o guia</a>
      </div>
    </section>
    <div class="grid">
      <a class="card feature" href="#/arvore"><div class="icon">🌳</div><h3>Árvore de habilidades</h3>
        <p class="muted">Gaste pontos de habilidade para aprender magias e evoluir os ranks, direto pelo site.</p></a>
      <a class="card feature" href="#/guia"><div class="icon">📜</div><h3>Guia dos sistemas</h3>
        <p class="muted">Combate, progressão, atributos, efeitos e parties explicados.</p></a>
      <a class="card feature" href="#/grimorios"><div class="icon">📖</div><h3>Grimórios</h3>
        <p class="muted">Todos os grimórios do servidor, raridades e as magias de cada um.</p></a>
      <a class="card feature" href="#/perfil"><div class="icon">🧙</div><h3>Seu perfil</h3>
        <p class="muted">Nível, atributos, vida, mana e as magias que você já domina.</p></a>
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
    ['atributos', 'Atributos', `
      <p>Cada atributo vai até <b>${g.attributeCap}</b>. Eles aumentam o dano, a defesa e a cura das habilidades que usam aquele atributo.</p>
      <div class="chips">${g.attributes.map(a => `<span class="chip">${esc(a)}</span>`).join('')}</div>
      <p style="margin-top:1em" class="muted">Destreza também aumenta a velocidade (ordem dos turnos) e a chance de esquiva.</p>`],
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
        ${g.rarities.map(r => `<tr><td class="rar-${r.id}"><b>${esc(r.name)}</b></td><td>${esc(r.chance)}</td><td>${g.raritiesScale[r.id]}×</td></tr>`).join('')}</table>
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
    <h1>Guia</h1>
    <div class="guide">
      <nav class="toc">${sections.map(([id, t]) => `<a href="#/guia" data-jump="${id}">${t}</a>`).join('')}</nav>
      <div>${sections.map(([id, t, body]) => `<section id="g-${id}" class="card" style="margin-bottom:16px"><h2 style="margin-top:0">${t}</h2>${body}</section>`).join('')}</div>
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
        <div class="card empty-state"><h2>Grimório ${esc(g.name)}</h2><p class="muted">A árvore deste grimório ainda está sendo preparada.</p></div>`;
      return;
    }
    // O grimório do próprio jogador abre a árvore com compra; os outros abrem como prévia
    if (me?.grimoire?.id === g.id) return pageArvore();
    return renderTree(previewTree(g));
  }
  const order = ['mitico', 'lendario', 'epico', 'raro', 'comum'];
  $app.innerHTML = `
    <h1>Grimórios</h1>
    <p class="muted">Clique num grimório para ver as magias. Os que ainda não têm magias estão sendo preparados.</p>
    ${order.map(rar => {
      const list = all.filter(x => x.rarity === rar);
      return `<h2 class="rar-${rar}">${esc(list[0]?.rarityName)}</h2>
        <div class="grid">${list.map(x => `
          <div class="card grim-card ${x.abilities.length ? '' : 'empty'} ${me?.grimoire?.id === x.id ? 'mine' : ''}" data-id="${x.abilities.length ? x.id : ''}">
            <h3>${esc(x.name)}</h3>
            <span class="muted">${x.abilities.length ? `🌳 ${x.abilities.length} magia${x.abilities.length === 1 ? "" : "s"}` : 'Em breve'}</span>
            ${me?.grimoire?.id === x.id ? '<span class="tag mine-tag">Seu grimório</span>' : ''}
          </div>`).join('')}</div>`;
    }).join('')}`;
  $app.querySelectorAll('.grim-card[data-id]').forEach(c => c.dataset.id && (c.onclick = () => (location.hash = `#/grimorios/${c.dataset.id}`)));
}

// ================= Perfil =================
function pagePerfil() {
  if (!me?.user) { $app.innerHTML = needLogin('o seu perfil'); return; }
  const p = me;
  const xpPct = p.xpToNext ? Math.min(100, (p.xp / p.xpToNext) * 100) : 100;
  $app.innerHTML = `
    <div class="card">
      <div class="profile-head">
        ${p.user.avatar ? `<img class="avatar" src="${esc(p.user.avatar)}" alt="">` : '<span class="avatar"></span>'}
        <div style="flex:1;min-width:220px">
          <h1 style="font-size:32px;margin-bottom:4px">${esc(p.user.username)}</h1>
          <div>Nível <b>${p.level}</b>${p.grimoire ? ` · Grimório <b class="rar-${p.grimoire.rarity}">${esc(p.grimoire.name)}</b> <span class="tag">${esc(p.grimoire.rarityName)}</span> <span class="tag" title="As folhas do trevo fortalecem as magias do grimório">🍀 ${p.grimoire.clovers} folhas</span>` : ' · <span class="muted">sem grimório</span>'}</div>
          <div class="bar" style="margin-top:10px"><span style="width:${xpPct}%"></span></div>
          <small class="muted">${p.xpToNext ? `${p.xp} / ${p.xpToNext} XP` : 'Nível máximo'}</small>
        </div>
      </div>
    </div>
    <h2>Status</h2>
    <div class="stats">
      <div class="stat"><small>Vida</small><b>❤️ ${p.stats.hp}</b></div>
      <div class="stat"><small>Mana</small><b>🔷 ${p.stats.mana}</b></div>
      <div class="stat"><small>Energia</small><b>⚡ ${p.stats.energy}</b></div>
      <div class="stat"><small>Velocidade</small><b>💨 ${p.stats.speed}</b></div>
      <div class="stat"><small>Pontos de atributo</small><b>${p.points}</b></div>
      <div class="stat"><small>Pontos de habilidade</small><b style="color:var(--gold)">${p.skillPoints}</b></div>
    </div>
    <h2>Atributos</h2>
    <div class="card">${p.attrs.map(a => `
      <div class="attr"><span>${esc(a.name)}</span>
        <div class="bar"><span style="width:${(a.value / p.attributeCap) * 100}%"></span></div><b>${a.value}</b></div>`).join('')}
      ${p.points ? `<p class="muted" style="margin:12px 0 0">Você tem ${p.points} ponto(s) para distribuir com <code>/distribuir</code> no Discord.</p>` : ''}
    </div>
    <h2>Magias aprendidas</h2>
    ${p.learned.length
      ? `<div class="chips">${p.learned.map(a => `<span class="chip">${esc(a.name)}${a.rank > 1 ? ` · rank ${a.rank}` : ''}</span>`).join('')}</div>`
      : `<p class="muted">Nenhuma ainda. ${p.grimoire ? '<a href="#/arvore">Abra a árvore</a> para comprar a primeira.' : ''}</p>`}`;
}

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
    ? `<div class="banner">👀 Prévia do grimório. ${loginButton()} <span class="muted">para comprar as magias do seu.</span></div>`
    : me.grimoire
      ? `<div class="banner">👀 Prévia: este não é o seu grimório. <a href="#/arvore">Abrir a árvore do ${esc(me.grimoire.name)} →</a></div>`
      : '<div class="banner">👀 Prévia. Você ainda não tem grimório: a staff define o seu.</div>';

  $app.innerHTML = `
    <p style="margin-bottom:8px"><a href="#/grimorios">← Todos os grimórios</a></p>
    <div class="tree-head">
      <div>
        <h1 style="margin:0">Grimório <span class="rar-${g.rarity}">${esc(g.name)}</span></h1>
        <span class="muted"><span class="tag rar-${g.rarity}">${esc(g.rarityName)}</span>
          · ${tree.abilities.length} magia${tree.abilities.length === 1 ? "" : "s"}${owned ? ` · ${learnedCount} aprendida(s) · você está no nível ${tree.level}` : ''}</span>
      </div>
      ${owned ? `<span class="points-pill">✦ ${tree.skillPoints} ponto(s) de habilidade</span>` : ''}
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
  // Árvore larga: diminui para caber na caixa (até 65%); se precisar diminuir mais (celular), rola para o lado,
  // começando centralizada na raiz
  const wrap = $app.querySelector('.tree-wrap');
  const treeEl = wrap.querySelector('.tree');
  const room = wrap.clientWidth - 48; // padding lateral da caixa
  const fit = room / width;
  treeEl.style.zoom = fit < 1 && fit >= 0.65 ? fit : '';
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
    $app.innerHTML = `<div class="card empty-state"><h2>Você ainda não tem um grimório</h2>
      <p class="muted">Quando a staff definir o seu grimório, a árvore de magias aparece aqui.</p>
      <a class="btn" href="#/grimorios">Conhecer os grimórios</a></div>`;
    return;
  }
  renderTree(tree);
}

// ================= Loja =================
function pageLoja() {
  $app.innerHTML = `
    <h1>Loja</h1>
    <p class="muted">A loja do servidor está sendo preparada. Em breve os itens aparecem aqui.</p>
    <div class="card empty-state"><div style="font-size:40px">🛒</div><h2>Em breve</h2></div>`;
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
  try { me = await api('/api/me'); if (!me.user) me = null; } catch { me = null; }
  renderAccount();
  window.addEventListener('hashchange', route);
  route();
})();
