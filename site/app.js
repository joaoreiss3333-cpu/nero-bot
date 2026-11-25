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
        <li>Quando a staff definir o seu grimório, compre magias na <a href="#/arvore">Árvore</a> (ou com <code>/aprender</code>).</li>
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
        <li><b>Ação bônus</b>: uma por turno, acontece na hora (portais, curas, buffs...).</li>
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
      <p>Buffs e debuffs aplicados por magias. Debuffs atrapalham quem recebe; buffs fortalecem.</p>
      <div class="chips">${g.effects.map(e => `<span class="chip ${e.kind}">${e.emoji} ${esc(e.name)}</span>`).join('')}</div>`],
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
            <span class="muted">${x.abilities.length ? `🌳 ${x.abilities.length} magias` : 'Em breve'}</span>
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
          <div>Nível <b>${p.level}</b>${p.grimoire ? ` · Grimório <b class="rar-${p.grimoire.rarity}">${esc(p.grimoire.name)}</b> <span class="tag">${esc(p.grimoire.rarityName)}</span>` : ' · <span class="muted">sem grimório</span>'}</div>
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
// Cada magia é um nó; `after` liga a magia à anterior (é preciso aprender a de cima para liberar a de baixo).
// A mesma tela serve para a árvore do jogador (compra) e para a prévia de qualquer grimório (só leitura).
const NODE_W = 136, NODE_H = 150, GAP_X = 26, GAP_Y = 54, ORB = 84;
let selectedId = null;
let justBought = null;

// Posição de cada magia: filhos abaixo do pai, folhas lado a lado e o pai centralizado sobre os filhos
function layoutTree(abilities) {
  const ids = new Set(abilities.map(a => a.id));
  const kids = {};
  for (const a of abilities) if (a.after && ids.has(a.after)) (kids[a.after] ||= []).push(a.id);
  const roots = abilities.filter(a => !a.after || !ids.has(a.after)).map(a => a.id);
  const pos = {};
  let leaf = 0, maxDepth = 0;
  const place = (id, depth) => {
    maxDepth = Math.max(maxDepth, depth);
    const c = kids[id] || [];
    let x;
    if (!c.length) x = leaf++;
    else { const xs = c.map(k => place(k, depth + 1)); x = (xs[0] + xs[xs.length - 1]) / 2; }
    pos[id] = { x: x * (NODE_W + GAP_X), y: depth * (NODE_H + GAP_Y), depth };
    return x;
  };
  roots.forEach(r => place(r, 0));
  return { pos, width: Math.max(leaf, 1) * (NODE_W + GAP_X) - GAP_X, height: (maxDepth + 1) * (NODE_H + GAP_Y) - GAP_Y };
}

// Estado do nó para o jogador
function stateOf(a, tree) {
  if (tree.preview) return 'preview';
  if (a.rank > 0) return a.next ? 'learned' : 'maxed';
  const parentOk = !a.after || (tree.byId[a.after]?.rank ?? 0) > 0;
  if (!parentOk) return 'locked';           // ainda falta a magia anterior
  return a.blocker ? 'reachable' : 'available'; // liberada pela árvore, mas pode faltar nível ou pontos
}

// Uma árvore "de vitrine" a partir do catálogo (ninguém aprendeu nada)
const previewTree = g => ({
  grimoire: g, preview: true,
  abilities: g.abilities.map(a => ({ ...a, rank: 0, next: { rank: 1, cost: a.ranks[0].cost }, blocker: null })),
});

function renderTree(tree) {
  tree.byId = Object.fromEntries(tree.abilities.map(a => [a.id, a]));
  const { pos, width, height } = layoutTree(tree.abilities);
  const byId = tree.byId;
  if (!byId[selectedId]) {
    selectedId = (tree.abilities.find(a => stateOf(a, tree) === 'available') || tree.abilities.find(a => !a.after) || tree.abilities[0])?.id;
  }

  const edges = tree.abilities.filter(a => a.after && pos[a.after]).map(a => {
    const p = pos[a.after], c = pos[a.id];
    const x1 = p.x + NODE_W / 2, y1 = p.y + ORB + 4, x2 = c.x + NODE_W / 2, y2 = c.y - 4, my = (y1 + y2) / 2;
    const cls = tree.preview ? '' : a.rank > 0 ? 'on' : (byId[a.after].rank > 0 ? 'open' : '');
    return `<path class="${cls}" d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}"/>`;
  }).join('');

  const nodes = tree.abilities.map(a => {
    const st = stateOf(a, tree);
    const pips = a.ranks.length > 1
      ? `<span class="pips">${a.ranks.map((_, i) => `<i class="${i < a.rank ? 'on' : ''}"></i>`).join('')}</span>` : '';
    const price = st === 'maxed' ? '★ Máx.' : st === 'preview' ? `${a.ranks[0].cost} pt` : a.next ? `${a.next.cost} pt` : '';
    return `<button class="node ${st} ${a.id === selectedId ? 'selected' : ''} ${a.id === justBought ? 'burst' : ''}" data-id="${a.id}"
        style="left:${pos[a.id].x}px;top:${pos[a.id].y}px;width:${NODE_W}px" title="${esc(a.name)}">
      <span class="orb">${a.gif ? `<img src="${esc(a.gif)}" alt="" loading="lazy">` : `<b>${esc(a.name[0])}</b>`}</span>
      <span class="lvl">Nv ${a.ranks[0].minLevel}</span>
      ${price ? `<span class="price">${price}</span>` : ''}
      <span class="n-name">${esc(a.name)}</span>${pips}
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
          · ${tree.abilities.length} magias${owned ? ` · ${learnedCount} aprendida(s) · você está no nível ${tree.level}` : ''}</span>
      </div>
      ${owned ? `<span class="points-pill">✦ ${tree.skillPoints} ponto(s) de habilidade</span>` : ''}
    </div>
    ${note}
    <div class="tree-layout">
      <div class="tree-wrap"><div class="tree" style="width:${width}px;height:${height}px">
        <svg width="${width}" height="${height}">${edges}</svg>${nodes}</div></div>
      <aside class="card detail" id="detail"></aside>
    </div>
    ${owned ? `<div class="legend">
      <span><i class="dot available"></i> Pode comprar</span>
      <span><i class="dot reachable"></i> Liberada, falta nível ou pontos</span>
      <span><i class="dot learned"></i> Aprendida</span>
      <span><i class="dot maxed"></i> Rank máximo</span>
      <span><i class="dot locked"></i> Bloqueada: aprenda a magia de cima</span>
    </div>` : ''}`;

  justBought = null;
  // Em tela estreita a árvore rola para o lado: começa centralizada na raiz
  const wrap = $app.querySelector('.tree-wrap');
  wrap.scrollLeft = (wrap.scrollWidth - wrap.clientWidth) / 2;
  $app.querySelectorAll('.node').forEach(n => n.onclick = () => {
    selectedId = n.dataset.id;
    $app.querySelectorAll('.node.selected').forEach(x => x.classList.remove('selected'));
    n.classList.add('selected');
    renderDetail(byId[selectedId], tree);
    if (window.innerWidth <= 900) document.getElementById('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  renderDetail(byId[selectedId], tree);
}

const rankLine = r => `${r.resourceCost.amount} ${r.resourceCost.resource}${r.cooldown ? ` · recarga ${r.cooldown}` : ''}`;

function renderDetail(a, tree) {
  const el = document.getElementById('detail');
  if (!a) { el.innerHTML = ''; return; }
  const byId = tree.byId;
  const st = stateOf(a, tree);
  const parent = a.after && byId[a.after];
  const children = tree.abilities.filter(x => x.after === a.id);
  const shown = a.ranks[Math.max(0, a.rank - 1)];
  const nextRank = a.next && a.rank > 0 && a.ranks[a.next.rank - 1];

  let action = '';
  if (st === 'maxed') action = '<div class="maxed-note">★ Rank máximo</div>';
  else if (!tree.preview && a.next) {
    action = `${a.blocker ? `<div class="blocker">🔒 ${esc(a.blocker.replace(/\*\*/g, ''))}</div>` : ''}
      <button class="btn primary buy" id="buy" ${a.blocker ? 'disabled' : ''}>
        ${a.next.rank === 1 ? 'Aprender' : `Evoluir para rank ${a.next.rank}`} · ${a.next.cost} pt</button>`;
  }

  el.innerHTML = `
    ${a.gif ? `<img src="${esc(a.gif)}" alt="">` : ''}
    <h3>${esc(a.name)}</h3>
    <div class="muted" style="font-size:13px">${esc(a.typeLabel)}${a.ranks.length > 1 ? ` · rank ${a.rank}/${a.ranks.length}` : a.rank ? ' · aprendida' : ''}</div>
    ${parent ? `<div class="req ${parent.rank > 0 || tree.preview ? '' : 'missing'}">${tree.preview ? '↑' : parent.rank > 0 ? '✓' : '✗'} Requer: <a href="#" data-sel="${parent.id}">${esc(parent.name)}</a></div>`
      : '<div class="req">◆ Início da árvore</div>'}
    ${children.length ? `<div class="req">↓ Libera: ${children.map(c => `<a href="#" data-sel="${c.id}">${esc(c.name)}</a>`).join(', ')}</div>` : ''}
    <div class="rank-block">
      <b>${a.rank ? `Rank ${a.rank} (atual)` : 'Rank 1'}</b> · nível ${shown.minLevel} · ${rankLine(shown)}
      <ul>${shown.details.map(d => `<li>${esc(d)}</li>`).join('')}</ul>
    </div>
    ${nextRank ? `<div class="rank-block"><b>Próximo: rank ${nextRank.rank}</b> · nível ${nextRank.minLevel} · ${rankLine(nextRank)}
      <ul>${nextRank.details.map(d => `<li>${esc(d)}</li>`).join('')}</ul></div>` : ''}
    ${tree.preview && a.ranks.length > 1 ? `<div class="rank-block muted" style="font-size:13px">Evolui até o rank ${a.ranks.length}:
      ${a.ranks.slice(1).map(r => `rank ${r.rank} no nível ${r.minLevel} (${r.cost} pt)`).join(' · ')}</div>` : ''}
    ${action}`;

  el.querySelectorAll('[data-sel]').forEach(l => l.onclick = e => {
    e.preventDefault();
    document.querySelector(`.node[data-id="${l.dataset.sel}"]`)?.click();
  });

  const buy = document.getElementById('buy');
  if (buy && !a.blocker) buy.onclick = async () => {
    buy.disabled = true;
    try {
      const res = await api('/api/arvore/comprar', { method: 'POST', body: JSON.stringify({ id: a.id }) });
      const freed = res.rank === 1 ? res.tree.abilities.filter(x => x.after === a.id).map(x => x.name) : [];
      toast(res.rank === 1
        ? `📖 Você aprendeu ${a.name}!${freed.length ? ` Liberou: ${freed.join(', ')}.` : ''}`
        : `⬆️ ${a.name} subiu para o rank ${res.rank}!`, 'ok');
      me = await api('/api/me');
      justBought = a.id;
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
