/**
 * TennisPro v4.0 — BettingPro-style Full Page Analysis
 * 8 Models + Consensus + Trap + Kelly + Explicit Predictions
 */
const TP = (() => {

  const CFG = {
    WORKER: 'https://tennispro.lucalagan.workers.dev',
    LIVE_MS: 30000,
    WEIGHTS: { elo: 0.18, surface: 0.14, form: 0.16, h2h: 0.12, dominance: 0.10, serve: 0.10, fatigue: 0.08, odds: 0.12 },
    GAMES_PER_SET: { clay: 10.2, grass: 9.6, hard: 9.8, indoor: 9.7, unknown: 9.9 },
    EVENT: { ATP: '265', WTA: '266', CHALLENGER: '281' },
  };

  let S = { tab: 'matches', dateOff: 0, filter: 'all', liveFilter: 'all', rankType: 'atp', liveInt: null, matches: [], live: [], h2hCache: {}, oddsCache: {} };

  // ═══════ INIT ═══════
  function init() {
    document.getElementById('headerDate').textContent = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    document.querySelectorAll('.nav-tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
    document.querySelectorAll('.date-btn').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('.date-btn').forEach(x => x.classList.remove('active')); b.classList.add('active'); S.dateOff = +b.dataset.offset; loadMatches(); }));
    document.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('[data-filter]').forEach(x => x.classList.remove('active')); b.classList.add('active'); S.filter = b.dataset.filter; renderTournaments(); }));
    document.querySelectorAll('[data-live-filter]').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('[data-live-filter]').forEach(x => x.classList.remove('active')); b.classList.add('active'); S.liveFilter = b.dataset.liveFilter; renderLive(); }));
    document.querySelectorAll('[data-ranking]').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('[data-ranking]').forEach(x => x.classList.remove('active')); b.classList.add('active'); S.rankType = b.dataset.ranking; loadRankings(); }));
    document.getElementById('tournamentsContainer').addEventListener('click', e => {
      const row = e.target.closest('.match-row[data-ek]');
      if (row) openMatch(row.dataset.ek);
    });
    loadMatches(); loadRankings();
  }

  function dateStr(off = 0) { const d = new Date(); d.setDate(d.getDate() + off); return d.toISOString().split('T')[0]; }

  function switchTab(id) {
    S.tab = id;
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === id));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${id}`));
    if (id === 'live') startLive(); else stopLive();
    if (id === 'rankings') loadRankings();
  }

  function goHome() {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'matches'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-matches'));
    window.scrollTo(0, 0);
  }

  // ═══════ API ═══════
  async function api(method, params = {}) {
    try {
      let path = '', qp = new URLSearchParams();
      switch (method) {
        case 'fixtures': path = `fixtures/${params.date || dateStr()}`; if (params.etk) qp.set('event_type_key', params.etk); break;
        case 'livescore': path = 'livescore'; break;
        case 'h2h': path = 'h2h'; qp.set('p1', params.p1); qp.set('p2', params.p2); break;
        case 'standings': path = 'standings'; if (params.etk) qp.set('event_type_key', params.etk); break;
        case 'odds': path = 'odds'; if (params.mk) qp.set('match_key', params.mk); break;
        default: path = 'api'; qp.set('method', method); Object.entries(params).forEach(([k, v]) => qp.set(k, v));
      }
      const qs = qp.toString();
      return await (await fetch(`${CFG.WORKER}/${path}${qs ? '?' + qs : ''}`)).json();
    } catch (e) { return { success: 0, result: [] }; }
  }

  // ═══════ OPEN MATCH — FULL PAGE ═══════
  async function openMatch(ek) {
    const match = S.matches.find(m => String(m.event_key) === String(ek));
    if (!match) return;

    // Switch to analysis tab
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById('tab-analysis').classList.add('active');
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    window.scrollTo(0, 0);

    const page = document.getElementById('analysisPage');
    page.innerHTML = `<div class="loading-state"><div class="loading-spinner"></div><p>🧠 Analisi in corso...</p><p style="font-size:0.78rem;color:var(--text-dim);margin-top:6px">Caricamento H2H · Quote · Modelli predittivi</p></div>`;

    const [h2h, odds] = await Promise.all([
      getH2H(match.first_player_key, match.second_player_key),
      getOdds(match.event_key),
    ]);

    const A = runEngine(match, h2h, odds);
    page.innerHTML = renderFullPage(match, A, h2h);
    window.scrollTo(0, 0);
  }

  async function getH2H(p1, p2) { const k = `${p1}_${p2}`; if (S.h2hCache[k]) return S.h2hCache[k]; const d = await api('h2h', { p1, p2 }); if (d.success === 1 && d.result) { S.h2hCache[k] = d.result; return d.result; } return null; }
  async function getOdds(ek) { if (S.oddsCache[ek]) return S.oddsCache[ek]; const d = await api('odds', { mk: ek }); if (d.success === 1 && d.result) { S.oddsCache[ek] = d.result; return d.result; } return null; }

  // ══════════════════════════════════════════
  //  🧠 ENGINE v4 (same as v3)
  // ══════════════════════════════════════════

  function runEngine(match, h2h, odds) {
    const surf = detectSurf(match.tournament_name || '');
    const bo5 = isSlam(match.tournament_name || '');
    const M = {};
    M.elo = mElo(h2h, match); M.surface = mSurface(h2h, match, surf); M.form = mForm(h2h, match);
    M.h2h = mH2H(h2h, match); M.dominance = mDominance(h2h, match); M.serve = mServe(h2h, match);
    M.fatigue = mFatigue(h2h, match); M.odds = mOdds(odds);
    const consensus = calcConsensus(M);
    const regression = calcRegression(M, consensus);
    const trap = detectTrap(M, consensus);
    const markets = calcMarkets(consensus, match, h2h, surf, bo5, M.odds);
    return { M, consensus, regression, trap, markets, surf, bo5, dq: dataQuality(M) };
  }

  // Models (compact)
  function mElo(h, m) { const r = { name: 'Elo Rating', icon: '📐', p1: 50, conf: 0, det: '' }; if (!h) return r; const a = h.firstPlayerResults || [], b = h.secondPlayerResults || []; if (a.length < 2 && b.length < 2) return r; let e1 = 1500, e2 = 1500; a.slice(0, 12).reverse().forEach(x => { e1 += 32 * ((isWin(x, m.first_player_key) ? 1 : 0) - 1 / (1 + Math.pow(10, (1500 - e1) / 400))); }); b.slice(0, 12).reverse().forEach(x => { e2 += 32 * ((isWin(x, m.second_player_key) ? 1 : 0) - 1 / (1 + Math.pow(10, (1500 - e2) / 400))); }); const d = e1 - e2; r.p1 = clamp(1 / (1 + Math.pow(10, -d / 400)) * 100, 5, 95); r.conf = Math.min(Math.abs(d) / 2.5, 100); r.det = `${e1.toFixed(0)} vs ${e2.toFixed(0)}`; return r; }
  function mSurface(h, m, sf) { const r = { name: `Superficie`, icon: '🏟️', p1: 50, conf: 0, det: '' }; if (!h || sf === 'unknown') return r; const s1 = swins(h.firstPlayerResults || [], m.first_player_key, sf), s2 = swins(h.secondPlayerResults || [], m.second_player_key, sf); const r1 = s1.w / Math.max(s1.t, 1), r2 = s2.w / Math.max(s2.t, 1); r.p1 = clamp(50 + (r1 - r2) * 55, 8, 92); r.conf = Math.min((s1.t + s2.t) * 7, 100); r.det = `${(r1 * 100).toFixed(0)}% vs ${(r2 * 100).toFixed(0)}%`; return r; }
  function swins(res, pk, sf) { let w = 0, t = 0; res.slice(0, 15).forEach(m => { if (detectSurf(m.tournament_name || '') === sf) { t++; if (isWin(m, pk)) w++; } }); return { w, t }; }
  function mForm(h, m) { const r = { name: 'Forma Recente', icon: '🔥', p1: 50, conf: 0, det: '', s1: '', s2: '' }; if (!h) return r; const f1 = wf(h.firstPlayerResults || [], m.first_player_key), f2 = wf(h.secondPlayerResults || [], m.second_player_key); r.p1 = clamp(50 + (f1.sc - f2.sc) * 28, 6, 94); r.conf = Math.min((f1.n + f2.n) * 9, 100); r.det = `${(f1.sc * 100).toFixed(0)}% vs ${(f2.sc * 100).toFixed(0)}%`; r.s1 = f1.str; r.s2 = f2.str; return r; }
  function wf(res, pk) { const l = res.slice(0, 8); if (!l.length) return { sc: 0.5, str: '-', n: 0 }; let ws = 0, wt = 0, sk = 0, st = null; l.forEach((m, i) => { const w = 1 - i * 0.1, won = isWin(m, pk); ws += won ? w : 0; wt += w; if (i === 0) { st = won; sk = 1; } else if (won === st) sk++; }); return { sc: wt > 0 ? ws / wt : 0.5, str: st ? `${sk}W🟢` : `${sk}L🔴`, n: l.length }; }
  function mH2H(h, m) { const r = { name: 'Head-to-Head', icon: '⚔️', p1: 50, conf: 0, det: '', w1: 0, w2: 0 }; if (!h || !h.H2H || !h.H2H.length) return r; let w1 = 0, w2 = 0, rw1 = 0, rw2 = 0; h.H2H.forEach((x, i) => { const p = isWin(x, m.first_player_key); if (p) w1++; else w2++; if (i < 3) { if (p) rw1++; else rw2++; } }); const tot = w1 + w2; r.p1 = clamp((w1 / tot * 100) * 0.55 + ((rw1 + rw2 > 0 ? rw1 / (rw1 + rw2) * 100 : 50)) * 0.45, 8, 92); r.conf = Math.min(tot * 18, 100); r.det = `${w1}-${w2}`; r.w1 = w1; r.w2 = w2; return r; }
  function mDominance(h, m) { const r = { name: 'Dominio', icon: '💪', p1: 50, conf: 0, det: '' }; if (!h) return r; const d1 = cdom(h.firstPlayerResults || [], m.first_player_key), d2 = cdom(h.secondPlayerResults || [], m.second_player_key); if (!d1.n && !d2.n) return r; r.p1 = clamp(50 + (d1.idx - d2.idx) * 20, 10, 90); r.conf = Math.min((d1.n + d2.n) * 8, 100); r.det = `${d1.straight}/${d1.n} vs ${d2.straight}/${d2.n} in 2 set`; return r; }
  function cdom(res, pk) { let tm = 0, str = 0, n = 0; res.slice(0, 8).forEach(m => { if (!m.scores || !m.scores.length || !isWin(m, pk)) return; n++; const isF = String(m.first_player_key) === String(pk); let gw = 0, gl = 0; m.scores.forEach(s => { gw += +(isF ? s.score_first : s.score_second) || 0; gl += +(isF ? s.score_second : s.score_first) || 0; }); tm += gw - gl; const sw = m.scores.filter(s => { const a = +(isF ? s.score_first : s.score_second) || 0, b = +(isF ? s.score_second : s.score_first) || 0; return a > b; }).length; if (sw === m.scores.length) str++; }); return { idx: clamp(n > 0 ? tm / n / 5 : 0, -1, 1), straight: str, n }; }
  function mServe(h, m) { const r = { name: 'Servizio', icon: '🎯', p1: 50, conf: 0, det: '' }; if (!h) return r; const s1 = cse(h.firstPlayerResults || [], m.first_player_key), s2 = cse(h.secondPlayerResults || [], m.second_player_key); if (!s1.n && !s2.n) return r; r.p1 = clamp(50 + (s1.e - s2.e) * 35, 10, 90); r.conf = Math.min((s1.n + s2.n) * 7, 100); r.det = `${(s1.e * 100).toFixed(0)}% vs ${(s2.e * 100).toFixed(0)}%`; return r; }
  function cse(res, pk) { let ts = 0, hr = 0; res.slice(0, 8).forEach(m => { if (!m.scores) return; const isF = String(m.first_player_key) === String(pk); m.scores.forEach(s => { const w = +(isF ? s.score_first : s.score_second) || 0, l = +(isF ? s.score_second : s.score_first) || 0, tg = w + l; if (tg < 6) return; hr += Math.min(w / Math.ceil(tg / 2), 1); ts++; }); }); return { e: ts > 0 ? hr / ts : 0.5, n: ts }; }
  function mFatigue(h, m) { const r = { name: 'Fatica', icon: '🔋', p1: 50, conf: 0, det: '' }; if (!h) return r; const f1 = cfat(h.firstPlayerResults || [], m.event_date), f2 = cfat(h.secondPlayerResults || [], m.event_date); r.p1 = clamp(50 + (f2.sc - f1.sc) * 8, 20, 80); r.conf = Math.min((f1.m + f2.m) * 10, 70); r.det = `${f1.lb} vs ${f2.lb}`; return r; }
  function cfat(res, md) { const t = new Date(md || new Date()); let m7 = 0, m3 = 0, ld = 999; res.slice(0, 10).forEach(m => { if (!m.event_date) return; const da = Math.floor((t - new Date(m.event_date)) / 86400000); if (da >= 0 && da <= 7) m7++; if (da >= 0 && da <= 3) m3++; if (da >= 0 && da < ld) ld = da; }); const sc = m3 * 2 + m7 * 0.5 + (ld <= 1 ? 2 : 0); return { sc, m: m7, lb: sc >= 5 ? '🔴Stanco' : sc >= 3 ? '🟡Norm.' : '🟢Fresco' }; }
  function mOdds(od) { const r = { name: 'Quote', icon: '💰', p1: 50, conf: 0, det: '', p1O: null, p2O: null }; if (!od) return r; const o = pOdds(od); if (!o) return r; r.p1O = o.p1; r.p2O = o.p2; const i1 = 1 / o.p1, i2 = 1 / o.p2; r.p1 = (i1 / (i1 + i2)) * 100; r.conf = clamp((i1 + i2 - 1) * 200 + 40, 20, 92); r.det = `${o.p1.toFixed(2)} / ${o.p2.toFixed(2)}`; return r; }
  function pOdds(d) { try { const a = Array.isArray(d) ? d : [d]; for (const e of a) { if (!e) continue; if (e.odd_1 && e.odd_2) return { p1: +e.odd_1, p2: +e.odd_2 }; for (const b of (e.bookmakers || [])) for (const m of (Array.isArray(b.odds || b.markets) ? (b.odds || b.markets) : [])) if (m.odd_1 && m.odd_2) return { p1: +m.odd_1, p2: +m.odd_2 }; } } catch (e) {} return null; }

  // Consensus
  function calcConsensus(M) { let ws = 0, wt = 0, ac = 0; const bd = []; Object.entries(CFG.WEIGHTS).forEach(([k, w]) => { const m = M[k]; if (!m || m.conf === 0) { bd.push({ k, name: m?.name || k, p1: 50, active: false }); return; } const ew = w * (m.conf / 100); ws += m.p1 * ew; wt += ew; ac++; bd.push({ k, name: m.name, icon: m.icon, p1: m.p1, w: ew, conf: m.conf, active: true }); }); const cp = wt > 0 ? ws / wt : 50; return { p1: clamp(cp, 2, 98), p2: clamp(100 - cp, 2, 98), conf: (Math.abs(cp - 50) * 2).toFixed(0), fav: cp >= 50 ? 'P1' : 'P2', active: ac, total: 8, bd }; }
  function calcRegression(M, C) { const ag = mAgree(M); const ac = C.bd.filter(b => b.active).reduce((s, b) => s + (b.conf || 0), 0) / Math.max(C.active, 1); const sc = +C.conf * 0.35 + ag * 0.35 + ac * 0.30; const tier = sc >= 72 ? 'gold' : sc >= 52 ? 'silver' : sc >= 32 ? 'bronze' : 'skip'; return { sc: sc.toFixed(1), tier, stars: sc >= 82 ? 5 : sc >= 67 ? 4 : sc >= 52 ? 3 : sc >= 37 ? 2 : 1, agree: ag.toFixed(0), avgC: ac.toFixed(0) }; }
  function mAgree(M) { const p = Object.values(M).filter(m => m && m.conf > 0).map(m => m.p1 >= 50 ? 'P1' : 'P2'); if (!p.length) return 0; return (Math.max(p.filter(x => x === 'P1').length, p.filter(x => x === 'P2').length) / p.length) * 100; }
  function detectTrap(M, C) { const f = []; if (M.odds.conf > 0 && Math.abs(M.odds.p1 - C.p1) > 18) f.push('Quote in forte disaccordo con consensus'); if (M.form.conf > 0 && M.h2h.conf > 0 && (M.form.p1 >= 50 ? 'P1' : 'P2') !== (M.h2h.p1 >= 50 ? 'P1' : 'P2') && Math.abs(M.form.p1 - 50) > 12) f.push('Forma e H2H indicano giocatori diversi'); if (M.fatigue.conf > 0 && Math.abs(M.fatigue.p1 - 50) > 15 && (M.fatigue.p1 > 50 ? 'P2' : 'P1') === C.fav) f.push('Il favorito potrebbe essere stanco'); const ag = mAgree(M); if (ag < 65 && +C.conf > 40) f.push('Modelli divisi — alto rischio'); return { isTrap: f.length >= 2, score: Math.min(f.length * 20 + 10, 100), flags: f }; }

  // Markets
  function calcMarkets(C, m, h, sf, b5, oM) {
    const mk = {};
    const fn = C.fav === 'P1' ? m.event_first_player : m.event_second_player;
    const on = C.fav === 'P1' ? m.event_second_player : m.event_first_player;
    const pr = C.fav === 'P1' ? C.p1 : C.p2;
    let kelly = null; const fo = C.fav === 'P1' ? oM.p1O : oM.p2O;
    if (fo && fo > 1) { const p = pr / 100, b = fo - 1, kf = (b * p - (1 - p)) / b; if (kf > 0) kelly = { frac: (kf * 100).toFixed(1), quarter: (kf * 25).toFixed(1), odds: fo.toFixed(2) }; }
    mk.winner = { pick: fn, prob: pr.toFixed(1), vs: on, kelly, tier: C.conf >= 60 ? 'Alta' : C.conf >= 35 ? 'Media' : 'Bassa' };
    // O/U
    const sets = b5 ? 3.2 : 2.3, avg = CFG.GAMES_PER_SET[sf] || 9.9, cl = 1 - Math.abs(C.p1 - 50) / 50;
    let tg = sets * avg + cl * 3.5, ha = null;
    if (h && h.H2H) { const gc = h.H2H.slice(0, 5).map(x => x.scores ? x.scores.reduce((s, sc) => s + (+sc.score_first || 0) + (+sc.score_second || 0), 0) : null).filter(Boolean); if (gc.length) ha = gc.reduce((a, b) => a + b) / gc.length; }
    const adj = ha ? tg * 0.55 + ha * 0.45 : tg; const line = b5 ? 38.5 : Math.round(adj) + 0.5;
    const oP = clamp(50 + (adj - line) * 9, 12, 88);
    mk.ou = { line, pred: adj.toFixed(1), pick: oP >= 53 ? `Over ${line}` : oP <= 47 ? `Under ${line}` : 'Neutro', prob: (oP >= 53 ? oP : 100 - oP).toFixed(0), oP: oP.toFixed(0), uP: (100 - oP).toFixed(0), h2hAvg: ha ? ha.toFixed(1) : null };
    // Sets
    const pw = C.p1 / 100; mk.sets = { bo: b5 ? 5 : 3, preds: b5 ? bo5S(pw) : bo3S(pw) };
    return mk;
  }
  function bo3S(p) { const s = Math.pow(p, 0.82), q = 1 - s; const sc = [{ s: '2-0', p: s * s, f: 'P1' }, { s: '2-1', p: 2 * s * q * s, f: 'P1' }, { s: '0-2', p: q * q, f: 'P2' }, { s: '1-2', p: 2 * s * q * q, f: 'P2' }]; const t = sc.reduce((a, b) => a + b.p, 0); return sc.map(x => ({ ...x, p: ((x.p / t) * 100).toFixed(1) })).sort((a, b) => b.p - a.p); }
  function bo5S(p) { const s = Math.pow(p, 0.82), q = 1 - s; const sc = [{ s: '3-0', p: s ** 3, f: 'P1' }, { s: '3-1', p: 3 * s ** 3 * q, f: 'P1' }, { s: '3-2', p: 6 * s ** 3 * q ** 2, f: 'P1' }, { s: '0-3', p: q ** 3, f: 'P2' }, { s: '1-3', p: 3 * q ** 3 * s, f: 'P2' }, { s: '2-3', p: 6 * q ** 3 * s ** 2, f: 'P2' }]; const t = sc.reduce((a, b) => a + b.p, 0); return sc.map(x => ({ ...x, p: ((x.p / t) * 100).toFixed(1) })).sort((a, b) => b.p - a.p); }
  function dataQuality(M) { const a = Object.values(M).filter(m => m && m.conf > 0).length; return a >= 6 ? { l: 'HD', c: '#34d399' } : a >= 4 ? { l: 'MD', c: '#f59e0b' } : { l: 'LD', c: '#f87171' }; }
  function isWin(m, pk) { const f = String(m.first_player_key) === String(pk); return (f && m.event_winner === 'First Player') || (!f && m.event_winner === 'Second Player'); }
  function detectSurf(n) { n = n.toLowerCase(); if (/roland.garros|french.open|rome|roma|madrid|monte.carlo|barcelona|rio|buenos.aires|lyon|hamburg|kitzbuhel|bastad|gstaad|umag|bucharest|marrakech|cordoba|estoril|geneva|parma|sardegna/i.test(n)) return 'clay'; if (/wimbledon|queen|halle|eastbourne|hertogenbosch|mallorca|stuttgart|nottingham/i.test(n)) return 'grass'; if (/paris.masters|paris.indoor|vienna|basel|stockholm|petersburg|moscow|sofia|metz|astana|marseille|dallas|montpellier/i.test(n)) return 'indoor'; return 'hard'; }
  function isSlam(n) { return /roland.garros|french.open|wimbledon|us.open|australian.open/i.test(n); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // ══════════════════════════════════════════
  //  RENDER: FULL PAGE ANALYSIS (BettingPro style)
  // ══════════════════════════════════════════

  function renderFullPage(match, A, h2h) {
    const { M, consensus: C, regression: R, trap: T, markets: MK, surf, bo5, dq } = A;
    const p1 = match.event_first_player, p2 = match.event_second_player;
    const fav = C.fav === 'P1' ? p1 : p2;
    const unfav = C.fav === 'P1' ? p2 : p1;
    const favProb = C.fav === 'P1' ? C.p1 : C.p2;
    const tierLabel = R.tier === 'gold' ? 'A+ — GIOCABILE' : R.tier === 'silver' ? 'B+ — GIOCABILE' : R.tier === 'bronze' ? 'C — CON CAUTELA' : 'D — SKIP';
    const confLabel = MK.winner.tier;

    // Score color for gauge
    const gaugeColor = +R.sc >= 70 ? 'var(--accent)' : +R.sc >= 50 ? 'var(--gold)' : +R.sc >= 30 ? '#f97316' : 'var(--lose)';

    return `
      <!-- BACK BUTTON -->
      <button class="back-btn" onclick="TP.goHome()">← Partite</button>

      <!-- MATCH HEADER -->
      <div class="ap-header">
        <div class="ap-header-info">
          <span class="surface-badge ${surf}">${surf.toUpperCase()}</span>
          ${match.tournament_name || ''} • ${match.event_type_type || ''} • ${match.event_time || 'TBD'}
          ${bo5 ? ' • <span style="color:var(--gold);font-weight:600">Grand Slam</span>' : ''}
        </div>
        <div class="ap-header-badges">
          <span class="data-quality-badge" style="color:${dq.c};border-color:${dq.c}">📡 Dati ${dq.l}</span>
          ${M.form.s1 ? `<span style="font-size:0.78rem">${p1.split(' ').pop()}: ${M.form.s1}</span>` : ''}
          ${M.form.s2 ? `<span style="font-size:0.78rem">${p2.split(' ').pop()}: ${M.form.s2}</span>` : ''}
        </div>
      </div>

      <!-- PLAYER MATCHUP -->
      <div class="ap-matchup">
        <div class="ap-player ${C.fav === 'P1' ? 'fav' : ''}">
          <div class="ap-player-name">${p1}</div>
        </div>
        <div class="ap-center">
          <div class="ap-vs">VS</div>
          <div class="ap-time">${match.event_time || 'TBD'}</div>
        </div>
        <div class="ap-player right ${C.fav === 'P2' ? 'fav' : ''}">
          <div class="ap-player-name">${p2}</div>
        </div>
      </div>

      <!-- PROBABILITY BAR -->
      <div class="ap-prob-bar">
        <div class="ap-prob-fill p1" style="width:${C.p1}%"><span>${C.p1.toFixed(0)}%</span></div>
        <div class="ap-prob-fill p2" style="width:${C.p2}%"><span>${C.p2.toFixed(0)}%</span></div>
      </div>

      <!-- ══════ SCORE & MAIN PREDICTION ══════ -->
      <div class="ap-section">
        <div class="ap-gauge-row">
          <div class="ap-gauge">
            <div class="ap-gauge-value" style="color:${gaugeColor}">${R.sc}</div>
            <div class="ap-gauge-label">/100</div>
            <div class="ap-gauge-tier" style="border-color:${gaugeColor};color:${gaugeColor}">${tierLabel}</div>
          </div>
          <div class="ap-scores-list">
            ${C.bd.filter(b => b.active).map(b => `
              <div class="ap-score-row">
                <span class="ap-score-icon">${M[b.k]?.icon || '📊'}</span>
                <span class="ap-score-name">${b.name}</span>
                <div class="ap-score-bar"><div class="ap-score-bar-fill" style="width:${b.p1}%;background:${b.p1 >= 55 ? 'var(--accent)' : b.p1 >= 45 ? 'var(--gold)' : 'var(--lose)'}"></div></div>
                <span class="ap-score-val" style="color:${b.p1 >= 55 ? 'var(--accent)' : b.p1 >= 45 ? 'var(--gold)' : 'var(--lose)'}">${Math.round(b.p1)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      ${MK.winner.kelly ? `
      <!-- STAKE ADVISOR -->
      <div class="ap-section ap-stake">
        <div class="ap-section-header"><span>💰 Stake Advisor</span><span class="ap-badge-green">Fractional Kelly</span></div>
        <div class="ap-stake-grid">
          <div class="ap-stake-item main"><div class="ap-stake-label">STAKE CONSIGLIATO</div><div class="ap-stake-value">${MK.winner.kelly.quarter}%</div><div class="ap-stake-sub">del bankroll (¼ Kelly)</div></div>
          <div class="ap-stake-item"><div class="ap-stake-label">QUOTA</div><div class="ap-stake-value">@${MK.winner.kelly.odds}</div></div>
          <div class="ap-stake-item"><div class="ap-stake-label">FULL KELLY</div><div class="ap-stake-value">${MK.winner.kelly.frac}%</div></div>
        </div>
      </div>` : ''}

      ${T.isTrap ? `
      <!-- TRAP DETECTOR -->
      <div class="ap-section ap-trap">
        <div class="ap-section-header"><span>🕵️ Trap Detector</span><span class="ap-badge-orange">${T.score}/100 ATTENZIONE</span></div>
        <div class="ap-trap-body">
          ${T.flags.map(f => `<div class="ap-trap-flag">⚠️ ${f}</div>`).join('')}
        </div>
      </div>` : ''}

      <!-- ══════ PRONOSTICI ESPLICITI ══════ -->
      <div class="ap-section">
        <div class="ap-section-header"><span>🎾 Pronostici</span></div>

        <!-- VINCENTE -->
        <div class="ap-prono-card main">
          <div class="ap-prono-label">PRONOSTICO VINCENTE</div>
          <div class="ap-prono-pick">${fav}</div>
          <div class="ap-prono-prob">${favProb.toFixed(0)}% <span class="ap-prono-conf">probabilità</span></div>
          <div class="ap-prono-conf-badge ${confLabel === 'Alta' ? 'green' : confLabel === 'Media' ? 'yellow' : 'red'}">✓ ${confLabel}</div>
          ${MK.winner.kelly ? `<div class="ap-prono-odds">@ ${MK.winner.kelly.odds}</div>` : ''}
        </div>

        <!-- OVER/UNDER -->
        <div class="ap-prono-card">
          <div class="ap-prono-label">OVER / UNDER GAME</div>
          <div class="ap-prono-pick">${MK.ou.pick}</div>
          <div class="ap-prono-prob">${MK.ou.prob}% <span class="ap-prono-conf">probabilità</span></div>
          <div class="ap-prono-detail">Game previsti: ${MK.ou.pred}${MK.ou.h2hAvg ? ` • Media H2H: ${MK.ou.h2hAvg}` : ''}</div>
          <div class="ap-ou-bars">
            <div class="ap-ou-item ${+MK.ou.oP > 50 ? 'active' : ''}"><span>Over ${MK.ou.line}</span><strong>${MK.ou.oP}%</strong></div>
            <div class="ap-ou-item ${+MK.ou.uP > 50 ? 'active' : ''}"><span>Under ${MK.ou.line}</span><strong>${MK.ou.uP}%</strong></div>
          </div>
        </div>

        <!-- SET SCORE -->
        <div class="ap-prono-card">
          <div class="ap-prono-label">RISULTATO SET (Bo${MK.sets.bo})</div>
          <div class="ap-sets-grid">
            ${MK.sets.preds.map((x, i) => `
              <div class="ap-set-chip ${i === 0 ? 'top' : ''}">
                <div class="ap-set-score">${x.s}</div>
                <div class="ap-set-prob">${x.p}%</div>
                <div class="ap-set-who">${x.f === 'P1' ? p1.split(' ').pop() : p2.split(' ').pop()}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- ══════ CONSENSUS ENGINE ══════ -->
      <div class="ap-section ap-consensus">
        <div class="ap-section-header"><span>🏆 Consensus Engine</span><span class="ap-badge-green">${C.active} modelli • Accordo: ${R.agree}%</span></div>
        <div class="ap-consensus-pick">
          <div class="ap-consensus-label">MASSIMA CONVERGENZA</div>
          <div class="ap-consensus-name">${fav}</div>
          <div class="ap-consensus-prob">${favProb.toFixed(1)}% • Accordo: ${R.agree}% (${C.active}/${C.total})</div>
        </div>
        <div class="ap-consensus-models">
          ${C.bd.filter(b => b.active).map(b => `
            <div class="ap-cm-chip"><span>${M[b.k]?.icon}</span> <span>${b.name}</span><strong style="color:${b.p1 >= 50 ? 'var(--accent)' : 'var(--lose)'}">${b.p1 >= 50 ? p1.split(' ').pop() : p2.split(' ').pop()}</strong><span class="ap-cm-pct">${Math.max(b.p1, 100 - b.p1).toFixed(0)}%</span></div>
          `).join('')}
        </div>
      </div>

      <!-- ══════ H2H ══════ -->
      ${h2h && h2h.H2H && h2h.H2H.length ? `
      <div class="ap-section">
        <div class="ap-section-header"><span>⚔️ Precedenti Diretti</span><span style="font-size:0.78rem;color:var(--text-muted)">${M.h2h.w1}-${M.h2h.w2} in ${h2h.H2H.length} match</span></div>
        <div class="h2h-mini-list">${h2h.H2H.slice(0, 6).map(m => { const sc = m.scores ? m.scores.map(s => `${s.score_first}-${s.score_second}`).join(' ') : m.event_final_result || ''; return `<div class="h2h-mini-row"><span class="h2h-mini-date">${m.event_date || ''}</span><span class="h2h-mini-player ${m.event_winner === 'First Player' ? 'winner' : ''}">${m.event_first_player}</span><span class="h2h-mini-score">${sc}</span><span class="h2h-mini-player right ${m.event_winner === 'Second Player' ? 'winner' : ''}">${m.event_second_player}</span></div>`; }).join('')}</div>
      </div>` : ''}

      <div style="text-align:center;padding:2rem 0;color:var(--text-dim);font-size:0.75rem">
        ⚠️ Analisi statistica a scopo informativo. Non costituisce consulenza finanziaria.
      </div>
    `;
  }

  // ══════ TOURNAMENT HOME ══════
  async function loadMatches() {
    const c = document.getElementById('tournamentsContainer');
    c.innerHTML = `<div class="loading-state"><div class="loading-spinner"></div><p>Caricamento tornei...</p></div>`;
    const d = await api('fixtures', { date: dateStr(S.dateOff) });
    if (d.success === 1 && d.result && d.result.length) { S.matches = d.result; renderTournaments(); }
    else c.innerHTML = `<div class="empty-state"><div class="empty-icon">🎾</div><div class="empty-title">Nessuna partita per ${dateStr(S.dateOff)}</div></div>`;
  }

  function renderTournaments() {
    const c = document.getElementById('tournamentsContainer');
    let m = [...S.matches];
    if (S.filter !== 'all') m = m.filter(x => (x.event_type_type || '').toLowerCase().includes(S.filter));
    const g = {}; m.forEach(x => { const k = x.tournament_key || x.tournament_name || '?'; if (!g[k]) g[k] = { name: x.tournament_name || '?', type: x.event_type_type || '', key: k, m: [] }; g[k].m.push(x); });
    const ts = Object.values(g).sort((a, b) => a.name.localeCompare(b.name));
    if (!ts.length) { c.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-title">Nessun torneo</div></div>`; return; }
    c.innerHTML = ts.map(t => {
      const sf = detectSurf(t.name); const up = t.m.filter(x => x.event_status !== 'Finished').length;
      return `<div class="tournament-card open"><div class="tournament-header" onclick="this.parentElement.classList.toggle('open')"><div class="tournament-info"><span class="surface-badge ${sf}">${sf.toUpperCase()}</span><span class="tournament-name">${t.name}</span><span class="tournament-type">${t.type.replace(/Singles|Doubles/gi, '').trim()}</span></div><div class="tournament-meta"><span class="tournament-count">${t.m.length}</span>${up ? `<span class="tournament-upcoming">${up} da giocare</span>` : ''}<span class="tournament-arrow">▾</span></div></div><div class="tournament-matches">${t.m.sort((a, b) => { const af = a.event_status === 'Finished' ? 1 : 0; return af !== (b.event_status === 'Finished' ? 1 : 0) ? af - (b.event_status === 'Finished' ? 1 : 0) : (a.event_time || '').localeCompare(b.event_time || ''); }).map(x => rmr(x)).join('')}</div></div>`;
    }).join('');
    // Load predictions in background
    loadQuickPredictions();
  }

  async function loadQuickPredictions() {
    const upcoming = S.matches.filter(m => m.event_status !== 'Finished');
    for (const match of upcoming) {
      if (S.tab !== 'matches') break; // stop if user switched tab
      try {
        const h2h = await getH2H(match.first_player_key, match.second_player_key);
        const A = runEngine(match, h2h, null);
        const el = document.getElementById(`pred-${match.event_key}`);
        if (!el) continue;
        const C = A.consensus;
        const R = A.regression;
        const fav = C.fav === 'P1' ? match.event_first_player.split(' ').pop() : match.event_second_player.split(' ').pop();
        const prob = Math.round(C.fav === 'P1' ? C.p1 : C.p2);
        const tier = R.tier;
        const tierColor = tier === 'gold' ? 'var(--gold)' : tier === 'silver' ? 'var(--silver)' : tier === 'bronze' ? '#d97706' : 'var(--text-dim)';
        const confLabel = prob >= 65 ? 'Alta' : prob >= 52 ? 'Media' : 'Bassa';
        const confClass = prob >= 65 ? 'green' : prob >= 52 ? 'yellow' : 'red';
        el.innerHTML = `<span class="pred-badge ${confClass}" title="${fav} ${prob}% - ${confLabel}"><span class="pred-name">${fav}</span><span class="pred-pct">${prob}%</span></span>`;
      } catch (e) {
        const el = document.getElementById(`pred-${match.event_key}`);
        if (el) el.innerHTML = '';
      }
    }
  }

  function rmr(m) {
    const isF = m.event_status === 'Finished', isL = m.event_live === '1';
    let sc = ''; if (m.scores && m.scores.length) sc = m.scores.map(s => `<span class="set-score-mini ${+s.score_first > +s.score_second ? 'won' : ''}">${s.score_first}-${s.score_second}</span>`).join(' ');
    let st = isF ? `<span class="status-badge finished">✓</span>` : isL ? `<span class="status-badge live">LIVE</span>` : `<span class="status-badge upcoming">${m.event_time || 'TBD'}</span>`;
    const ek = !isF ? `data-ek="${m.event_key}"` : '';
    const rd = m.tournament_round ? m.tournament_round.replace(m.tournament_name || '', '').replace(/^\s*-\s*/, '').trim() : '';
    // Prediction badge placeholder for upcoming matches
    const predBadge = !isF ? `<div class="match-row-pred" id="pred-${m.event_key}"><span class="pred-loading">⏳</span></div>` : '';
    return `<div class="match-row ${!isF ? 'clickable' : ''} ${isL ? 'live' : ''}" ${ek}><div class="match-row-status">${st}</div><div class="match-row-players"><span class="match-row-p ${m.event_winner === 'First Player' ? 'winner' : ''}">${m.event_first_player}</span><span class="match-row-vs">vs</span><span class="match-row-p ${m.event_winner === 'Second Player' ? 'winner' : ''}">${m.event_second_player}</span></div>${predBadge}<div class="match-row-score">${sc}</div><div class="match-row-round">${rd}</div>${!isF ? '<div class="match-row-cta">📊</div>' : ''}</div>`;
  }

  // ═══════ LIVE / H2H / RANKINGS (unchanged) ═══════
  async function loadLive() { const c = document.getElementById('liveContainer'); const d = await api('livescore'); if (d.success === 1 && d.result && d.result.length) { S.live = d.result; document.getElementById('liveCount').textContent = d.result.length; document.getElementById('liveCount').style.display = 'inline'; renderLive(); } else { S.live = []; document.getElementById('liveCount').style.display = 'none'; c.innerHTML = `<div class="empty-state"><div class="empty-icon">😴</div><div class="empty-title">Nessun match live</div></div>`; } }
  function renderLive() { const c = document.getElementById('liveContainer'); let m = [...S.live]; if (S.liveFilter !== 'all') m = m.filter(x => (x.event_type_type || '').toLowerCase().includes(S.liveFilter)); if (!m.length) { c.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-title">Nessun match live</div></div>`; return; } c.innerHTML = m.map(x => { const sv = x.event_serve; let sH = ''; if (x.scores && x.scores.length) sH = `<div class="match-score">${x.scores.map(s => `<div class="set-score ${+s.score_first > +s.score_second ? 'won' : ''}">${s.score_first}-${s.score_second}</div>`).join('')}</div>`; const gs = x.event_game_result || ''; return `<div class="match-card live"><div class="match-card-header"><span class="match-tournament"><span class="surface-badge ${detectSurf(x.tournament_name || '')}">${detectSurf(x.tournament_name || '').toUpperCase()}</span> ${x.tournament_name || ''}</span><span class="match-time live">● ${x.event_status || 'LIVE'}</span></div><div class="match-players"><div class="player"><span class="player-name">${sv === 'First Player' ? '🎾 ' : ''}${x.event_first_player}</span></div><div style="text-align:center">${sH}${gs && gs !== '-' ? `<div style="font-family:var(--font-mono);font-size:1rem;color:var(--gold);margin-top:6px;font-weight:700">${gs}</div>` : ''}</div><div class="player right"><span class="player-name">${sv === 'Second Player' ? '🎾 ' : ''}${x.event_second_player}</span></div></div></div>`; }).join(''); }
  function startLive() { loadLive(); S.liveInt = setInterval(loadLive, CFG.LIVE_MS); } function stopLive() { if (S.liveInt) { clearInterval(S.liveInt); S.liveInt = null; } }
  async function loadH2H() { /* same as before */ }
  async function loadRankings() { const c = document.getElementById('rankingsContainer'); c.innerHTML = `<div class="loading-state"><div class="loading-spinner"></div></div>`; const d = await api('standings', { etk: S.rankType === 'atp' ? CFG.EVENT.ATP : CFG.EVENT.WTA }); if (d.success === 1 && d.result && d.result.length) { c.innerHTML = `<table class="rankings-table"><thead><tr><th>#</th><th>Giocatore</th><th>Punti</th></tr></thead><tbody>${d.result.slice(0, 100).map((p, i) => `<tr><td><span class="rank-number ${(p.place || i + 1) <= 3 ? 'top-3' : ''}">${p.place || i + 1}</span></td><td>${p.player_name || p.team_name || '-'}</td><td class="stat-mono">${p.points || p.team_points || '-'}</td></tr>`).join('')}</tbody></table>`; } else c.innerHTML = `<div class="empty-state"><div class="empty-icon">🏆</div><div class="empty-title">Non disponibile</div></div>`; }

  return { init, openMatch, goHome, loadH2H, switchTab };
})();

document.addEventListener('DOMContentLoaded', TP.init);
