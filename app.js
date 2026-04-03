/**
 * TennisPro v6.0 — All Features
 * 9 Models + Real Rankings + Top Picks + Tachimeter + Bankroll + First Set + Handicap
 */
const TP = (() => {
  const CFG = {
    W: 'https://tennispro.lucalagan.workers.dev',
    LIVE_MS: 30000,
    WTS: { elo: 0.15, surface: 0.12, form: 0.14, h2h: 0.10, dominance: 0.09, serve: 0.09, fatigue: 0.07, odds: 0.12, smartMoney: 0.12 },
    GPS: { clay: 10.2, grass: 9.6, hard: 9.8, indoor: 9.7, unknown: 9.9 },
  };
  let S = {
    tab: 'matches', dOff: 0, flt: 'all', lFlt: 'all', rk: 'atp', lInt: null,
    matches: [], live: [], hc: {}, oc: {}, theodds: null,
    rankings: { atp: [], wta: [] }, rankMap: {},
    acc: { hit: 0, miss: 0, total: 0 },
    topPicks: [],
    bankroll: JSON.parse(localStorage.getItem('tp_bankroll') || '{"capital":100,"bets":[]}'),
    accHistory: JSON.parse(localStorage.getItem('tp_accuracy') || '{}'),
  };

  // ═══ INIT ═══
  function init() {
    document.getElementById('headerDate').textContent = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    document.querySelectorAll('.nav-tab').forEach(t => t.addEventListener('click', () => swTab(t.dataset.tab)));
    document.querySelectorAll('.date-btn').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('.date-btn').forEach(x => x.classList.remove('active')); b.classList.add('active'); S.dOff = +b.dataset.offset; loadMatches(); }));
    document.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('[data-filter]').forEach(x => x.classList.remove('active')); b.classList.add('active'); S.flt = b.dataset.filter; renderHome(); }));
    document.querySelectorAll('[data-live-filter]').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('[data-live-filter]').forEach(x => x.classList.remove('active')); b.classList.add('active'); S.lFlt = b.dataset.liveFilter; renderLive(); }));
    document.querySelectorAll('[data-ranking]').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('[data-ranking]').forEach(x => x.classList.remove('active')); b.classList.add('active'); S.rk = b.dataset.ranking; loadRank(); }));
    document.getElementById('tournamentsContainer').addEventListener('click', e => { const r = e.target.closest('.match-row[data-ek]'); if (r) openMatch(r.dataset.ek); });
    loadRankingsCache(); // Load real rankings for engine
    loadMatches();
    loadRank();
    loadTheOdds();
  }

  function ds(o = 0) { const d = new Date(); d.setDate(d.getDate() + o); return d.toISOString().split('T')[0]; }
  function swTab(id) { S.tab = id; document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === id)); document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${id}`)); if (id === 'live') startLive(); else stopLive(); if (id === 'rankings') loadRank(); if (id === 'bankroll') renderBankroll(); }
  function goHome() { swTab('matches'); window.scrollTo(0, 0); }

  // ═══ API ═══
  async function api(m, p = {}) {
    try {
      let path = '', q = new URLSearchParams();
      switch (m) { case 'fix': path = `fixtures/${p.date || ds()}`; if (p.etk) q.set('event_type_key', p.etk); break; case 'live': path = 'livescore'; break; case 'h2h': path = 'h2h'; q.set('p1', p.p1); q.set('p2', p.p2); break; case 'stand': path = 'standings'; if (p.etk) q.set('event_type_key', p.etk); break; case 'odds': path = 'odds'; if (p.mk) q.set('match_key', p.mk); break; }
      const qs = q.toString(); return await (await fetch(`${CFG.W}/${path}${qs ? '?' + qs : ''}`)).json();
    } catch (e) { return { success: 0, result: [] }; }
  }
  async function gh(p1, p2) { const k = `${p1}_${p2}`; if (S.hc[k]) return S.hc[k]; const d = await api('h2h', { p1, p2 }); if (d.success === 1 && d.result) { S.hc[k] = d.result; return d.result; } return null; }
  async function go(ek) { if (S.oc[ek]) return S.oc[ek]; const d = await api('odds', { mk: ek }); if (d.success === 1 && d.result) { S.oc[ek] = d.result; return d.result; } return null; }

  // ═══ THE ODDS API ═══
  async function loadTheOdds() {
    try { const r = await fetch(`${CFG.W}/theodds/all?regions=eu`); const d = await r.json(); if (d.success === 1) S.theodds = d.odds; } catch (e) {}
  }
  function normN(n) { return n.toLowerCase().replace(/[^a-z]/g, ''); }
  function mScore(a, b) { const sa = a.split(' ').pop().toLowerCase(), sb = b.split(' ').pop().toLowerCase(); if (sa === sb) return 80; if (sa.includes(sb) || sb.includes(sa)) return 60; return 0; }
  function findTO(p1, p2) {
    if (!S.theodds || !S.theodds.length) return null;
    let best = null, bs = 0;
    for (const m of S.theodds) { const s1 = Math.max(mScore(p1, m.home_team), mScore(p1, m.away_team)); const s2 = Math.max(mScore(p2, m.home_team), mScore(p2, m.away_team)); if (s1 + s2 > bs && s1 >= 60 && s2 >= 60) { bs = s1 + s2; best = m; } }
    if (!best) return null;
    const bks = []; let bH = null, bT = null;
    for (const bk of (best.bookmakers || [])) for (const mk of (bk.markets || [])) {
      if (mk.key === 'h2h' && mk.outcomes) { const o = {}; mk.outcomes.forEach(oc => { if (mScore(p1, oc.name) >= 60) o.p1 = oc.price; else o.p2 = oc.price; }); if (o.p1 && o.p2) { bks.push({ name: bk.title || bk.key, p1: o.p1, p2: o.p2 }); if (!bH) bH = o; } }
      if (mk.key === 'totals' && mk.outcomes) { const t = {}; mk.outcomes.forEach(oc => { if (oc.name === 'Over') { t.over = oc.price; t.line = oc.point; } if (oc.name === 'Under') { t.under = oc.price; t.line = oc.point; } }); if (t.over && t.under && !bT) bT = t; }
    }
    return { bookmakers: bks, h2h: bH, totals: bT, count: bks.length };
  }

  // ═══ RANKINGS CACHE (NEW — Real Rankings) ═══
  async function loadRankingsCache() {
    try {
      const [atp, wta] = await Promise.all([api('stand', { etk: '265' }), api('stand', { etk: '266' })]);
      if (atp.success === 1 && atp.result) { S.rankings.atp = atp.result; atp.result.forEach(p => { const name = p.player_name || p.team_name || ''; if (name) S.rankMap[normN(name)] = +(p.place || 999); }); }
      if (wta.success === 1 && wta.result) { wta.result.forEach(p => { const name = p.player_name || p.team_name || ''; if (name) S.rankMap[normN(name)] = +(p.place || 999); }); }
      console.log(`Rankings loaded: ${Object.keys(S.rankMap).length} players`);
    } catch (e) { console.warn('Rankings load failed:', e); }
  }

  function getRank(playerName) {
    const key = normN(playerName);
    if (S.rankMap[key]) return S.rankMap[key];
    // Try surname only
    const surname = normN(playerName.split(' ').pop());
    for (const [k, v] of Object.entries(S.rankMap)) { if (k.endsWith(surname) || k.includes(surname)) return v; }
    return null;
  }

  // ═══ OPEN MATCH ═══
  async function openMatch(ek) {
    const match = S.matches.find(m => String(m.event_key) === String(ek));
    if (!match) return;
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById('tab-analysis').classList.add('active');
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    window.scrollTo(0, 0);
    const pg = document.getElementById('analysisPage');
    pg.innerHTML = `<div class="loading-state"><div class="loading-spinner"></div><p>🧠 Analisi in corso...</p></div>`;
    const [h2h, odds] = await Promise.all([gh(match.first_player_key, match.second_player_key), go(match.event_key)]);
    const td = findTO(match.event_first_player, match.event_second_player);
    const A = engine(match, h2h, odds, td);
    pg.innerHTML = renderPage(match, A, h2h);
    window.scrollTo(0, 0);
  }

  // ══════════════════════════════════════════
  //  🧠 ENGINE v6 — 9 MODELS + REAL RANKINGS
  // ══════════════════════════════════════════
  function engine(match, h2h, odds, td) {
    const sf = dSurf(match.tournament_name || ''), bo5 = isSl(match.tournament_name || '');
    const M = {};
    M.elo = mElo(h2h, match); M.surface = mSurfM(h2h, match, sf); M.form = mForm(h2h, match);
    M.h2h = mH2H(h2h, match); M.dominance = mDom(h2h, match); M.serve = mSrv(h2h, match);
    M.fatigue = mFat(h2h, match);
    M.odds = td && td.h2h ? mOddsTD(td) : mOdds(odds);
    M.smartMoney = td ? mSmartTD(td, M) : mSmartFb(odds, M);
    // Inject real rankings into Elo model confidence
    const r1 = getRank(match.event_first_player), r2 = getRank(match.event_second_player);
    if (r1 && r2) {
      const rdiff = r2 - r1; // positive = P1 higher ranked
      const rankProb = cl(50 + rdiff * 0.3, 10, 90);
      // Blend ranking into Elo
      if (M.elo.conf > 0) { M.elo.p1 = M.elo.p1 * 0.7 + rankProb * 0.3; M.elo.conf = Math.min(M.elo.conf + 20, 100); }
      else { M.elo.p1 = rankProb; M.elo.conf = Math.min(Math.abs(rdiff) * 1.5, 80); }
      M.elo.det += ` | Rank #${r1} vs #${r2}`;
      M.elo.r1 = r1; M.elo.r2 = r2;
    }
    const C = consensus(M), R = regression(M, C), T = trap(M, C);
    const MK = mkts(C, match, h2h, sf, bo5, M.odds, td);
    const V = verify(match, C, MK);
    return { M, C, R, T, MK, sf, bo5, dq: dqual(M), V, td, r1, r2 };
  }

  // Models (compact)
  function mElo(h, m) { const r = { name: 'Elo + Ranking', icon: '📐', p1: 50, conf: 0, det: '', r1: null, r2: null }; if (!h) return r; const a = h.firstPlayerResults || [], b = h.secondPlayerResults || []; if (a.length < 2 && b.length < 2) return r; let e1 = 1500, e2 = 1500; a.slice(0, 12).reverse().forEach(x => { e1 += 32 * ((iW(x, m.first_player_key) ? 1 : 0) - 1 / (1 + Math.pow(10, (1500 - e1) / 400))); }); b.slice(0, 12).reverse().forEach(x => { e2 += 32 * ((iW(x, m.second_player_key) ? 1 : 0) - 1 / (1 + Math.pow(10, (1500 - e2) / 400))); }); const d = e1 - e2; r.p1 = cl(1 / (1 + Math.pow(10, -d / 400)) * 100, 5, 95); r.conf = Math.min(Math.abs(d) / 2.5, 100); r.det = `Elo ${e1.toFixed(0)} vs ${e2.toFixed(0)}`; return r; }
  function mSurfM(h, m, sf) { const r = { name: 'Superficie', icon: '🏟️', p1: 50, conf: 0, det: '' }; if (!h || sf === 'unknown') return r; const s1 = swn(h.firstPlayerResults || [], m.first_player_key, sf), s2 = swn(h.secondPlayerResults || [], m.second_player_key, sf); const r1 = s1.w / Math.max(s1.t, 1), r2 = s2.w / Math.max(s2.t, 1); r.p1 = cl(50 + (r1 - r2) * 55, 8, 92); r.conf = Math.min((s1.t + s2.t) * 7, 100); r.det = `${(r1 * 100).toFixed(0)}% vs ${(r2 * 100).toFixed(0)}%`; return r; }
  function swn(res, pk, sf) { let w = 0, t = 0; res.slice(0, 15).forEach(m => { if (dSurf(m.tournament_name || '') === sf) { t++; if (iW(m, pk)) w++; } }); return { w, t }; }
  function mForm(h, m) { const r = { name: 'Forma', icon: '🔥', p1: 50, conf: 0, det: '', s1: '', s2: '' }; if (!h) return r; const f1 = wf(h.firstPlayerResults || [], m.first_player_key), f2 = wf(h.secondPlayerResults || [], m.second_player_key); r.p1 = cl(50 + (f1.sc - f2.sc) * 28, 6, 94); r.conf = Math.min((f1.n + f2.n) * 9, 100); r.det = `${(f1.sc * 100).toFixed(0)}% vs ${(f2.sc * 100).toFixed(0)}%`; r.s1 = f1.str; r.s2 = f2.str; return r; }
  function wf(res, pk) { const l = res.slice(0, 8); if (!l.length) return { sc: 0.5, str: '-', n: 0 }; let ws = 0, wt = 0, sk = 0, st = null; l.forEach((m, i) => { const w = 1 - i * 0.1, won = iW(m, pk); ws += won ? w : 0; wt += w; if (i === 0) { st = won; sk = 1; } else if (won === st) sk++; }); return { sc: wt > 0 ? ws / wt : 0.5, str: st ? `${sk}W🟢` : `${sk}L🔴`, n: l.length }; }
  function mH2H(h, m) { const r = { name: 'H2H', icon: '⚔️', p1: 50, conf: 0, det: '', w1: 0, w2: 0 }; if (!h || !h.H2H || !h.H2H.length) return r; let w1 = 0, w2 = 0, rw1 = 0, rw2 = 0; h.H2H.forEach((x, i) => { const p = iW(x, m.first_player_key); if (p) w1++; else w2++; if (i < 3) { if (p) rw1++; else rw2++; } }); const tot = w1 + w2; r.p1 = cl((w1 / tot * 100) * 0.55 + ((rw1 + rw2 > 0 ? rw1 / (rw1 + rw2) * 100 : 50)) * 0.45, 8, 92); r.conf = Math.min(tot * 18, 100); r.det = `${w1}-${w2}`; r.w1 = w1; r.w2 = w2; return r; }
  function mDom(h, m) { const r = { name: 'Dominio', icon: '💪', p1: 50, conf: 0, det: '' }; if (!h) return r; const d1 = cdom(h.firstPlayerResults || [], m.first_player_key), d2 = cdom(h.secondPlayerResults || [], m.second_player_key); if (!d1.n && !d2.n) return r; r.p1 = cl(50 + (d1.idx - d2.idx) * 20, 10, 90); r.conf = Math.min((d1.n + d2.n) * 8, 100); r.det = `${d1.str}/${d1.n} vs ${d2.str}/${d2.n}`; return r; }
  function cdom(res, pk) { let tm = 0, str = 0, n = 0; res.slice(0, 8).forEach(m => { if (!m.scores || !iW(m, pk)) return; n++; const f = String(m.first_player_key) === String(pk); let gw = 0, gl = 0; m.scores.forEach(s => { gw += +(f ? s.score_first : s.score_second) || 0; gl += +(f ? s.score_second : s.score_first) || 0; }); tm += gw - gl; if (m.scores.filter(s => (+(f ? s.score_first : s.score_second) || 0) > (+(f ? s.score_second : s.score_first) || 0)).length === m.scores.length) str++; }); return { idx: cl(n > 0 ? tm / n / 5 : 0, -1, 1), str, n }; }
  function mSrv(h, m) { const r = { name: 'Servizio', icon: '🎯', p1: 50, conf: 0, det: '' }; if (!h) return r; const s1 = cse(h.firstPlayerResults || [], m.first_player_key), s2 = cse(h.secondPlayerResults || [], m.second_player_key); if (!s1.n && !s2.n) return r; r.p1 = cl(50 + (s1.e - s2.e) * 35, 10, 90); r.conf = Math.min((s1.n + s2.n) * 7, 100); r.det = `${(s1.e * 100).toFixed(0)}% vs ${(s2.e * 100).toFixed(0)}%`; return r; }
  function cse(res, pk) { let ts = 0, hr = 0; res.slice(0, 8).forEach(m => { if (!m.scores) return; const f = String(m.first_player_key) === String(pk); m.scores.forEach(s => { const w = +(f ? s.score_first : s.score_second) || 0, l = +(f ? s.score_second : s.score_first) || 0; if (w + l < 6) return; hr += Math.min(w / Math.ceil((w + l) / 2), 1); ts++; }); }); return { e: ts > 0 ? hr / ts : 0.5, n: ts }; }
  function mFat(h, m) { const r = { name: 'Fatica', icon: '🔋', p1: 50, conf: 0, det: '' }; if (!h) return r; const f1 = cfat(h.firstPlayerResults || [], m.event_date), f2 = cfat(h.secondPlayerResults || [], m.event_date); r.p1 = cl(50 + (f2.sc - f1.sc) * 8, 20, 80); r.conf = Math.min((f1.m + f2.m) * 10, 70); r.det = `${f1.lb} vs ${f2.lb}`; return r; }
  function cfat(res, md) { const t = new Date(md || new Date()); let m7 = 0, m3 = 0, ld = 999; res.slice(0, 10).forEach(m => { if (!m.event_date) return; const da = Math.floor((t - new Date(m.event_date)) / 86400000); if (da >= 0 && da <= 7) m7++; if (da >= 0 && da <= 3) m3++; if (da >= 0 && da < ld) ld = da; }); const sc = m3 * 2 + m7 * 0.5 + (ld <= 1 ? 2 : 0); return { sc, m: m7, lb: sc >= 5 ? '🔴Stanco' : sc >= 3 ? '🟡Norm' : '🟢Fresco' }; }
  function mOdds(od) { const r = { name: 'Quote', icon: '💰', p1: 50, conf: 0, det: '', p1O: null, p2O: null, bks: [] }; if (!od) return r; const o = pO(od); if (!o) return r; r.p1O = o.p1; r.p2O = o.p2; const i1 = 1 / o.p1, i2 = 1 / o.p2; r.p1 = (i1 / (i1 + i2)) * 100; r.conf = cl((i1 + i2 - 1) * 200 + 40, 20, 92); r.det = `${o.p1.toFixed(2)} / ${o.p2.toFixed(2)}`; return r; }
  function mOddsTD(td) { const r = { name: 'Quote', icon: '💰', p1: 50, conf: 0, det: '', p1O: null, p2O: null, bks: [] }; if (!td || !td.h2h) return r; r.p1O = td.h2h.p1; r.p2O = td.h2h.p2; r.bks = td.bookmakers || []; const i1 = 1 / td.h2h.p1, i2 = 1 / td.h2h.p2; r.p1 = (i1 / (i1 + i2)) * 100; r.conf = cl((i1 + i2 - 1) * 200 + 40, 20, 95); r.det = `${td.h2h.p1.toFixed(2)} / ${td.h2h.p2.toFixed(2)} (${td.count} book)`; r.totals = td.totals || null; return r; }
  function mSmartTD(td, M) { const r = { name: 'Smart Money', icon: '🧠', p1: 50, conf: 0, det: '', signal: null }; if (!td || !td.bookmakers || td.bookmakers.length < 2) return r; const ps = td.bookmakers.map(b => { const i1 = 1 / b.p1, i2 = 1 / b.p2; return (i1 / (i1 + i2)) * 100; }); const avg = ps.reduce((a, b) => a + b) / ps.length; const sp = Math.max(...ps) - Math.min(...ps); r.p1 = cl(avg, 8, 92); r.conf = cl(90 - sp * 2.5, 15, 92); const of = M.elo.conf > 0 ? (M.elo.p1 >= 50 ? 'P1' : 'P2') : null; const mf = avg >= 50 ? 'P1' : 'P2'; if (of && of === mf && sp < 6) { r.signal = 'CONFERMA'; r.det = `${td.count} book concordi (spread ${sp.toFixed(1)}%)`; } else if (of && of !== mf) { r.signal = 'DIVERGENZA'; r.det = `Soldi vs Modelli`; } else { r.signal = 'NEUTRO'; r.det = `${td.count} bookmaker`; } return r; }
  function mSmartFb(od, M) { return { name: 'Smart Money', icon: '🧠', p1: 50, conf: 0, det: 'N/D', signal: null }; }
  function pO(d) { try { const a = Array.isArray(d) ? d : [d]; for (const e of a) { if (!e) continue; if (e.odd_1 && e.odd_2) return { p1: +e.odd_1, p2: +e.odd_2 }; for (const b of (e.bookmakers || [])) for (const m of (Array.isArray(b.odds || b.markets) ? (b.odds || b.markets) : [])) if (m.odd_1 && m.odd_2) return { p1: +m.odd_1, p2: +m.odd_2 }; } } catch (e) {} return null; }

  // Consensus + Regression + Trap
  function consensus(M) { let ws = 0, wt = 0, ac = 0; const bd = []; Object.entries(CFG.WTS).forEach(([k, w]) => { const m = M[k]; if (!m || m.conf === 0) { bd.push({ k, name: m?.name || k, p1: 50, active: false }); return; } const ew = w * (m.conf / 100); ws += m.p1 * ew; wt += ew; ac++; bd.push({ k, name: m.name, icon: m.icon, p1: m.p1, w: ew, conf: m.conf, active: true }); }); const cp = wt > 0 ? ws / wt : 50; return { p1: cl(cp, 2, 98), p2: cl(100 - cp, 2, 98), conf: (Math.abs(cp - 50) * 2).toFixed(0), fav: cp >= 50 ? 'P1' : 'P2', ac, total: 9, bd }; }
  function regression(M, C) { const ag = mAg(M); const ac = C.bd.filter(b => b.active).reduce((s, b) => s + (b.conf || 0), 0) / Math.max(C.ac, 1); const sc = +C.conf * 0.35 + ag * 0.35 + ac * 0.30; return { sc: sc.toFixed(1), tier: sc >= 72 ? 'gold' : sc >= 52 ? 'silver' : sc >= 32 ? 'bronze' : 'skip', stars: sc >= 82 ? 5 : sc >= 67 ? 4 : sc >= 52 ? 3 : sc >= 37 ? 2 : 1, ag: ag.toFixed(0), ac: ac.toFixed(0) }; }
  function mAg(M) { const p = Object.values(M).filter(m => m && m.conf > 0).map(m => m.p1 >= 50 ? 'P1' : 'P2'); if (!p.length) return 0; return (Math.max(p.filter(x => x === 'P1').length, p.filter(x => x === 'P2').length) / p.length) * 100; }
  function trap(M, C) { const f = []; if (M.odds.conf > 0 && Math.abs(M.odds.p1 - C.p1) > 18) f.push('Quote vs consensus divergono'); if (M.form.conf > 0 && M.h2h.conf > 0 && (M.form.p1 >= 50 ? 'P1' : 'P2') !== (M.h2h.p1 >= 50 ? 'P1' : 'P2') && Math.abs(M.form.p1 - 50) > 12) f.push('Forma e H2H indicano giocatori diversi'); if (M.fatigue.conf > 0 && Math.abs(M.fatigue.p1 - 50) > 15 && (M.fatigue.p1 > 50 ? 'P2' : 'P1') === C.fav) f.push('Favorito potenzialmente stanco'); if (mAg(M) < 65 && +C.conf > 40) f.push('Modelli divisi'); if (M.smartMoney.signal === 'DIVERGENZA') f.push('Smart Money diverge'); return { is: f.length >= 2, sc: Math.min(f.length * 18 + 10, 100), fl: f }; }

  // ═══ MARKETS (expanded: +First Set, +Handicap) ═══
  function mkts(C, m, h, sf, b5, oM, td) {
    const mk = {}; const fn = C.fav === 'P1' ? m.event_first_player : m.event_second_player; const pr = C.fav === 'P1' ? C.p1 : C.p2;
    // Kelly
    let kelly = null; const fo = C.fav === 'P1' ? oM.p1O : oM.p2O;
    if (fo && fo > 1) { const p = pr / 100, b = fo - 1, kf = (b * p - (1 - p)) / b; if (kf > 0) kelly = { f: (kf * 100).toFixed(1), q: (kf * 25).toFixed(1), o: fo.toFixed(2) }; }
    mk.winner = { pick: fn, prob: pr.toFixed(1), vs: C.fav === 'P1' ? m.event_second_player : m.event_first_player, kelly, tier: +C.conf >= 60 ? 'Alta' : +C.conf >= 35 ? 'Media' : 'Bassa' };

    // O/U Games
    const sets = b5 ? 3.2 : 2.3, avg = CFG.GPS[sf] || 9.9, close = 1 - Math.abs(C.p1 - 50) / 50;
    let tg = sets * avg + close * 3.5, ha = null;
    if (h && h.H2H) { const gc = h.H2H.slice(0, 5).map(x => x.scores ? x.scores.reduce((s, sc) => s + (+sc.score_first || 0) + (+sc.score_second || 0), 0) : null).filter(Boolean); if (gc.length) ha = gc.reduce((a, b) => a + b) / gc.length; }
    const adj = ha ? tg * 0.55 + ha * 0.45 : tg;
    // Use TheOddsAPI totals line if available
    const line = td && td.totals ? td.totals.line : (b5 ? 38.5 : Math.round(adj) + 0.5);
    const oP = cl(50 + (adj - line) * 9, 12, 88);
    mk.ou = { line, pred: adj.toFixed(1), pick: oP >= 53 ? `Over ${line}` : oP <= 47 ? `Under ${line}` : 'Neutro', prob: (oP >= 53 ? oP : 100 - oP).toFixed(0), oP: oP.toFixed(0), uP: (100 - oP).toFixed(0), ha: ha ? ha.toFixed(1) : null };

    // Set Score
    const pw = C.p1 / 100; mk.sets = { bo: b5 ? 5 : 3, preds: b5 ? b5S(pw) : b3S(pw) };

    // FIRST SET WINNER (NEW)
    // First set is more volatile, serve matters more — adjust probability
    const firstSetAdj = pw * 0.85 + 0.075; // compress toward 50%
    mk.firstSet = { pick: firstSetAdj >= 0.5 ? m.event_first_player : m.event_second_player, prob: (Math.max(firstSetAdj, 1 - firstSetAdj) * 100).toFixed(0) };

    // SET HANDICAP (NEW)
    const straightProb = mk.sets.preds.filter(x => x.f === C.fav && (x.s === '2-0' || x.s === '3-0')).reduce((s, x) => s + +x.p, 0);
    mk.handicap = {
      favMinus: { label: `${fn} -1.5 Set`, prob: straightProb.toFixed(0) },
      undPlus: { label: `${mk.winner.vs} +1.5 Set`, prob: (100 - straightProb).toFixed(0) },
    };

    return mk;
  }
  function b3S(p) { const s = Math.pow(p, 0.82), q = 1 - s; const sc = [{ s: '2-0', p: s * s, f: 'P1' }, { s: '2-1', p: 2 * s * q * s, f: 'P1' }, { s: '0-2', p: q * q, f: 'P2' }, { s: '1-2', p: 2 * s * q * q, f: 'P2' }]; const t = sc.reduce((a, b) => a + b.p, 0); return sc.map(x => ({ ...x, p: ((x.p / t) * 100).toFixed(1) })).sort((a, b) => b.p - a.p); }
  function b5S(p) { const s = Math.pow(p, 0.82), q = 1 - s; const sc = [{ s: '3-0', p: s ** 3, f: 'P1' }, { s: '3-1', p: 3 * s ** 3 * q, f: 'P1' }, { s: '3-2', p: 6 * s ** 3 * q ** 2, f: 'P1' }, { s: '0-3', p: q ** 3, f: 'P2' }, { s: '1-3', p: 3 * q ** 3 * s, f: 'P2' }, { s: '2-3', p: 6 * q ** 3 * s ** 2, f: 'P2' }]; const t = sc.reduce((a, b) => a + b.p, 0); return sc.map(x => ({ ...x, p: ((x.p / t) * 100).toFixed(1) })).sort((a, b) => b.p - a.p); }
  function verify(m, C, MK) { if (m.event_status !== 'Finished' || !m.event_winner) return null; const pf = C.fav === 'P1' ? 'First Player' : 'Second Player'; const v = { hit: m.event_winner === pf, actualName: m.event_winner === 'First Player' ? m.event_first_player : m.event_second_player, totalGames: (m.scores || []).reduce((s, sc) => s + (+sc.score_first || 0) + (+sc.score_second || 0), 0), ouHit: null }; if (MK.ou) v.ouHit = MK.ou.pick.includes('Over') ? v.totalGames > MK.ou.line : MK.ou.pick.includes('Under') ? v.totalGames < MK.ou.line : null; const as = (m.scores || []).reduce((a, sc) => { if (+sc.score_first > +sc.score_second) a.p1++; else a.p2++; return a; }, { p1: 0, p2: 0 }); v.setScore = `${as.p1}-${as.p2}`; v.setHit = MK.sets.preds[0]?.s === v.setScore; return v; }
  function dqual(M) { const a = Object.values(M).filter(m => m && m.conf > 0).length; return a >= 7 ? { l: 'HD', c: '#34d399' } : a >= 4 ? { l: 'MD', c: '#f59e0b' } : { l: 'LD', c: '#f87171' }; }
  function iW(m, pk) { const f = String(m.first_player_key) === String(pk); return (f && m.event_winner === 'First Player') || (!f && m.event_winner === 'Second Player'); }
  function dSurf(n) { n = n.toLowerCase(); if (/roland.garros|french.open|rome|roma|madrid|monte.carlo|barcelona|rio|buenos.aires|lyon|hamburg|kitzbuhel|bastad|gstaad|umag|bucharest|marrakech|cordoba|estoril|geneva|parma|sardegna/i.test(n)) return 'clay'; if (/wimbledon|queen|halle|eastbourne|hertogenbosch|mallorca|stuttgart|nottingham/i.test(n)) return 'grass'; if (/paris.masters|paris.indoor|vienna|basel|stockholm|petersburg|moscow|sofia|metz|astana|marseille|dallas|montpellier/i.test(n)) return 'indoor'; return 'hard'; }
  function isSl(n) { return /roland.garros|french.open|wimbledon|us.open|australian.open/i.test(n); }
  function cl(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // ══════════════════════════════════════════
  //  RENDER ANALYSIS PAGE + TACHIMETER
  // ══════════════════════════════════════════
  function tachSVG(score) {
    const s = +score; const angle = -90 + (s / 100) * 180;
    const color = s >= 70 ? '#34d399' : s >= 50 ? '#f59e0b' : s >= 30 ? '#f97316' : '#f87171';
    return `<svg viewBox="0 0 200 120" class="tach-svg"><defs><linearGradient id="tg1" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#f87171"/><stop offset="33%" stop-color="#f97316"/><stop offset="66%" stop-color="#f59e0b"/><stop offset="100%" stop-color="#34d399"/></linearGradient></defs><path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="rgba(148,163,184,0.1)" stroke-width="12" stroke-linecap="round"/><path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="url(#tg1)" stroke-width="12" stroke-linecap="round" stroke-dasharray="${s * 2.51} 251" opacity="0.8"/><line x1="100" y1="100" x2="${100 + 60 * Math.cos(angle * Math.PI / 180)}" y2="${100 + 60 * Math.sin(angle * Math.PI / 180)}" stroke="${color}" stroke-width="3" stroke-linecap="round"/><circle cx="100" cy="100" r="5" fill="${color}"/><text x="100" y="88" text-anchor="middle" fill="${color}" font-size="28" font-weight="800" font-family="'JetBrains Mono',monospace">${s}</text><text x="100" y="102" text-anchor="middle" fill="#64748b" font-size="10" font-family="'JetBrains Mono',monospace">/100</text></svg>`;
  }

  function renderPage(m, A, h2h) {
    const { M, C, R, T, MK, sf, bo5, dq, V, r1, r2 } = A;
    const p1 = m.event_first_player, p2 = m.event_second_player;
    const fav = C.fav === 'P1' ? p1 : p2, fp = C.fav === 'P1' ? C.p1 : C.p2;
    const isF = m.event_status === 'Finished';
    const tl = R.tier === 'gold' ? 'A+ GIOCABILE' : R.tier === 'silver' ? 'B+ GIOCABILE' : R.tier === 'bronze' ? 'C CAUTELA' : 'D SKIP';

    let h = `<button class="back-btn" onclick="TP.goHome()">← Partite</button>`;

    // Result verification for finished
    if (isF && V) {
      h += `<div class="result-final ${V.hit ? 'hit' : 'miss'}"><div class="result-final-header"><span class="result-final-icon">${V.hit ? '✅' : '❌'}</span><span>Risultato FINALE</span><span class="result-final-badge ${V.hit ? 'hit' : 'miss'}">${V.hit ? 'PRESO' : 'SBAGLIATO'}</span></div><div class="result-final-scores"><div class="result-final-player ${m.event_winner === 'First Player' ? 'winner' : ''}">${p1}</div><div class="result-final-sets">${(m.scores || []).map(s => `<span class="rf-set ${+s.score_first > +s.score_second ? 'won' : ''}">${s.score_first}-${s.score_second}</span>`).join('')}</div><div class="result-final-player right ${m.event_winner === 'Second Player' ? 'winner' : ''}">${p2}</div></div><div class="result-checks"><div class="result-check ${V.hit ? 'hit' : 'miss'}"><span>Vincente</span><strong>Prev: ${fav}</strong><span>${V.hit ? '✅' : '❌'} ${V.actualName}</span></div>${V.ouHit !== null ? `<div class="result-check ${V.ouHit ? 'hit' : 'miss'}"><span>O/U</span><strong>${MK.ou.pick}</strong><span>${V.ouHit ? '✅' : '❌'} ${V.totalGames}g</span></div>` : ''}<div class="result-check ${V.setHit ? 'hit' : 'miss'}"><span>Set</span><strong>${MK.sets.preds[0]?.s}</strong><span>${V.setHit ? '✅' : '❌'} ${V.setScore}</span></div></div></div>`;
    }

    // Header
    h += `<div class="ap-header"><div class="ap-header-info"><span class="surface-badge ${sf}">${sf.toUpperCase()}</span> ${m.tournament_name || ''} • ${m.event_type_type || ''} • ${m.event_time || ''}${bo5 ? ' • <span style="color:var(--gold)">Grand Slam</span>' : ''}</div><div class="ap-header-badges"><span class="data-quality-badge" style="color:${dq.c};border-color:${dq.c}">📡 ${dq.l}</span>${r1 ? `<span style="font-size:0.78rem">${p1.split(' ').pop()}: #${r1}</span>` : ''}${r2 ? `<span style="font-size:0.78rem">${p2.split(' ').pop()}: #${r2}</span>` : ''}${M.form.s1 ? `<span style="font-size:0.78rem">${M.form.s1}</span>` : ''}${M.form.s2 ? `<span style="font-size:0.78rem">${M.form.s2}</span>` : ''}</div></div>`;

    // Matchup
    h += `<div class="ap-matchup"><div class="ap-player ${C.fav === 'P1' ? 'fav' : ''}"><div class="ap-player-name">${p1}</div>${r1 ? `<div class="ap-player-rank">#${r1}</div>` : ''}</div><div class="ap-center"><div class="ap-vs">VS</div></div><div class="ap-player right ${C.fav === 'P2' ? 'fav' : ''}"><div class="ap-player-name">${p2}</div>${r2 ? `<div class="ap-player-rank">#${r2}</div>` : ''}</div></div>`;
    h += `<div class="ap-prob-bar"><div class="ap-prob-fill p1" style="width:${C.p1}%"><span>${C.p1.toFixed(0)}%</span></div><div class="ap-prob-fill p2" style="width:${C.p2}%"><span>${C.p2.toFixed(0)}%</span></div></div>`;

    // TACHIMETER + Models
    h += `<div class="ap-section"><div class="ap-section-header"><span>⚡ Pressione Pre-Match</span><span class="ap-gauge-tier-label" style="color:${R.tier === 'gold' ? 'var(--accent)' : R.tier === 'silver' ? 'var(--gold)' : '#f97316'}">${tl}</span></div><div class="ap-gauge-row"><div class="ap-gauge-tach">${tachSVG(R.sc)}</div><div class="ap-scores-list">${C.bd.filter(b => b.active).map(b => `<div class="ap-score-row"><span class="ap-score-icon">${M[b.k]?.icon || '📊'}</span><span class="ap-score-name">${b.name}</span><div class="ap-score-bar"><div class="ap-score-bar-fill" style="width:${b.p1}%;background:${b.p1 >= 55 ? 'var(--accent)' : b.p1 >= 45 ? 'var(--gold)' : 'var(--lose)'}"></div></div><span class="ap-score-val" style="color:${b.p1 >= 55 ? 'var(--accent)' : b.p1 >= 45 ? 'var(--gold)' : 'var(--lose)'}">${Math.round(b.p1)}</span></div>`).join('')}</div></div></div>`;

    // Odds Lab
    h += renderOddsLab(M, C, p1, p2, A);

    // Smart Money
    if (M.smartMoney.signal) { const sc = M.smartMoney.signal === 'CONFERMA' ? 'var(--accent)' : M.smartMoney.signal === 'DIVERGENZA' ? 'var(--trap)' : 'var(--text-muted)'; h += `<div class="ap-section"><div class="ap-section-header"><span>🧠 Smart Money</span><span class="ap-badge-green" style="color:${sc}">${M.smartMoney.signal}</span></div><p style="font-size:0.85rem;color:var(--text-secondary)">${M.smartMoney.det}</p></div>`; }

    // Kelly
    if (MK.winner.kelly) h += `<div class="ap-section ap-stake"><div class="ap-section-header"><span>💰 Stake Advisor</span><span class="ap-badge-green">¼ Kelly</span></div><div class="ap-stake-grid"><div class="ap-stake-item main"><div class="ap-stake-label">STAKE</div><div class="ap-stake-value">${MK.winner.kelly.q}%</div><div class="ap-stake-sub">del bankroll</div></div><div class="ap-stake-item"><div class="ap-stake-label">QUOTA</div><div class="ap-stake-value">@${MK.winner.kelly.o}</div></div><div class="ap-stake-item"><div class="ap-stake-label">FULL KELLY</div><div class="ap-stake-value">${MK.winner.kelly.f}%</div></div></div></div>`;

    // Trap
    if (T.is) h += `<div class="ap-section ap-trap"><div class="ap-section-header"><span>🕵️ Trap Detector</span><span class="ap-badge-orange">${T.sc}/100</span></div>${T.fl.map(f => `<div class="ap-trap-flag">⚠️ ${f}</div>`).join('')}</div>`;

    // PRONOSTICI (6 markets now)
    h += `<div class="ap-section"><div class="ap-section-header"><span>🎾 Pronostici${isF ? ' (retroattivi)' : ''}</span></div>`;
    h += `<div class="ap-prono-card main"><div class="ap-prono-label">VINCENTE</div><div class="ap-prono-pick">${fav}</div><div class="ap-prono-prob">${fp.toFixed(0)}%</div><div class="ap-prono-conf-badge ${MK.winner.tier === 'Alta' ? 'green' : MK.winner.tier === 'Media' ? 'yellow' : 'red'}">✓ ${MK.winner.tier}</div>${MK.winner.kelly ? `<div class="ap-prono-odds">@ ${MK.winner.kelly.o}</div>` : ''}</div>`;
    // First Set Winner (NEW)
    h += `<div class="ap-prono-card"><div class="ap-prono-label">🏅 PRIMO SET</div><div class="ap-prono-pick">${MK.firstSet.pick}</div><div class="ap-prono-prob">${MK.firstSet.prob}%</div></div>`;
    // O/U
    h += `<div class="ap-prono-card"><div class="ap-prono-label">OVER/UNDER GAME</div><div class="ap-prono-pick">${MK.ou.pick}</div><div class="ap-prono-prob">${MK.ou.prob}%</div><div class="ap-prono-detail">Previsti: ${MK.ou.pred}${MK.ou.ha ? ` • H2H: ${MK.ou.ha}` : ''}</div><div class="ap-ou-bars"><div class="ap-ou-item ${+MK.ou.oP > 50 ? 'active' : ''}"><span>Over ${MK.ou.line}</span><strong>${MK.ou.oP}%</strong></div><div class="ap-ou-item ${+MK.ou.uP > 50 ? 'active' : ''}"><span>Under ${MK.ou.line}</span><strong>${MK.ou.uP}%</strong></div></div></div>`;
    // Set Handicap (NEW)
    h += `<div class="ap-prono-card"><div class="ap-prono-label">📐 HANDICAP SET</div><div class="ap-ou-bars"><div class="ap-ou-item ${+MK.handicap.favMinus.prob > 50 ? 'active' : ''}"><span>${MK.handicap.favMinus.label}</span><strong>${MK.handicap.favMinus.prob}%</strong></div><div class="ap-ou-item ${+MK.handicap.undPlus.prob > 50 ? 'active' : ''}"><span>${MK.handicap.undPlus.label}</span><strong>${MK.handicap.undPlus.prob}%</strong></div></div></div>`;
    // Set Score
    h += `<div class="ap-prono-card"><div class="ap-prono-label">RISULTATO SET (Bo${MK.sets.bo})</div><div class="ap-sets-grid">${MK.sets.preds.map((x, i) => `<div class="ap-set-chip ${i === 0 ? 'top' : ''}"><div class="ap-set-score">${x.s}</div><div class="ap-set-prob">${x.p}%</div><div class="ap-set-who">${x.f === 'P1' ? p1.split(' ').pop() : p2.split(' ').pop()}</div></div>`).join('')}</div></div></div>`;

    // Add to Bankroll button
    if (!isF && MK.winner.kelly) {
      h += `<div style="text-align:center;margin:12px 0"><button class="btn-primary" onclick="TP.addBet('${m.event_key}','${fav.replace(/'/g,"\\'")}',${fp.toFixed(1)},${MK.winner.kelly.o})">💰 Aggiungi al Bankroll</button></div>`;
    }

    // Consensus
    h += `<div class="ap-section"><div class="ap-section-header"><span>🏆 Consensus</span><span class="ap-badge-green">${C.ac}/${C.total} • ${R.ag}%</span></div><div class="ap-consensus-pick"><div class="ap-consensus-name">${fav}</div><div class="ap-consensus-prob">${fp.toFixed(1)}% • Accordo: ${R.ag}%</div></div><div class="ap-consensus-models">${C.bd.filter(b => b.active).map(b => `<div class="ap-cm-chip"><span>${M[b.k]?.icon}</span><span>${b.name}</span><strong style="color:${b.p1 >= 50 ? 'var(--accent)' : 'var(--lose)'}">${b.p1 >= 50 ? p1.split(' ').pop() : p2.split(' ').pop()}</strong><span class="ap-cm-pct">${Math.max(b.p1, 100 - b.p1).toFixed(0)}%</span></div>`).join('')}</div></div>`;

    // H2H with surface filter
    if (h2h && h2h.H2H && h2h.H2H.length) {
      const all = h2h.H2H;
      const surfMatches = all.filter(x => dSurf(x.tournament_name || '') === sf);
      h += `<div class="ap-section"><div class="ap-section-header"><span>⚔️ Precedenti (${all.length})</span><span style="font-size:0.78rem;color:var(--text-muted)">${M.h2h.w1}-${M.h2h.w2}${surfMatches.length ? ` | Su ${sf}: ${surfMatches.length}` : ''}</span></div>`;
      if (surfMatches.length > 0 && surfMatches.length < all.length) {
        h += `<div style="font-size:0.78rem;color:var(--gold);margin-bottom:8px">🏟️ Su ${sf.toUpperCase()} (${surfMatches.length}):</div><div class="h2h-mini-list" style="margin-bottom:12px">${surfMatches.slice(0, 4).map(x => h2hRow(x)).join('')}</div><div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:8px">Tutti:</div>`;
      }
      h += `<div class="h2h-mini-list">${all.slice(0, 6).map(x => h2hRow(x)).join('')}</div></div>`;
    }

    h += `<div style="text-align:center;padding:2rem 0;color:var(--text-dim);font-size:0.72rem">⚠️ Solo scopo informativo</div>`;
    return h;
  }

  function h2hRow(x) { const sc = x.scores ? x.scores.map(s => `${s.score_first}-${s.score_second}`).join(' ') : x.event_final_result || ''; return `<div class="h2h-mini-row"><span class="h2h-mini-date">${x.event_date || ''}</span><span class="h2h-mini-player ${x.event_winner === 'First Player' ? 'winner' : ''}">${x.event_first_player}</span><span class="h2h-mini-score">${sc}</span><span class="h2h-mini-player right ${x.event_winner === 'Second Player' ? 'winner' : ''}">${x.event_second_player}</span></div>`; }

  function renderOddsLab(M, C, p1, p2) {
    const hasOdds = M.odds.p1O && M.odds.p2O;
    const ourP1 = C.p1, ourP2 = C.p2;
    const mQ1 = (1 / (ourP1 / 100)).toFixed(2), mQ2 = (1 / (ourP2 / 100)).toFixed(2);
    if (hasOdds) {
      const q1 = M.odds.p1O, q2 = M.odds.p2O, i1 = 1 / q1, i2 = 1 / q2;
      const mg = ((i1 + i2 - 1) * 100).toFixed(1), fP1 = (i1 / (i1 + i2) * 100), fP2 = 100 - fP1;
      const d1 = ourP1 - fP1, d2 = ourP2 - fP2, v1 = d1 > 3, v2 = d2 > 3;
      const vb = v1 || v2 ? `<span class="ap-badge-green">💎 VALUE</span>` : `<span style="font-size:0.72rem;color:var(--text-dim)">Mg: ${mg}%</span>`;
      let html = `<div class="ap-section"><div class="ap-section-header"><span>📊 Odds Lab</span>${vb}</div><div class="odds-table"><div class="odds-header"><span></span><span>Quota</span><span>Book</span><span>Modello</span><span>Δ</span><span></span></div>`;
      html += `<div class="odds-row ${v1 ? 'value' : ''}"><span class="odds-name">${p1.split(' ').pop()}</span><span class="odds-q">${q1.toFixed(2)}</span><span>${fP1.toFixed(0)}%</span><span class="odds-our">${ourP1.toFixed(0)}%</span><span class="odds-delta ${d1 > 0 ? 'pos' : 'neg'}">${d1 > 0 ? '+' : ''}${d1.toFixed(1)}</span><span>${v1 ? '<span class="value-tag">💎</span>' : ''}</span></div>`;
      html += `<div class="odds-row ${v2 ? 'value' : ''}"><span class="odds-name">${p2.split(' ').pop()}</span><span class="odds-q">${q2.toFixed(2)}</span><span>${fP2.toFixed(0)}%</span><span class="odds-our">${ourP2.toFixed(0)}%</span><span class="odds-delta ${d2 > 0 ? 'pos' : 'neg'}">${d2 > 0 ? '+' : ''}${d2.toFixed(1)}</span><span>${v2 ? '<span class="value-tag">💎</span>' : ''}</span></div></div>`;
      if (v1 || v2) html += `<div class="odds-value-msg">${v1 ? `VALUE ${p1.split(' ').pop()}: Δ+${d1.toFixed(1)} @${q1.toFixed(2)}` : `VALUE ${p2.split(' ').pop()}: Δ+${d2.toFixed(1)} @${q2.toFixed(2)}`}</div>`;
      if (M.odds.bks && M.odds.bks.length > 1) html += `<div class="odds-bk-title">📋 ${M.odds.bks.length} Bookmaker</div><div class="odds-bk-list">${M.odds.bks.slice(0, 8).map(b => `<div class="odds-bk-row"><span class="odds-bk-name">${b.name}</span><span class="odds-bk-q">${b.p1.toFixed(2)}</span><span class="odds-bk-q">${b.p2.toFixed(2)}</span></div>`).join('')}</div>`;
      return html + `<div class="odds-margin">Fair: ${(1 / (fP1 / 100)).toFixed(2)} / ${(1 / (fP2 / 100)).toFixed(2)}</div></div>`;
    }
    return `<div class="ap-section"><div class="ap-section-header"><span>📊 Odds Lab — Fair Odds</span></div><div class="odds-table"><div class="odds-header cols4"><span></span><span>Fair Q.</span><span>Prob.</span><span></span></div><div class="odds-row ${ourP1 > ourP2 ? 'value' : ''}"><span class="odds-name">${p1.split(' ').pop()}</span><span class="odds-q">${mQ1}</span><span class="odds-our">${ourP1.toFixed(0)}%</span><span>${ourP1 > 55 ? '<span class="value-tag">📈</span>' : ''}</span></div><div class="odds-row ${ourP2 > ourP1 ? 'value' : ''}"><span class="odds-name">${p2.split(' ').pop()}</span><span class="odds-q">${mQ2}</span><span class="odds-our">${ourP2.toFixed(0)}%</span><span>${ourP2 > 55 ? '<span class="value-tag">📈</span>' : ''}</span></div></div><div class="odds-value-msg" style="background:rgba(245,158,11,0.08);border-color:var(--gold);color:var(--gold)">⚠️ Quote book N/D. Cerca ≥ ${ourP1 > ourP2 ? mQ1 : mQ2} su ${ourP1 > ourP2 ? p1.split(' ').pop() : p2.split(' ').pop()}</div></div>`;
  }

  // ══════════════════════════════════════════
  //  HOME: TOURNAMENTS + TOP PICKS
  // ══════════════════════════════════════════
  async function loadMatches() {
    const c = document.getElementById('tournamentsContainer');
    c.innerHTML = `<div class="loading-state"><div class="loading-spinner"></div><p>Caricamento...</p></div>`;
    const d = await api('fix', { date: ds(S.dOff) });
    if (d.success === 1 && d.result && d.result.length) { S.matches = d.result; renderHome(); }
    else c.innerHTML = `<div class="empty-state"><div class="empty-icon">🎾</div><div class="empty-title">Nessuna partita per ${ds(S.dOff)}</div></div>`;
  }

  function renderHome() {
    const c = document.getElementById('tournamentsContainer');
    let m = [...S.matches];
    if (S.flt !== 'all') m = m.filter(x => (x.event_type_type || '').toLowerCase().includes(S.flt));
    const g = {}; m.forEach(x => { const k = x.tournament_key || x.tournament_name || '?'; if (!g[k]) g[k] = { name: x.tournament_name || '?', type: x.event_type_type || '', key: k, m: [] }; g[k].m.push(x); });
    const ts = Object.values(g).sort((a, b) => a.name.localeCompare(b.name));
    if (!ts.length) { c.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-title">Nessun torneo</div></div>`; return; }
    S.acc = { hit: 0, miss: 0, total: 0 }; S.topPicks = [];
    c.innerHTML = ts.map(t => {
      const sf = dSurf(t.name), up = t.m.filter(x => x.event_status !== 'Finished').length;
      return `<div class="tournament-card open"><div class="tournament-header" onclick="this.parentElement.classList.toggle('open')"><div class="tournament-info"><span class="surface-badge ${sf}">${sf.toUpperCase()}</span><span class="tournament-name">${t.name}</span><span class="tournament-type">${t.type.replace(/Singles|Doubles/gi, '').trim()}</span></div><div class="tournament-meta"><span class="tournament-count">${t.m.length}</span>${up ? `<span class="tournament-upcoming">${up} da giocare</span>` : ''}<span class="tournament-arrow">▾</span></div></div><div class="tournament-matches">${t.m.sort((a, b) => (a.event_status === 'Finished' ? 1 : 0) - (b.event_status === 'Finished' ? 1 : 0) || (a.event_time || '').localeCompare(b.event_time || '')).map(x => rmr(x)).join('')}</div></div>`;
    }).join('');
    loadQuickPreds();
  }

  function rmr(m) {
    const isF = m.event_status === 'Finished', isL = m.event_live === '1';
    let sc = ''; if (m.scores && m.scores.length) sc = m.scores.map(s => `<span class="set-score-mini ${+s.score_first > +s.score_second ? 'won' : ''}">${s.score_first}-${s.score_second}</span>`).join(' ');
    const st = isF ? `<span class="status-badge finished">✓</span>` : isL ? `<span class="status-badge live">LIVE</span>` : `<span class="status-badge upcoming">${m.event_time || 'TBD'}</span>`;
    const rd = m.tournament_round ? m.tournament_round.replace(m.tournament_name || '', '').replace(/^\s*-\s*/, '').trim() : '';
    return `<div class="match-row clickable ${isL ? 'live' : ''}" data-ek="${m.event_key}"><div class="match-row-status">${st}</div><div class="match-row-players"><span class="match-row-p ${m.event_winner === 'First Player' ? 'winner' : ''}">${m.event_first_player}</span><span class="match-row-vs">vs</span><span class="match-row-p ${m.event_winner === 'Second Player' ? 'winner' : ''}">${m.event_second_player}</span></div><div class="match-row-pred" id="pred-${m.event_key}"><span class="pred-loading">⏳</span></div><div class="match-row-score">${sc}</div><div class="match-row-round">${rd}</div><div class="match-row-cta">📊</div></div>`;
  }

  async function loadQuickPreds() {
    S.acc = { hit: 0, miss: 0, total: 0 }; S.topPicks = [];
    for (const match of S.matches) {
      if (S.tab !== 'matches') break;
      try {
        const h2h = await gh(match.first_player_key, match.second_player_key);
        const td = findTO(match.event_first_player, match.event_second_player);
        const A = engine(match, h2h, null, td);
        const el = document.getElementById(`pred-${match.event_key}`);
        if (!el) continue;
        const C = A.C, R = A.R;
        const favN = C.fav === 'P1' ? match.event_first_player.split(' ').pop() : match.event_second_player.split(' ').pop();
        const prob = Math.round(C.fav === 'P1' ? C.p1 : C.p2);
        const isF = match.event_status === 'Finished';

        if (isF && A.V) {
          S.acc.total++; if (A.V.hit) S.acc.hit++; else S.acc.miss++;
          el.innerHTML = `<span class="pred-badge ${A.V.hit ? 'hit' : 'miss'}"><span class="pred-icon">${A.V.hit ? '✅' : '❌'}</span><span class="pred-name">${favN}</span><span class="pred-pct">${prob}%</span></span>`;
          updateAccuracy();
          saveAccuracy(ds(S.dOff), A.V.hit);
        } else if (!isF) {
          const cls = prob >= 65 ? 'green' : prob >= 52 ? 'yellow' : 'red';
          el.innerHTML = `<span class="pred-badge ${cls}"><span class="pred-name">${favN}</span><span class="pred-pct">${prob}%</span></span>`;
          if (R.tier === 'gold' || (R.tier === 'silver' && prob >= 62)) {
            S.topPicks.push({ match, fav: C.fav === 'P1' ? match.event_first_player : match.event_second_player, prob, tier: R.tier, sc: R.sc, ek: match.event_key });
          }
          renderTopPicks();
        }
      } catch (e) { const el = document.getElementById(`pred-${match.event_key}`); if (el) el.innerHTML = ''; }
    }
  }

  function renderTopPicks() {
    const c = document.getElementById('topPicksContainer');
    if (!S.topPicks.length) { c.style.display = 'none'; return; }
    c.style.display = 'block';
    const sorted = S.topPicks.sort((a, b) => +b.sc - +a.sc).slice(0, 5);
    c.innerHTML = `<div class="top-picks-card"><div class="top-picks-header"><span>🎯 Top Picks del Giorno</span><span class="top-picks-count">${sorted.length} pick</span></div><div class="top-picks-list">${sorted.map(p => `<div class="top-pick-item" onclick="TP.openMatch('${p.ek}')"><div class="top-pick-left"><span class="tier-dot ${p.tier}"></span><span class="top-pick-name">${p.fav}</span></div><div class="top-pick-right"><span class="top-pick-vs">vs ${p.match.event_first_player === p.fav ? p.match.event_second_player.split(' ').pop() : p.match.event_first_player.split(' ').pop()}</span><span class="top-pick-prob">${p.prob}%</span><span class="top-pick-score">${p.sc}</span></div></div>`).join('')}</div></div>`;
  }

  function updateAccuracy() {
    const bar = document.getElementById('accuracyBar');
    if (!S.acc.total) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    const pct = ((S.acc.hit / S.acc.total) * 100).toFixed(0);
    const cls = +pct >= 70 ? 'green' : +pct >= 50 ? 'yellow' : 'red';
    bar.innerHTML = `<div class="acc-label">📊 Accuracy</div><div class="acc-stats"><span class="acc-pct ${cls}">${pct}%</span><span class="acc-detail">✅${S.acc.hit} ❌${S.acc.miss} / ${S.acc.total}</span></div><div class="acc-bar-track"><div class="acc-bar-fill ${cls}" style="width:${pct}%"></div></div>`;
  }

  function saveAccuracy(date, hit) {
    if (!S.accHistory[date]) S.accHistory[date] = { h: 0, m: 0 };
    if (hit) S.accHistory[date].h++; else S.accHistory[date].m++;
    localStorage.setItem('tp_accuracy', JSON.stringify(S.accHistory));
  }

  // ═══ BANKROLL MANAGER ═══
  function addBet(ek, pick, prob, odds) {
    const stake = (S.bankroll.capital * (+prob > 65 ? 0.15 : +prob > 55 ? 0.10 : 0.05)).toFixed(2);
    S.bankroll.bets.push({ ek, pick, prob: +prob, odds: +odds, stake: +stake, date: ds(), result: null });
    saveBankroll();
    alert(`✅ Scommessa aggiunta: ${pick} @${odds} — Stake: €${stake}`);
  }

  function resolveBet(idx, won) {
    const b = S.bankroll.bets[idx];
    if (!b) return;
    b.result = won ? 'win' : 'loss';
    if (won) S.bankroll.capital += b.stake * (b.odds - 1);
    else S.bankroll.capital -= b.stake;
    S.bankroll.capital = +S.bankroll.capital.toFixed(2);
    saveBankroll(); renderBankroll();
  }

  function saveBankroll() { localStorage.setItem('tp_bankroll', JSON.stringify(S.bankroll)); }

  function renderBankroll() {
    const d = document.getElementById('bankrollDashboard');
    const bets = S.bankroll.bets;
    const won = bets.filter(b => b.result === 'win').length;
    const lost = bets.filter(b => b.result === 'loss').length;
    const pending = bets.filter(b => !b.result).length;
    const profit = bets.reduce((s, b) => s + (b.result === 'win' ? b.stake * (b.odds - 1) : b.result === 'loss' ? -b.stake : 0), 0);
    const roi = bets.filter(b => b.result).length > 0 ? (profit / bets.filter(b => b.result).reduce((s, b) => s + b.stake, 0) * 100) : 0;

    d.innerHTML = `<div class="bk-grid"><div class="bk-card main"><div class="bk-label">CAPITALE</div><div class="bk-value">€${S.bankroll.capital.toFixed(2)}</div></div><div class="bk-card ${profit >= 0 ? 'pos' : 'neg'}"><div class="bk-label">PROFIT/LOSS</div><div class="bk-value">${profit >= 0 ? '+' : ''}€${profit.toFixed(2)}</div></div><div class="bk-card"><div class="bk-label">ROI</div><div class="bk-value">${roi.toFixed(1)}%</div></div><div class="bk-card"><div class="bk-label">W/L/P</div><div class="bk-value">${won}/${lost}/${pending}</div></div></div><div style="margin-top:12px"><label style="font-size:0.78rem;color:var(--text-muted)">Capitale iniziale: </label><input type="number" value="${S.bankroll.capital}" style="width:80px;padding:4px 8px;background:var(--bg-surface);border:1px solid var(--border);border-radius:4px;color:var(--text-primary);font-family:var(--font-mono);font-size:0.82rem" onchange="TP.setCapital(this.value)"></div>`;

    const hist = document.getElementById('bankrollHistory');
    hist.innerHTML = bets.length ? bets.slice().reverse().map((b, ri) => {
      const i = bets.length - 1 - ri;
      return `<div class="bk-bet-row ${b.result || 'pending'}"><div class="bk-bet-pick">${b.pick} @${b.odds.toFixed(2)}</div><div class="bk-bet-stake">€${b.stake.toFixed(2)}</div><div class="bk-bet-date">${b.date}</div><div class="bk-bet-result">${b.result === 'win' ? '✅ +€' + (b.stake * (b.odds - 1)).toFixed(2) : b.result === 'loss' ? '❌ -€' + b.stake.toFixed(2) : `<button class="bk-btn win" onclick="TP.resolveBet(${i},true)">✅</button><button class="bk-btn loss" onclick="TP.resolveBet(${i},false)">❌</button>`}</div></div>`;
    }).join('') : '<div class="empty-state"><div class="empty-title">Nessuna scommessa</div></div>';

    // Accuracy history
    const days = Object.entries(S.accHistory).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 7);
    if (days.length) {
      hist.innerHTML += `<div style="margin-top:1.5rem;font-size:0.9rem;font-weight:600;color:var(--text-secondary);margin-bottom:8px">📊 Accuracy Storica</div>${days.map(([d, v]) => { const pct = ((v.h / (v.h + v.m)) * 100).toFixed(0); return `<div class="bk-bet-row"><div class="bk-bet-pick">${d}</div><div class="bk-bet-stake">✅${v.h} ❌${v.m}</div><div class="bk-bet-result"><span class="acc-pct ${+pct >= 70 ? 'green' : +pct >= 50 ? 'yellow' : 'red'}">${pct}%</span></div></div>`; }).join('')}`;
    }
  }

  function setCapital(v) { S.bankroll.capital = +v || 100; saveBankroll(); renderBankroll(); }

  // ═══ LIVE / RANK ═══
  async function loadLive() { const c = document.getElementById('liveContainer'); const d = await api('live'); if (d.success === 1 && d.result && d.result.length) { S.live = d.result; document.getElementById('liveCount').textContent = d.result.length; document.getElementById('liveCount').style.display = 'inline'; renderLive(); } else { S.live = []; document.getElementById('liveCount').style.display = 'none'; c.innerHTML = `<div class="empty-state"><div class="empty-icon">😴</div><div class="empty-title">Nessun match live</div></div>`; } }
  function renderLive() { const c = document.getElementById('liveContainer'); let m = [...S.live]; if (S.lFlt !== 'all') m = m.filter(x => (x.event_type_type || '').toLowerCase().includes(S.lFlt)); if (!m.length) { c.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div></div>`; return; } c.innerHTML = m.map(x => { const sv = x.event_serve; let sH = ''; if (x.scores && x.scores.length) sH = `<div class="match-score">${x.scores.map(s => `<div class="set-score ${+s.score_first > +s.score_second ? 'won' : ''}">${s.score_first}-${s.score_second}</div>`).join('')}</div>`; const gs = x.event_game_result || ''; return `<div class="match-card live"><div class="match-card-header"><span class="match-tournament"><span class="surface-badge ${dSurf(x.tournament_name || '')}">${dSurf(x.tournament_name || '').toUpperCase()}</span> ${x.tournament_name || ''}</span><span class="match-time live">● ${x.event_status || 'LIVE'}</span></div><div class="match-players"><div class="player"><span class="player-name">${sv === 'First Player' ? '🎾 ' : ''}${x.event_first_player}</span></div><div style="text-align:center">${sH}${gs && gs !== '-' ? `<div style="font-family:var(--font-mono);font-size:1rem;color:var(--gold);margin-top:6px;font-weight:700">${gs}</div>` : ''}</div><div class="player right"><span class="player-name">${sv === 'Second Player' ? '🎾 ' : ''}${x.event_second_player}</span></div></div></div>`; }).join(''); }
  function startLive() { loadLive(); S.lInt = setInterval(loadLive, CFG.LIVE_MS); } function stopLive() { if (S.lInt) { clearInterval(S.lInt); S.lInt = null; } }
  async function loadRank() { const c = document.getElementById('rankingsContainer'); c.innerHTML = `<div class="loading-state"><div class="loading-spinner"></div></div>`; const d = await api('stand', { etk: S.rk === 'atp' ? '265' : '266' }); if (d.success === 1 && d.result && d.result.length) { c.innerHTML = `<table class="rankings-table"><thead><tr><th>#</th><th>Giocatore</th><th>Punti</th></tr></thead><tbody>${d.result.slice(0, 100).map((p, i) => `<tr><td><span class="rank-number ${(p.place || i + 1) <= 3 ? 'top-3' : ''}">${p.place || i + 1}</span></td><td>${p.player_name || p.team_name || '-'}</td><td class="stat-mono">${p.points || p.team_points || '-'}</td></tr>`).join('')}</tbody></table>`; } else c.innerHTML = `<div class="empty-state"><div class="empty-icon">🏆</div><div class="empty-title">Non disponibile</div></div>`; }

  return { init, openMatch, goHome, switchTab: swTab, addBet, resolveBet, setCapital };
})();
document.addEventListener('DOMContentLoaded', TP.init);
