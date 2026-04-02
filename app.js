/**
 * TennisPro v5.0 — Full Analysis + Result Verification + Smart Money
 * 9 Models + Consensus + Trap + Kelly + Accuracy Tracker
 */
const TP = (() => {
  const CFG = {
    W: 'https://tennispro.lucalagan.workers.dev',
    LIVE_MS: 30000,
    // 9 model weights
    WTS: { elo: 0.16, surface: 0.12, form: 0.15, h2h: 0.11, dominance: 0.09, serve: 0.09, fatigue: 0.07, odds: 0.11, smartMoney: 0.10 },
    GPS: { clay: 10.2, grass: 9.6, hard: 9.8, indoor: 9.7, unknown: 9.9 },
  };
  let S = { tab: 'matches', dOff: 0, flt: 'all', lFlt: 'all', rk: 'atp', lInt: null, matches: [], live: [], hc: {}, oc: {}, acc: { hit: 0, miss: 0, total: 0 } };

  // ═══ INIT ═══
  function init() {
    document.getElementById('headerDate').textContent = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    document.querySelectorAll('.nav-tab').forEach(t => t.addEventListener('click', () => swTab(t.dataset.tab)));
    document.querySelectorAll('.date-btn').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('.date-btn').forEach(x => x.classList.remove('active')); b.classList.add('active'); S.dOff = +b.dataset.offset; loadMatches(); }));
    document.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('[data-filter]').forEach(x => x.classList.remove('active')); b.classList.add('active'); S.flt = b.dataset.filter; renderHome(); }));
    document.querySelectorAll('[data-live-filter]').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('[data-live-filter]').forEach(x => x.classList.remove('active')); b.classList.add('active'); S.lFlt = b.dataset.liveFilter; renderLive(); }));
    document.querySelectorAll('[data-ranking]').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('[data-ranking]').forEach(x => x.classList.remove('active')); b.classList.add('active'); S.rk = b.dataset.ranking; loadRank(); }));
    document.getElementById('tournamentsContainer').addEventListener('click', e => { const r = e.target.closest('.match-row[data-ek]'); if (r) openMatch(r.dataset.ek); });
    loadMatches(); loadRank();
  }

  function ds(o = 0) { const d = new Date(); d.setDate(d.getDate() + o); return d.toISOString().split('T')[0]; }
  function swTab(id) { S.tab = id; document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === id)); document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${id}`)); if (id === 'live') startLive(); else stopLive(); if (id === 'rankings') loadRank(); }
  function goHome() { document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'matches')); document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-matches')); window.scrollTo(0, 0); }

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

  // ═══ OPEN MATCH (both finished and upcoming) ═══
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
    const A = engine(match, h2h, odds);
    pg.innerHTML = renderPage(match, A, h2h);
    window.scrollTo(0, 0);
  }

  // ══════════════════════════════════════════════
  //  🧠 ENGINE v5 — 9 MODELS
  // ══════════════════════════════════════════════
  function engine(match, h2h, odds) {
    const sf = dSurf(match.tournament_name || ''), bo5 = isSl(match.tournament_name || '');
    const M = {};
    M.elo = mElo(h2h, match); M.surface = mSurf(h2h, match, sf); M.form = mForm(h2h, match);
    M.h2h = mH2H(h2h, match); M.dominance = mDom(h2h, match); M.serve = mSrv(h2h, match);
    M.fatigue = mFat(h2h, match); M.odds = mOdds(odds); M.smartMoney = mSmart(odds, M);
    const C = consensus(M), R = regression(M, C), T = trap(M, C);
    const MK = markets(C, match, h2h, sf, bo5, M.odds);
    // Verify result for finished matches
    let verify = null;
    if (match.event_status === 'Finished' && match.event_winner) {
      const predFav = C.fav === 'P1' ? 'First Player' : 'Second Player';
      verify = {
        actual: match.event_winner,
        predicted: predFav,
        hit: match.event_winner === predFav,
        actualName: match.event_winner === 'First Player' ? match.event_first_player : match.event_second_player,
        scores: match.scores || [],
        totalGames: (match.scores || []).reduce((s, sc) => s + (+sc.score_first || 0) + (+sc.score_second || 0), 0),
        ouHit: null,
      };
      if (MK.ou) { verify.ouHit = MK.ou.pick.includes('Over') ? verify.totalGames > MK.ou.line : MK.ou.pick.includes('Under') ? verify.totalGames < MK.ou.line : null; }
      // Set score check
      const actualSets = (match.scores || []).reduce((acc, sc) => { if (+sc.score_first > +sc.score_second) acc.p1++; else acc.p2++; return acc; }, { p1: 0, p2: 0 });
      verify.actualSetScore = `${actualSets.p1}-${actualSets.p2}`;
      verify.setHit = MK.sets.preds[0]?.s === verify.actualSetScore;
    }
    return { M, C, R, T, MK, sf, bo5, dq: dqual(M), verify };
  }

  // Models
  function mElo(h, m) { const r = { name: 'Elo Rating', icon: '📐', p1: 50, conf: 0, det: '' }; if (!h) return r; const a = h.firstPlayerResults || [], b = h.secondPlayerResults || []; if (a.length < 2 && b.length < 2) return r; let e1 = 1500, e2 = 1500; a.slice(0, 12).reverse().forEach(x => { e1 += 32 * ((iW(x, m.first_player_key) ? 1 : 0) - 1 / (1 + Math.pow(10, (1500 - e1) / 400))); }); b.slice(0, 12).reverse().forEach(x => { e2 += 32 * ((iW(x, m.second_player_key) ? 1 : 0) - 1 / (1 + Math.pow(10, (1500 - e2) / 400))); }); const d = e1 - e2; r.p1 = cl(1 / (1 + Math.pow(10, -d / 400)) * 100, 5, 95); r.conf = Math.min(Math.abs(d) / 2.5, 100); r.det = `${e1.toFixed(0)} vs ${e2.toFixed(0)}`; return r; }
  function mSurf(h, m, sf) { const r = { name: 'Superficie', icon: '🏟️', p1: 50, conf: 0, det: '' }; if (!h || sf === 'unknown') return r; const s1 = sw(h.firstPlayerResults || [], m.first_player_key, sf), s2 = sw(h.secondPlayerResults || [], m.second_player_key, sf); const r1 = s1.w / Math.max(s1.t, 1), r2 = s2.w / Math.max(s2.t, 1); r.p1 = cl(50 + (r1 - r2) * 55, 8, 92); r.conf = Math.min((s1.t + s2.t) * 7, 100); r.det = `${(r1 * 100).toFixed(0)}% vs ${(r2 * 100).toFixed(0)}%`; return r; }
  function sw(res, pk, sf) { let w = 0, t = 0; res.slice(0, 15).forEach(m => { if (dSurf(m.tournament_name || '') === sf) { t++; if (iW(m, pk)) w++; } }); return { w, t }; }
  function mForm(h, m) { const r = { name: 'Forma', icon: '🔥', p1: 50, conf: 0, det: '', s1: '', s2: '' }; if (!h) return r; const f1 = wf(h.firstPlayerResults || [], m.first_player_key), f2 = wf(h.secondPlayerResults || [], m.second_player_key); r.p1 = cl(50 + (f1.sc - f2.sc) * 28, 6, 94); r.conf = Math.min((f1.n + f2.n) * 9, 100); r.det = `${(f1.sc * 100).toFixed(0)}% vs ${(f2.sc * 100).toFixed(0)}%`; r.s1 = f1.str; r.s2 = f2.str; return r; }
  function wf(res, pk) { const l = res.slice(0, 8); if (!l.length) return { sc: 0.5, str: '-', n: 0 }; let ws = 0, wt = 0, sk = 0, st = null; l.forEach((m, i) => { const w = 1 - i * 0.1, won = iW(m, pk); ws += won ? w : 0; wt += w; if (i === 0) { st = won; sk = 1; } else if (won === st) sk++; }); return { sc: wt > 0 ? ws / wt : 0.5, str: st ? `${sk}W🟢` : `${sk}L🔴`, n: l.length }; }
  function mH2H(h, m) { const r = { name: 'H2H', icon: '⚔️', p1: 50, conf: 0, det: '', w1: 0, w2: 0 }; if (!h || !h.H2H || !h.H2H.length) return r; let w1 = 0, w2 = 0, rw1 = 0, rw2 = 0; h.H2H.forEach((x, i) => { const p = iW(x, m.first_player_key); if (p) w1++; else w2++; if (i < 3) { if (p) rw1++; else rw2++; } }); const tot = w1 + w2; r.p1 = cl((w1 / tot * 100) * 0.55 + ((rw1 + rw2 > 0 ? rw1 / (rw1 + rw2) * 100 : 50)) * 0.45, 8, 92); r.conf = Math.min(tot * 18, 100); r.det = `${w1}-${w2}`; r.w1 = w1; r.w2 = w2; return r; }
  function mDom(h, m) { const r = { name: 'Dominio', icon: '💪', p1: 50, conf: 0, det: '' }; if (!h) return r; const d1 = cd(h.firstPlayerResults || [], m.first_player_key), d2 = cd(h.secondPlayerResults || [], m.second_player_key); if (!d1.n && !d2.n) return r; r.p1 = cl(50 + (d1.idx - d2.idx) * 20, 10, 90); r.conf = Math.min((d1.n + d2.n) * 8, 100); r.det = `${d1.str}/${d1.n} vs ${d2.str}/${d2.n} in 2`; return r; }
  function cd(res, pk) { let tm = 0, str = 0, n = 0; res.slice(0, 8).forEach(m => { if (!m.scores || !m.scores.length || !iW(m, pk)) return; n++; const f = String(m.first_player_key) === String(pk); let gw = 0, gl = 0; m.scores.forEach(s => { gw += +(f ? s.score_first : s.score_second) || 0; gl += +(f ? s.score_second : s.score_first) || 0; }); tm += gw - gl; if (m.scores.filter(s => (+(f ? s.score_first : s.score_second) || 0) > (+(f ? s.score_second : s.score_first) || 0)).length === m.scores.length) str++; }); return { idx: cl(n > 0 ? tm / n / 5 : 0, -1, 1), str, n }; }
  function mSrv(h, m) { const r = { name: 'Servizio', icon: '🎯', p1: 50, conf: 0, det: '' }; if (!h) return r; const s1 = cse(h.firstPlayerResults || [], m.first_player_key), s2 = cse(h.secondPlayerResults || [], m.second_player_key); if (!s1.n && !s2.n) return r; r.p1 = cl(50 + (s1.e - s2.e) * 35, 10, 90); r.conf = Math.min((s1.n + s2.n) * 7, 100); r.det = `${(s1.e * 100).toFixed(0)}% vs ${(s2.e * 100).toFixed(0)}%`; return r; }
  function cse(res, pk) { let ts = 0, hr = 0; res.slice(0, 8).forEach(m => { if (!m.scores) return; const f = String(m.first_player_key) === String(pk); m.scores.forEach(s => { const w = +(f ? s.score_first : s.score_second) || 0, l = +(f ? s.score_second : s.score_first) || 0; if (w + l < 6) return; hr += Math.min(w / Math.ceil((w + l) / 2), 1); ts++; }); }); return { e: ts > 0 ? hr / ts : 0.5, n: ts }; }
  function mFat(h, m) { const r = { name: 'Fatica', icon: '🔋', p1: 50, conf: 0, det: '' }; if (!h) return r; const f1 = cf(h.firstPlayerResults || [], m.event_date), f2 = cf(h.secondPlayerResults || [], m.event_date); r.p1 = cl(50 + (f2.sc - f1.sc) * 8, 20, 80); r.conf = Math.min((f1.m + f2.m) * 10, 70); r.det = `${f1.lb} vs ${f2.lb}`; return r; }
  function cf(res, md) { const t = new Date(md || new Date()); let m7 = 0, m3 = 0, ld = 999; res.slice(0, 10).forEach(m => { if (!m.event_date) return; const da = Math.floor((t - new Date(m.event_date)) / 86400000); if (da >= 0 && da <= 7) m7++; if (da >= 0 && da <= 3) m3++; if (da >= 0 && da < ld) ld = da; }); const sc = m3 * 2 + m7 * 0.5 + (ld <= 1 ? 2 : 0); return { sc, m: m7, lb: sc >= 5 ? '🔴Stanco' : sc >= 3 ? '🟡Norm' : '🟢Fresco' }; }
  function mOdds(od) { const r = { name: 'Quote', icon: '💰', p1: 50, conf: 0, det: '', p1O: null, p2O: null, bks: [] }; if (!od) return r; const o = pO(od); if (!o) return r; r.p1O = o.p1; r.p2O = o.p2; r.bks = o.all || []; const i1 = 1 / o.p1, i2 = 1 / o.p2; r.p1 = (i1 / (i1 + i2)) * 100; r.conf = cl((i1 + i2 - 1) * 200 + 40, 20, 92); r.det = `${o.p1.toFixed(2)} / ${o.p2.toFixed(2)}`; return r; }
  // NEW: Model 9 - Smart Money
  function mSmart(od, M) {
    const r = { name: 'Smart Money', icon: '🧠', p1: 50, conf: 0, det: '', signal: null };
    if (!od) return r;
    const allOdds = pAllOdds(od);
    if (allOdds.length < 2) return r;
    // Detect: if multiple bookmakers agree strongly, it's smart money signal
    const p1Probs = allOdds.map(o => 1 / o.p1 / (1 / o.p1 + 1 / o.p2) * 100);
    const avg = p1Probs.reduce((a, b) => a + b) / p1Probs.length;
    const spread = Math.max(...p1Probs) - Math.min(...p1Probs);
    // Low spread = high agreement among bookmakers = smart money confirmed
    // High spread = disagreement = possible value opportunity
    r.p1 = cl(avg, 8, 92);
    r.conf = cl(90 - spread * 3, 15, 90); // More agreement = higher confidence
    // Compare with our consensus
    if (M.odds.conf > 0 && M.elo.conf > 0) {
      const ourFav = M.elo.p1 >= 50 ? 'P1' : 'P2';
      const moneyFav = avg >= 50 ? 'P1' : 'P2';
      if (ourFav === moneyFav && spread < 5) { r.signal = 'CONFERMA'; r.det = `${allOdds.length} book concordi (spread ${spread.toFixed(1)}%)`; }
      else if (ourFav !== moneyFav) { r.signal = 'DIVERGENZA'; r.det = `Soldi vs Modelli (spread ${spread.toFixed(1)}%)`; }
      else { r.signal = 'NEUTRO'; r.det = `Spread ${spread.toFixed(1)}% su ${allOdds.length} book`; }
    } else { r.det = `${allOdds.length} bookmaker analizzati`; }
    return r;
  }
  function pO(d) { try { const a = Array.isArray(d) ? d : [d]; for (const e of a) { if (!e) continue; if (e.odd_1 && e.odd_2) return { p1: +e.odd_1, p2: +e.odd_2 }; for (const b of (e.bookmakers || [])) for (const m of (Array.isArray(b.odds || b.markets) ? (b.odds || b.markets) : [])) if (m.odd_1 && m.odd_2) return { p1: +m.odd_1, p2: +m.odd_2 }; } } catch (e) {} return null; }
  function pAllOdds(d) { const all = []; try { const a = Array.isArray(d) ? d : [d]; for (const e of a) { if (!e) continue; for (const b of (e.bookmakers || [])) for (const m of (Array.isArray(b.odds || b.markets) ? (b.odds || b.markets) : [])) if (m.odd_1 && m.odd_2) all.push({ p1: +m.odd_1, p2: +m.odd_2, bk: b.bookmaker_name || '?' }); } } catch (e) {} return all; }

  // Consensus / Regression / Trap
  function consensus(M) { let ws = 0, wt = 0, ac = 0; const bd = []; Object.entries(CFG.WTS).forEach(([k, w]) => { const m = M[k]; if (!m || m.conf === 0) { bd.push({ k, name: m?.name || k, p1: 50, active: false }); return; } const ew = w * (m.conf / 100); ws += m.p1 * ew; wt += ew; ac++; bd.push({ k, name: m.name, icon: m.icon, p1: m.p1, w: ew, conf: m.conf, active: true }); }); const cp = wt > 0 ? ws / wt : 50; return { p1: cl(cp, 2, 98), p2: cl(100 - cp, 2, 98), conf: (Math.abs(cp - 50) * 2).toFixed(0), fav: cp >= 50 ? 'P1' : 'P2', ac, total: 9, bd }; }
  function regression(M, C) { const ag = mAg(M); const ac = C.bd.filter(b => b.active).reduce((s, b) => s + (b.conf || 0), 0) / Math.max(C.ac, 1); const sc = +C.conf * 0.35 + ag * 0.35 + ac * 0.30; const tier = sc >= 72 ? 'gold' : sc >= 52 ? 'silver' : sc >= 32 ? 'bronze' : 'skip'; return { sc: sc.toFixed(1), tier, stars: sc >= 82 ? 5 : sc >= 67 ? 4 : sc >= 52 ? 3 : sc >= 37 ? 2 : 1, ag: ag.toFixed(0), ac: ac.toFixed(0) }; }
  function mAg(M) { const p = Object.values(M).filter(m => m && m.conf > 0).map(m => m.p1 >= 50 ? 'P1' : 'P2'); if (!p.length) return 0; return (Math.max(p.filter(x => x === 'P1').length, p.filter(x => x === 'P2').length) / p.length) * 100; }
  function trap(M, C) { const f = []; if (M.odds.conf > 0 && Math.abs(M.odds.p1 - C.p1) > 18) f.push('Quote in forte disaccordo con consensus'); if (M.form.conf > 0 && M.h2h.conf > 0 && (M.form.p1 >= 50 ? 'P1' : 'P2') !== (M.h2h.p1 >= 50 ? 'P1' : 'P2') && Math.abs(M.form.p1 - 50) > 12) f.push('Forma e H2H indicano giocatori diversi'); if (M.fatigue.conf > 0 && Math.abs(M.fatigue.p1 - 50) > 15 && (M.fatigue.p1 > 50 ? 'P2' : 'P1') === C.fav) f.push('Il favorito potrebbe essere stanco'); if (mAg(M) < 65 && +C.conf > 40) f.push('Modelli divisi — alto rischio'); if (M.smartMoney.signal === 'DIVERGENZA') f.push('Smart Money diverge dai modelli statistici'); return { is: f.length >= 2, sc: Math.min(f.length * 18 + 10, 100), fl: f }; }

  // Markets + Kelly
  function markets(C, m, h, sf, b5, oM) {
    const mk = {}; const fn = C.fav === 'P1' ? m.event_first_player : m.event_second_player; const pr = C.fav === 'P1' ? C.p1 : C.p2;
    let kelly = null; const fo = C.fav === 'P1' ? oM.p1O : oM.p2O;
    if (fo && fo > 1) { const p = pr / 100, b = fo - 1, kf = (b * p - (1 - p)) / b; if (kf > 0) kelly = { f: (kf * 100).toFixed(1), q: (kf * 25).toFixed(1), o: fo.toFixed(2) }; }
    mk.winner = { pick: fn, prob: pr.toFixed(1), vs: C.fav === 'P1' ? m.event_second_player : m.event_first_player, kelly, tier: +C.conf >= 60 ? 'Alta' : +C.conf >= 35 ? 'Media' : 'Bassa' };
    const sets = b5 ? 3.2 : 2.3, avg = CFG.GPS[sf] || 9.9, close = 1 - Math.abs(C.p1 - 50) / 50;
    let tg = sets * avg + close * 3.5, ha = null;
    if (h && h.H2H) { const gc = h.H2H.slice(0, 5).map(x => x.scores ? x.scores.reduce((s, sc) => s + (+sc.score_first || 0) + (+sc.score_second || 0), 0) : null).filter(Boolean); if (gc.length) ha = gc.reduce((a, b) => a + b) / gc.length; }
    const adj = ha ? tg * 0.55 + ha * 0.45 : tg; const line = b5 ? 38.5 : Math.round(adj) + 0.5;
    const oP = cl(50 + (adj - line) * 9, 12, 88);
    mk.ou = { line, pred: adj.toFixed(1), pick: oP >= 53 ? `Over ${line}` : oP <= 47 ? `Under ${line}` : 'Neutro', prob: (oP >= 53 ? oP : 100 - oP).toFixed(0), oP: oP.toFixed(0), uP: (100 - oP).toFixed(0), ha: ha ? ha.toFixed(1) : null };
    const pw = C.p1 / 100; mk.sets = { bo: b5 ? 5 : 3, preds: b5 ? b5S(pw) : b3S(pw) };
    return mk;
  }
  function b3S(p) { const s = Math.pow(p, 0.82), q = 1 - s; const sc = [{ s: '2-0', p: s * s, f: 'P1' }, { s: '2-1', p: 2 * s * q * s, f: 'P1' }, { s: '0-2', p: q * q, f: 'P2' }, { s: '1-2', p: 2 * s * q * q, f: 'P2' }]; const t = sc.reduce((a, b) => a + b.p, 0); return sc.map(x => ({ ...x, p: ((x.p / t) * 100).toFixed(1) })).sort((a, b) => b.p - a.p); }
  function b5S(p) { const s = Math.pow(p, 0.82), q = 1 - s; const sc = [{ s: '3-0', p: s ** 3, f: 'P1' }, { s: '3-1', p: 3 * s ** 3 * q, f: 'P1' }, { s: '3-2', p: 6 * s ** 3 * q ** 2, f: 'P1' }, { s: '0-3', p: q ** 3, f: 'P2' }, { s: '1-3', p: 3 * q ** 3 * s, f: 'P2' }, { s: '2-3', p: 6 * q ** 3 * s ** 2, f: 'P2' }]; const t = sc.reduce((a, b) => a + b.p, 0); return sc.map(x => ({ ...x, p: ((x.p / t) * 100).toFixed(1) })).sort((a, b) => b.p - a.p); }
  function dqual(M) { const a = Object.values(M).filter(m => m && m.conf > 0).length; return a >= 7 ? { l: 'HD', c: '#34d399' } : a >= 4 ? { l: 'MD', c: '#f59e0b' } : { l: 'LD', c: '#f87171' }; }
  function iW(m, pk) { const f = String(m.first_player_key) === String(pk); return (f && m.event_winner === 'First Player') || (!f && m.event_winner === 'Second Player'); }
  function dSurf(n) { n = n.toLowerCase(); if (/roland.garros|french.open|rome|roma|madrid|monte.carlo|barcelona|rio|buenos.aires|lyon|hamburg|kitzbuhel|bastad|gstaad|umag|bucharest|marrakech|cordoba|estoril|geneva|parma|sardegna/i.test(n)) return 'clay'; if (/wimbledon|queen|halle|eastbourne|hertogenbosch|mallorca|stuttgart|nottingham/i.test(n)) return 'grass'; if (/paris.masters|paris.indoor|vienna|basel|stockholm|petersburg|moscow|sofia|metz|astana|marseille|dallas|montpellier/i.test(n)) return 'indoor'; return 'hard'; }
  function isSl(n) { return /roland.garros|french.open|wimbledon|us.open|australian.open/i.test(n); }
  function cl(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // ══════════════════════════════════════════════
  //  RENDER FULL PAGE
  // ══════════════════════════════════════════════
  function renderPage(m, A, h2h) {
    const { M, C, R, T, MK, sf, bo5, dq, verify: V } = A;
    const p1 = m.event_first_player, p2 = m.event_second_player;
    const fav = C.fav === 'P1' ? p1 : p2, unfav = C.fav === 'P1' ? p2 : p1;
    const fp = C.fav === 'P1' ? C.p1 : C.p2;
    const isF = m.event_status === 'Finished';
    const gc = R.tier === 'gold' ? 'var(--accent)' : R.tier === 'silver' ? 'var(--gold)' : R.tier === 'bronze' ? '#f97316' : 'var(--lose)';
    const tl = R.tier === 'gold' ? 'A+ — GIOCABILE' : R.tier === 'silver' ? 'B+ — GIOCABILE' : R.tier === 'bronze' ? 'C — CAUTELA' : 'D — SKIP';

    let html = `<button class="back-btn" onclick="TP.goHome()">← Partite</button>`;

    // ── RISULTATO FINALE (for finished matches) ──
    if (isF && V) {
      html += `
      <div class="result-final ${V.hit ? 'hit' : 'miss'}">
        <div class="result-final-header">
          <span class="result-final-icon">${V.hit ? '✅' : '❌'}</span>
          <span>Risultato FINALE</span>
          <span class="result-final-badge ${V.hit ? 'hit' : 'miss'}">${V.hit ? 'PRESO' : 'SBAGLIATO'}</span>
        </div>
        <div class="result-final-scores">
          <div class="result-final-player ${m.event_winner === 'First Player' ? 'winner' : ''}">${p1}</div>
          <div class="result-final-sets">${(m.scores || []).map(s => `<span class="rf-set ${+s.score_first > +s.score_second ? 'won' : ''}">${s.score_first}-${s.score_second}</span>`).join('')}</div>
          <div class="result-final-player right ${m.event_winner === 'Second Player' ? 'winner' : ''}">${p2}</div>
        </div>
        <div class="result-checks">
          <div class="result-check ${V.hit ? 'hit' : 'miss'}"><span>Vincente</span><strong>Previsto: ${fav}</strong><span>${V.hit ? '✅' : '❌'} Reale: ${V.actualName}</span></div>
          ${V.ouHit !== null ? `<div class="result-check ${V.ouHit ? 'hit' : 'miss'}"><span>O/U Game</span><strong>${MK.ou.pick}</strong><span>${V.ouHit ? '✅' : '❌'} ${V.totalGames} game</span></div>` : ''}
          <div class="result-check ${V.setHit ? 'hit' : 'miss'}"><span>Score Set</span><strong>Previsto: ${MK.sets.preds[0]?.s}</strong><span>${V.setHit ? '✅' : '❌'} Reale: ${V.actualSetScore}</span></div>
        </div>
      </div>`;
    }

    // ── HEADER ──
    html += `<div class="ap-header"><div class="ap-header-info"><span class="surface-badge ${sf}">${sf.toUpperCase()}</span> ${m.tournament_name || ''} • ${m.event_type_type || ''} • ${m.event_time || ''}${bo5 ? ' • <span style="color:var(--gold);font-weight:600">Grand Slam</span>' : ''}</div><div class="ap-header-badges"><span class="data-quality-badge" style="color:${dq.c};border-color:${dq.c}">📡 ${dq.l}</span>${M.form.s1 ? `<span style="font-size:0.78rem">${p1.split(' ').pop()}: ${M.form.s1}</span>` : ''}${M.form.s2 ? `<span style="font-size:0.78rem">${p2.split(' ').pop()}: ${M.form.s2}</span>` : ''}</div></div>`;

    // ── MATCHUP + PROB BAR ──
    html += `<div class="ap-matchup"><div class="ap-player ${C.fav === 'P1' ? 'fav' : ''}"><div class="ap-player-name">${p1}</div></div><div class="ap-center"><div class="ap-vs">VS</div></div><div class="ap-player right ${C.fav === 'P2' ? 'fav' : ''}"><div class="ap-player-name">${p2}</div></div></div>`;
    html += `<div class="ap-prob-bar"><div class="ap-prob-fill p1" style="width:${C.p1}%"><span>${C.p1.toFixed(0)}%</span></div><div class="ap-prob-fill p2" style="width:${C.p2}%"><span>${C.p2.toFixed(0)}%</span></div></div>`;

    // ── SCORE + MODELS ──
    html += `<div class="ap-section"><div class="ap-gauge-row"><div class="ap-gauge"><div class="ap-gauge-value" style="color:${gc}">${R.sc}</div><div class="ap-gauge-label">/100</div><div class="ap-gauge-tier" style="border-color:${gc};color:${gc}">${tl}</div></div><div class="ap-scores-list">${C.bd.filter(b => b.active).map(b => `<div class="ap-score-row"><span class="ap-score-icon">${M[b.k]?.icon || '📊'}</span><span class="ap-score-name">${b.name}</span><div class="ap-score-bar"><div class="ap-score-bar-fill" style="width:${b.p1}%;background:${b.p1 >= 55 ? 'var(--accent)' : b.p1 >= 45 ? 'var(--gold)' : 'var(--lose)'}"></div></div><span class="ap-score-val" style="color:${b.p1 >= 55 ? 'var(--accent)' : b.p1 >= 45 ? 'var(--gold)' : 'var(--lose)'}">${Math.round(b.p1)}</span></div>`).join('')}</div></div></div>`;

    // ── ODDS LAB — REGRESSIONE QUOTE ──
    if (M.odds.p1O && M.odds.p2O) {
      const q1 = M.odds.p1O, q2 = M.odds.p2O;
      const imp1 = 1 / q1, imp2 = 1 / q2;
      const margin = ((imp1 + imp2 - 1) * 100).toFixed(1);
      const fairP1 = (imp1 / (imp1 + imp2) * 100), fairP2 = 100 - fairP1;
      const ourP1 = C.p1, ourP2 = C.p2;
      const deltaP1 = ourP1 - fairP1, deltaP2 = ourP2 - fairP2;
      const valueP1 = deltaP1 > 3, valueP2 = deltaP2 > 3;
      const anyValue = valueP1 || valueP2;
      const valueBadge = anyValue ? `<span class="ap-badge-green" style="background:rgba(52,211,153,0.15)">💎 ${valueP1 && valueP2 ? '2 VALUE' : '1 VALUE'}</span>` : `<span style="font-size:0.72rem;color:var(--text-dim)">Margine: ${margin}%</span>`;

      html += `<div class="ap-section">
        <div class="ap-section-header"><span>📊 Odds Lab — Regressione Quote</span>${valueBadge}</div>
        <div class="odds-grid">
          <div class="odds-col head"><div class="odds-cell label"></div><div class="odds-cell label">Quota</div><div class="odds-cell label">Prob. Bookie</div><div class="odds-cell label">Prob. Modello</div><div class="odds-cell label">Δ Edge</div><div class="odds-cell label">Verdetto</div></div>
          <div class="odds-col ${valueP1 ? 'value' : ''}"><div class="odds-cell player">${p1.split(' ').pop()}</div><div class="odds-cell quota">${q1.toFixed(2)}</div><div class="odds-cell">${fairP1.toFixed(1)}%</div><div class="odds-cell our">${ourP1.toFixed(1)}%</div><div class="odds-cell delta ${deltaP1 > 0 ? 'pos' : 'neg'}">${deltaP1 > 0 ? '+' : ''}${deltaP1.toFixed(1)}%</div><div class="odds-cell verdict">${valueP1 ? '<span class="value-tag">💎 VALUE</span>' : deltaP1 > 0 ? '<span class="fair-tag">Fair</span>' : '<span class="no-tag">No Value</span>'}</div></div>
          <div class="odds-col ${valueP2 ? 'value' : ''}"><div class="odds-cell player">${p2.split(' ').pop()}</div><div class="odds-cell quota">${q2.toFixed(2)}</div><div class="odds-cell">${fairP2.toFixed(1)}%</div><div class="odds-cell our">${ourP2.toFixed(1)}%</div><div class="odds-cell delta ${deltaP2 > 0 ? 'pos' : 'neg'}">${deltaP2 > 0 ? '+' : ''}${deltaP2.toFixed(1)}%</div><div class="odds-cell verdict">${valueP2 ? '<span class="value-tag">💎 VALUE</span>' : deltaP2 > 0 ? '<span class="fair-tag">Fair</span>' : '<span class="no-tag">No Value</span>'}</div></div>
        </div>
        ${anyValue ? `<div class="odds-value-msg">${valueP1 ? `VALUE ${p1.split(' ').pop()}: Il modello dà ${ourP1.toFixed(1)}% vs Bookie ${fairP1.toFixed(1)}% (Δ+${deltaP1.toFixed(1)}). Quota @${q1.toFixed(2)} interessante.` : `VALUE ${p2.split(' ').pop()}: Il modello dà ${ourP2.toFixed(1)}% vs Bookie ${fairP2.toFixed(1)}% (Δ+${deltaP2.toFixed(1)}). Quota @${q2.toFixed(2)} interessante.`}</div>` : ''}
        <div class="odds-margin">Margine Bookmaker: ${margin}% • Fair Odds: ${(1 / (fairP1 / 100)).toFixed(2)} / ${(1 / (fairP2 / 100)).toFixed(2)}</div>
      </div>`;
    }

    // ── SMART MONEY ──
    if (M.smartMoney.signal) {
      const smColor = M.smartMoney.signal === 'CONFERMA' ? 'var(--accent)' : M.smartMoney.signal === 'DIVERGENZA' ? 'var(--trap)' : 'var(--text-muted)';
      html += `<div class="ap-section"><div class="ap-section-header"><span>🧠 Smart Money</span><span class="ap-badge-green" style="background:${M.smartMoney.signal === 'DIVERGENZA' ? 'rgba(249,115,22,0.15)' : ''};color:${smColor}">${M.smartMoney.signal}</span></div><p style="font-size:0.85rem;color:var(--text-secondary)">${M.smartMoney.det}</p></div>`;
    }

    // ── KELLY ──
    if (MK.winner.kelly) {
      html += `<div class="ap-section ap-stake"><div class="ap-section-header"><span>💰 Stake Advisor</span><span class="ap-badge-green">¼ Kelly</span></div><div class="ap-stake-grid"><div class="ap-stake-item main"><div class="ap-stake-label">STAKE</div><div class="ap-stake-value">${MK.winner.kelly.q}%</div><div class="ap-stake-sub">del bankroll</div></div><div class="ap-stake-item"><div class="ap-stake-label">QUOTA</div><div class="ap-stake-value">@${MK.winner.kelly.o}</div></div><div class="ap-stake-item"><div class="ap-stake-label">FULL KELLY</div><div class="ap-stake-value">${MK.winner.kelly.f}%</div></div></div></div>`;
    }

    // ── TRAP ──
    if (T.is) html += `<div class="ap-section ap-trap"><div class="ap-section-header"><span>🕵️ Trap Detector</span><span class="ap-badge-orange">${T.sc}/100</span></div>${T.fl.map(f => `<div class="ap-trap-flag">⚠️ ${f}</div>`).join('')}</div>`;

    // ── PRONOSTICI ──
    html += `<div class="ap-section"><div class="ap-section-header"><span>🎾 Pronostici${isF ? ' (retroattivi)' : ''}</span></div>`;
    html += `<div class="ap-prono-card main"><div class="ap-prono-label">VINCENTE</div><div class="ap-prono-pick">${fav}</div><div class="ap-prono-prob">${fp.toFixed(0)}%</div><div class="ap-prono-conf-badge ${MK.winner.tier === 'Alta' ? 'green' : MK.winner.tier === 'Media' ? 'yellow' : 'red'}">✓ ${MK.winner.tier}</div>${MK.winner.kelly ? `<div class="ap-prono-odds">@ ${MK.winner.kelly.o}</div>` : ''}</div>`;
    html += `<div class="ap-prono-card"><div class="ap-prono-label">OVER/UNDER GAME</div><div class="ap-prono-pick">${MK.ou.pick}</div><div class="ap-prono-prob">${MK.ou.prob}%</div><div class="ap-prono-detail">Previsti: ${MK.ou.pred}${MK.ou.ha ? ` • H2H: ${MK.ou.ha}` : ''}</div><div class="ap-ou-bars"><div class="ap-ou-item ${+MK.ou.oP > 50 ? 'active' : ''}"><span>Over ${MK.ou.line}</span><strong>${MK.ou.oP}%</strong></div><div class="ap-ou-item ${+MK.ou.uP > 50 ? 'active' : ''}"><span>Under ${MK.ou.line}</span><strong>${MK.ou.uP}%</strong></div></div></div>`;
    html += `<div class="ap-prono-card"><div class="ap-prono-label">SET SCORE (Bo${MK.sets.bo})</div><div class="ap-sets-grid">${MK.sets.preds.map((x, i) => `<div class="ap-set-chip ${i === 0 ? 'top' : ''}"><div class="ap-set-score">${x.s}</div><div class="ap-set-prob">${x.p}%</div><div class="ap-set-who">${x.f === 'P1' ? p1.split(' ').pop() : p2.split(' ').pop()}</div></div>`).join('')}</div></div></div>`;

    // ── CONSENSUS ──
    html += `<div class="ap-section"><div class="ap-section-header"><span>🏆 Consensus Engine</span><span class="ap-badge-green">${C.ac}/${C.total} • ${R.ag}%</span></div><div class="ap-consensus-pick"><div class="ap-consensus-label">MASSIMA CONVERGENZA</div><div class="ap-consensus-name">${fav}</div><div class="ap-consensus-prob">${fp.toFixed(1)}% • Accordo: ${R.ag}%</div></div><div class="ap-consensus-models">${C.bd.filter(b => b.active).map(b => `<div class="ap-cm-chip"><span>${M[b.k]?.icon}</span><span>${b.name}</span><strong style="color:${b.p1 >= 50 ? 'var(--accent)' : 'var(--lose)'}">${b.p1 >= 50 ? p1.split(' ').pop() : p2.split(' ').pop()}</strong><span class="ap-cm-pct">${Math.max(b.p1, 100 - b.p1).toFixed(0)}%</span></div>`).join('')}</div></div>`;

    // ── H2H ──
    if (h2h && h2h.H2H && h2h.H2H.length) {
      html += `<div class="ap-section"><div class="ap-section-header"><span>⚔️ Precedenti</span><span style="font-size:0.78rem;color:var(--text-muted)">${M.h2h.w1}-${M.h2h.w2}</span></div><div class="h2h-mini-list">${h2h.H2H.slice(0, 6).map(x => { const sc = x.scores ? x.scores.map(s => `${s.score_first}-${s.score_second}`).join(' ') : x.event_final_result || ''; return `<div class="h2h-mini-row"><span class="h2h-mini-date">${x.event_date || ''}</span><span class="h2h-mini-player ${x.event_winner === 'First Player' ? 'winner' : ''}">${x.event_first_player}</span><span class="h2h-mini-score">${sc}</span><span class="h2h-mini-player right ${x.event_winner === 'Second Player' ? 'winner' : ''}">${x.event_second_player}</span></div>`; }).join('')}</div></div>`;
    }

    html += `<div style="text-align:center;padding:2rem 0;color:var(--text-dim);font-size:0.72rem">⚠️ Analisi statistica a scopo informativo</div>`;
    return html;
  }

  // ══════════════════════════════════════════════
  //  HOME: TOURNAMENT LIST + PREDICTIONS
  // ══════════════════════════════════════════════
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
    S.acc = { hit: 0, miss: 0, total: 0 }; // reset accuracy
    c.innerHTML = ts.map(t => {
      const sf = dSurf(t.name), up = t.m.filter(x => x.event_status !== 'Finished').length;
      return `<div class="tournament-card open"><div class="tournament-header" onclick="this.parentElement.classList.toggle('open')"><div class="tournament-info"><span class="surface-badge ${sf}">${sf.toUpperCase()}</span><span class="tournament-name">${t.name}</span><span class="tournament-type">${t.type.replace(/Singles|Doubles/gi, '').trim()}</span></div><div class="tournament-meta"><span class="tournament-count">${t.m.length}</span>${up ? `<span class="tournament-upcoming">${up} da giocare</span>` : ''}<span class="tournament-arrow">▾</span></div></div><div class="tournament-matches">${t.m.sort((a, b) => { const af = a.event_status === 'Finished' ? 1 : 0; return af !== (b.event_status === 'Finished' ? 1 : 0) ? af - (b.event_status === 'Finished' ? 1 : 0) : (a.event_time || '').localeCompare(b.event_time || ''); }).map(x => rmr(x)).join('')}</div></div>`;
    }).join('');
    loadQuickPreds();
  }

  function rmr(m) {
    const isF = m.event_status === 'Finished', isL = m.event_live === '1';
    let sc = ''; if (m.scores && m.scores.length) sc = m.scores.map(s => `<span class="set-score-mini ${+s.score_first > +s.score_second ? 'won' : ''}">${s.score_first}-${s.score_second}</span>`).join(' ');
    let st = isF ? `<span class="status-badge finished">✓</span>` : isL ? `<span class="status-badge live">LIVE</span>` : `<span class="status-badge upcoming">${m.event_time || 'TBD'}</span>`;
    const rd = m.tournament_round ? m.tournament_round.replace(m.tournament_name || '', '').replace(/^\s*-\s*/, '').trim() : '';
    // ALL matches are clickable now
    return `<div class="match-row clickable ${isL ? 'live' : ''}" data-ek="${m.event_key}"><div class="match-row-status">${st}</div><div class="match-row-players"><span class="match-row-p ${m.event_winner === 'First Player' ? 'winner' : ''}">${m.event_first_player}</span><span class="match-row-vs">vs</span><span class="match-row-p ${m.event_winner === 'Second Player' ? 'winner' : ''}">${m.event_second_player}</span></div><div class="match-row-pred" id="pred-${m.event_key}"><span class="pred-loading">⏳</span></div><div class="match-row-score">${sc}</div><div class="match-row-round">${rd}</div><div class="match-row-cta">📊</div></div>`;
  }

  async function loadQuickPreds() {
    S.acc = { hit: 0, miss: 0, total: 0 };
    for (const match of S.matches) {
      if (S.tab !== 'matches') break;
      try {
        const h2h = await gh(match.first_player_key, match.second_player_key);
        const A = engine(match, h2h, null);
        const el = document.getElementById(`pred-${match.event_key}`);
        if (!el) continue;
        const C = A.C, R = A.R;
        const favName = C.fav === 'P1' ? match.event_first_player.split(' ').pop() : match.event_second_player.split(' ').pop();
        const prob = Math.round(C.fav === 'P1' ? C.p1 : C.p2);
        const isF = match.event_status === 'Finished';

        if (isF && match.event_winner && A.verify) {
          S.acc.total++;
          if (A.verify.hit) S.acc.hit++; else S.acc.miss++;
          const cls = A.verify.hit ? 'hit' : 'miss';
          el.innerHTML = `<span class="pred-badge ${cls}"><span class="pred-icon">${A.verify.hit ? '✅' : '❌'}</span><span class="pred-name">${favName}</span><span class="pred-pct">${prob}%</span></span>`;
          updateAccuracy();
        } else if (!isF) {
          const cls = prob >= 65 ? 'green' : prob >= 52 ? 'yellow' : 'red';
          el.innerHTML = `<span class="pred-badge ${cls}"><span class="pred-name">${favName}</span><span class="pred-pct">${prob}%</span></span>`;
        } else {
          el.innerHTML = '';
        }
      } catch (e) { const el = document.getElementById(`pred-${match.event_key}`); if (el) el.innerHTML = ''; }
    }
  }

  function updateAccuracy() {
    const bar = document.getElementById('accuracyBar');
    if (S.acc.total === 0) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    const pct = ((S.acc.hit / S.acc.total) * 100).toFixed(0);
    const cls = +pct >= 70 ? 'green' : +pct >= 50 ? 'yellow' : 'red';
    bar.innerHTML = `<div class="acc-label">📊 Accuracy Giornaliera</div><div class="acc-stats"><span class="acc-pct ${cls}">${pct}%</span><span class="acc-detail">✅ ${S.acc.hit} / ${S.acc.total} analizzati (❌ ${S.acc.miss})</span></div><div class="acc-bar-track"><div class="acc-bar-fill ${cls}" style="width:${pct}%"></div></div>`;
  }

  // ═══ LIVE / RANK ═══
  async function loadLive() { const c = document.getElementById('liveContainer'); const d = await api('live'); if (d.success === 1 && d.result && d.result.length) { S.live = d.result; document.getElementById('liveCount').textContent = d.result.length; document.getElementById('liveCount').style.display = 'inline'; renderLive(); } else { S.live = []; document.getElementById('liveCount').style.display = 'none'; c.innerHTML = `<div class="empty-state"><div class="empty-icon">😴</div><div class="empty-title">Nessun match live</div></div>`; } }
  function renderLive() { const c = document.getElementById('liveContainer'); let m = [...S.live]; if (S.lFlt !== 'all') m = m.filter(x => (x.event_type_type || '').toLowerCase().includes(S.lFlt)); if (!m.length) { c.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div></div>`; return; } c.innerHTML = m.map(x => { const sv = x.event_serve; let sH = ''; if (x.scores && x.scores.length) sH = `<div class="match-score">${x.scores.map(s => `<div class="set-score ${+s.score_first > +s.score_second ? 'won' : ''}">${s.score_first}-${s.score_second}</div>`).join('')}</div>`; const gs = x.event_game_result || ''; return `<div class="match-card live"><div class="match-card-header"><span class="match-tournament"><span class="surface-badge ${dSurf(x.tournament_name || '')}">${dSurf(x.tournament_name || '').toUpperCase()}</span> ${x.tournament_name || ''}</span><span class="match-time live">● ${x.event_status || 'LIVE'}</span></div><div class="match-players"><div class="player"><span class="player-name">${sv === 'First Player' ? '🎾 ' : ''}${x.event_first_player}</span></div><div style="text-align:center">${sH}${gs && gs !== '-' ? `<div style="font-family:var(--font-mono);font-size:1rem;color:var(--gold);margin-top:6px;font-weight:700">${gs}</div>` : ''}</div><div class="player right"><span class="player-name">${sv === 'Second Player' ? '🎾 ' : ''}${x.event_second_player}</span></div></div></div>`; }).join(''); }
  function startLive() { loadLive(); S.lInt = setInterval(loadLive, CFG.LIVE_MS); } function stopLive() { if (S.lInt) { clearInterval(S.lInt); S.lInt = null; } }
  async function loadRank() { const c = document.getElementById('rankingsContainer'); c.innerHTML = `<div class="loading-state"><div class="loading-spinner"></div></div>`; const d = await api('stand', { etk: S.rk === 'atp' ? '265' : '266' }); if (d.success === 1 && d.result && d.result.length) { c.innerHTML = `<table class="rankings-table"><thead><tr><th>#</th><th>Giocatore</th><th>Punti</th></tr></thead><tbody>${d.result.slice(0, 100).map((p, i) => `<tr><td><span class="rank-number ${(p.place || i + 1) <= 3 ? 'top-3' : ''}">${p.place || i + 1}</span></td><td>${p.player_name || p.team_name || '-'}</td><td class="stat-mono">${p.points || p.team_points || '-'}</td></tr>`).join('')}</tbody></table>`; } else c.innerHTML = `<div class="empty-state"><div class="empty-icon">🏆</div><div class="empty-title">Non disponibile</div></div>`; }
  async function loadH2H() {}

  return { init, openMatch, goHome, loadH2H, switchTab: swTab };
})();
document.addEventListener('DOMContentLoaded', TP.init);
