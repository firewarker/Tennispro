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
  function isSl(n) { return /roland.garros|french.open|wimbledon|us.ope
