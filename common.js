/* Shared 2-player plumbing: PeerJS online play, one-device pass-and-play, spicy toggle, lobby, cover screens.
   A game calls TwoPlayer({...}) with its own rules and rendering. */
window.TwoPlayer = function (cfg) {
  const app = document.getElementById('app');
  let mode = null, peer = null, conn = null, me1 = 0, room = '', loading = false, notice = '', cover = 0;
  let spicy = false;
  try { spicy = localStorage.getItem('rmm-spicy') === '1'; } catch {}
  const S = { state: null, pending: null };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clone = o => JSON.parse(JSON.stringify(o));
  const other = n => n === 1 ? 2 : 1;
  const newCode = () => Array.from({length:5}, () => 'abcdefghjkmnpqrstuvwxyz23456789'[Math.floor(Math.random()*31)]).join('');

  function role() {
    if (!S.state) return 0;
    return mode === 'local' ? (cfg.localActor(S.state) || 0) : me1;
  }
  function commit(next, opts) {
    S.state = next; S.pending = null;
    if (mode === 'local' && opts && opts.cover) cover = opts.cover;
    render();
    if (mode === 'online') send();
  }
  function send() {
    if (conn && conn.open) conn.send({ type: 'state', state: clone(S.state) });
    else { notice = 'Not connected to the other player. This will sync when they reconnect.'; render(); }
  }
  function wireConn(c) {
    conn = c;
    c.on('open', () => {
      notice = '';
      if (me1 === 1) { if (S.state.phase === 'lobby') cfg.startRound(S.state); send(); }
      render();
    });
    c.on('data', msg => {
      if (!msg || msg.type !== 'state' || typeof msg.state !== 'object') return;
      const inc = (cfg.merge && S.state && S.state.phase !== 'lobby') ? cfg.merge(S.state, msg.state) : msg.state;
      if (!S.state || S.state.phase !== inc.phase || S.state.round !== inc.round) S.pending = null;
      S.state = inc; loading = false; render();
    });
    c.on('close', () => {
      if (conn !== c) return;
      notice = me1 === 1 ? 'Player 2 disconnected. They can reopen the invite link to rejoin.' : 'Lost connection to Player 1. Reload to rejoin.';
      render();
    });
  }
  function startHost() {
    if (!window.Peer) { notice = "Couldn't load the connection library. Check your internet and reload."; render(); return; }
    mode = 'online'; me1 = 1; room = newCode(); S.state = cfg.freshState(spicy); loading = true; notice = ''; render();
    peer = new Peer(cfg.prefix + room);
    peer.on('open', () => { loading = false; render(); });
    peer.on('connection', c => { if (conn && conn.open) { c.on('open', () => c.close()); return; } wireConn(c); });
    peer.on('disconnected', () => { try { peer.reconnect(); } catch {} });
    peer.on('error', e => {
      if (e.type === 'unavailable-id') { peer.destroy(); startHost(); return; }
      if (e.type === 'network' || e.type === 'server-error') { notice = 'Connection server unreachable. Check your internet and try again.'; render(); }
    });
  }
  function startJoin(code) {
    code = (code || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!code) { notice = 'Enter the game code from Player 1.'; render(); return; }
    if (!window.Peer) { notice = "Couldn't load the connection library. Check your internet and reload."; render(); return; }
    mode = 'online'; me1 = 2; room = code; S.state = null; loading = true; notice = ''; render();
    peer = new Peer();
    const timer = setTimeout(() => { if (loading) { notice = "Still can't reach Player 1. Check the code and that their page is still open."; render(); } }, 10000);
    peer.on('open', () => wireConn(peer.connect(cfg.prefix + code, { reliable: true })));
    peer.on('error', e => {
      clearTimeout(timer);
      if (e.type === 'peer-unavailable') { mode = null; loading = false; notice = `No game found with code "${code}".`; render(); }
      else if (e.type === 'network' || e.type === 'server-error') { notice = 'Connection server unreachable.'; render(); }
    });
  }
  function startLocal() {
    mode = 'local'; S.state = cfg.freshState(spicy); cfg.startRound(S.state); cover = cfg.localActor(S.state) || 1; notice = ''; render();
  }
  function restart() {
    const s = cfg.freshState(S.state ? S.state.spicy : spicy); cfg.startRound(s);
    commit(s, { cover: cfg.localActor(s) || 1 });
  }

  function header() {
    return `<h1>${cfg.titleHTML}</h1><p class="sub">${cfg.subtitle}</p>${notice ? `<div class="notice">${esc(notice)}</div>` : ''}`;
  }
  function spicyToggle() {
    return `<label class="spicy"><input type="checkbox" data-act="spicy" ${spicy ? 'checked' : ''}><span class="sw"></span><span>Spicy mode <small>18+, raunchy and controversial cards</small></span></label>`;
  }
  function renderLanding() {
    let j = ''; try { j = new URLSearchParams(location.search).get('join') || ''; } catch {}
    app.innerHTML = header() + `
      <div class="panel" style="margin-bottom:16px">${spicyToggle()}</div>
      <div class="landing">
        <div class="panel"><h2>Player 1</h2><p>Start a game and send the invite link to your friend.</p><button class="p1" data-act="host">Start a game</button></div>
        <div class="panel"><h2>Player 2</h2><p>Open Player 1's invite link, or type their code.</p>
          <div class="row"><input id="roomInput" value="${esc(j)}" placeholder="code" aria-label="Game code"><button class="p2" data-act="join">Join</button></div></div>
        <div class="panel"><h2>One device</h2><p>Pass the phone back and forth. Answers are hidden before each handover.</p><button class="ghost" data-act="local">Play here</button></div>
      </div>
      <div class="panel" style="margin-top:16px"><p class="meta" style="margin:0;line-height:1.6">${cfg.howTo}</p></div>
      <p class="meta" style="margin-top:16px"><a href="./">← All games</a></p>`;
  }
  function renderLobby() {
    const link = location.href.split('?')[0].split('#')[0] + '?join=' + room;
    app.innerHTML = header() + `
      <div class="panel" style="max-width:520px;display:grid;gap:12px">
        <div class="row" style="justify-content:space-between"><b style="color:var(--p1)">You are Player 1</b><button class="ghost small" data-act="leave">Cancel</button></div>
        <div class="meta">Game code ${S.state && S.state.spicy ? '· 🌶 spicy' : ''}</div><div class="big" style="letter-spacing:4px">${esc(room)}</div>
        <div class="meta">Send your friend this link:</div>
        <div class="row"><input id="shareInput" readonly value="${esc(link)}" style="flex:1;min-width:0"><button class="small" data-act="copy">Copy</button></div>
        <p class="meta" style="margin:0">Waiting for Player 2… keep this page open.</p>
      </div>`;
  }
  function topbar(scoresHTML) {
    const s = S.state;
    return `<div class="top"><div class="row">${scoresHTML}</div>
      <div class="row"><span class="meta">${s.phase === 'over' ? 'Game over' : `Round ${s.round} of ${s.total}`}${s.spicy ? ' · 🌶' : ''}${mode === 'online' ? ' · ' + esc(room) : ''}</span>
      <button class="ghost small" data-act="restartAsk">Restart</button><button class="ghost small" data-act="leave">Leave</button></div></div>`;
  }
  function render() {
    if (!mode) return renderLanding();
    if (mode === 'online' && loading) { app.innerHTML = header() + `<div class="panel">${me1 === 1 ? 'Setting up your game…' : `Connecting to game <b>${esc(room)}</b>…`}</div>`; return; }
    if (mode === 'online' && (!S.state || S.state.phase === 'lobby')) return renderLobby();
    if (mode === 'local' && cover) {
      const c = cover;
      app.innerHTML = `<div class="cover"><div><h2 style="color:var(--p${c})">Pass to Player ${c}</h2>
        <p>${esc(cfg.coverText(S.state, c))}</p><button class="p${c}" data-act="uncover">I'm Player ${c}, show me</button></div></div>`;
      return;
    }
    const ctx = { state: S.state, me: role(), mode, S, esc, other, topbar, header };
    app.innerHTML = header() + cfg.render(ctx);
    if (cfg.afterRender) cfg.afterRender(ctx);
  }

  app.addEventListener('click', e => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const a = el.dataset.act;
    if (a === 'spicy') { spicy = el.checked; try { localStorage.setItem('rmm-spicy', spicy ? '1' : '0'); } catch {} return; }
    if (a === 'host') startHost();
    else if (a === 'join') startJoin(document.getElementById('roomInput')?.value);
    else if (a === 'local') startLocal();
    else if (a === 'uncover') { cover = 0; render(); }
    else if (a === 'restartAsk') { if (el.dataset.sure) restart(); else { el.dataset.sure = '1'; el.textContent = 'Sure? Click again'; } }
    else if (a === 'copy') {
      const inp = document.getElementById('shareInput');
      const done = () => { el.textContent = 'Copied!'; };
      try { navigator.clipboard.writeText(inp.value).then(done, () => { inp.select(); document.execCommand('copy'); done(); }); }
      catch { inp.select(); try { document.execCommand('copy'); done(); } catch {} }
    }
    else if (a === 'leave') {
      try { if (conn) conn.close(); if (peer) peer.destroy(); } catch {}
      conn = peer = null; me1 = 0; mode = null; S.state = null; S.pending = null; notice = ''; render();
    }
    else if (cfg.onAction) cfg.onAction(a, el, { S, commit, render, clone, other, restart, me: role() });
  });
  app.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'roomInput') startJoin(e.target.value); });

  const api = { S, commit, render, clone, other, esc };
  let j = ''; try { j = new URLSearchParams(location.search).get('join') || ''; } catch {}
  if (j) startJoin(j); else render();
  return api;
};

/* pick an unused card from a list, recycling when exhausted */
window.drawFrom = function (list, used) {
  let pool = list.filter(t => !used.includes(typeof t === 'string' ? t : JSON.stringify(t)));
  if (!pool.length) { used.length = 0; pool = list.slice(); }
  const t = pool[Math.floor(Math.random() * pool.length)];
  used.push(typeof t === 'string' ? t : JSON.stringify(t));
  return t;
};
