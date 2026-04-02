/**
 * TennisPro v3.0 — app.js
 * 8-Model Prediction Engine + Consensus + Regression + Trap Detector + Kelly
 */
const TP = (() => {

  const CFG = {
    WORKER: 'https://tennispro.lucalagan.workers.dev',
    LIVE_MS: 30000,
    WEIGHTS: { elo: 0.18, surface: 0.14, form: 0.16, h2h: 0.12, dominance: 0.10, serve: 0.10, fatigue: 0.08, odds: 0.12 },
    GAMES_PER_SET: { clay: 10.2, grass: 9.6, hard: 9.8, indoor: 9.7, unknown: 9.9 },
    EVENT: { ATP: '265', WTA: '266', CHALLENGER: '281' },
  };

  let S = {
    tab: 'matches', dateOff: 0, filter: 'all', liveFilter: 'all', rankType: 'atp',
    liveInt: null, matches: [], live: [], h2hCache: {}, oddsCache: {},
    h2hP1Key: null, h2hP2Key: null,
  };

  // ═══════ INIT ═══════
  function init() {
    setDate();
    document.querySelectorAll('.nav-tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
    document.querySelectorAll('.date-btn').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('.date-btn').forEach(x => x.classList.remove('active')); b.classList.add('active'); S.dateOff = +b.dataset.offset; loadMatches(); }));
    document.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('[data-filter]').forEach(x => x.classList.remove('active')); b.classList.add('active'); S.filter = b.dataset.filter; renderTournaments(); }));
    document.querySelectorAll('[data-live-filter]').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('[data-live-filter]').forEach(x => x.classList.remove('active')); b.classList.add('active'); S.liveFilter = b.dataset.liveFilter; renderLive(); }));
    document.querySelectorAll('[data-ranking]').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('[data-ranking]').forEach(x => x.classList.remove('active')); b.classList.add('active'); S.rankType = b.dataset.ranking; loadRankings(); }));
    document.getElementById('modalOverlay').addEventListener('click', e => { if (e.target.id === 'modalOverlay') closeModal(); });
    document.getElementById('modalClose').addEventListener('click', closeModal);
    // Event delegation for match clicks
    document.getElementById('tournamentsContainer').addEventListener('click', e => {
      const row = e.target.closest('.match-row[data-ek]');
      if (row) { e.stopPropagation(); openMatch(row.dataset.ek); }
    });
    loadMatches();
    loadRankings();
  }

  function setDate() {
    document.getElementById('headerDate').textContent = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  function dateStr(off = 0) { const d = new Date(); d.setDate(d.getDate() + off); return d.toISOString().split('T')[0]; }

  function switchTab(id) {
    S.tab = id;
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === id));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${id}`));
    if (id === 'live') startLive(); else stopLive();
    if (id === 'rankings') loadRankings();
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
      const r = await fetch(`${CFG.WORKER}/${path}${qs ? '?' + qs : ''}`);
      return await r.json();
    } catch (e) { console.error('API:', e); return { success: 0, result: [] }; }
  }

  // ═══════ MODAL ═══════
  function closeModal() { document.getElementById('modalOverlay').classList.remove('open'); document.body.style.overflow = ''; }

  async function openMatch(ek) {
    const match = S.matches.find(m => m.event_key === ek);
    if (!match) return;
    document.body.style.overflow = 'hidden';
    const ov = document.getElementById('modalOverlay'), ct = document.getElementById('modalContent');
    ov.classList.add('open');
    ct.innerHTML = `<div class="modal-loading"><div class="loading-spinner"></div><p>🧠 Analisi in corso...</p><p class="modal-loading-sub">Caricamento H2H · Quote · Statistiche</p></div>`;

    const [h2h, odds] = await Promise.all([getH2H(match.first_player_key, match.second_player_key), getOdds(match.event_key)]);
    const analysis = runEngine(match, h2h, odds);
    ct.innerHTML = renderAnalysis(match, analysis, h2h);
    ct.scrollTop = 0;
  }

  async function getH2H(p1, p2) {
    const k = `${p1}_${p2}`;
    if (S.h2hCache[k]) return S.h2hCache[k];
    const d = await api('h2h', { p1, p2 });
    if (d.success === 1 && d.result) { S.h2hCache[k] = d.result; return d.result; }
    return null;
  }

  async function getOdds(ek) {
    if (S.oddsCache[ek]) return S.oddsCache[ek];
    const d = await api('odds', { mk: ek });
    if (d.success === 1 && d.result) { S.oddsCache[ek] = d.result; return d.result; }
    return null;
  }

  // ════════════════════════════════════════════════════════════
  //  🧠 ENGINE v3.0 — 8 MODELS + CONSENSUS + TRAP + KELLY
  // ════════════════════════════════════════════════════════════

  function runEngine(match, h2h, odds) {
    const surf = detectSurf(match.tournament_name || '');
    const bo5 = isSlam(match.tournament_name || '');
    const M = {};

    M.elo = mElo(h2h, match);
    M.surface = mSurface(h2h, match, surf);
    M.form = mForm(h2h, match);
    M.h2h = mH2H(h2h, match);
    M.dominance = mDominance(h2h, match);
    M.serve = mServe(h2h, match);
    M.fatigue = mFatigue(h2h, match);
    M.odds = mOdds(odds);

    const consensus = calcConsensus(M);
    const regression = calcRegression(M, consensus);
    const trap = detectTrap(M, consensus);
    const markets = calcMarkets(consensus, match, h2h, surf, bo5, M.odds);

    return { M, consensus, regression, trap, markets, surf, bo5, dq: dataQuality(M) };
  }

  // ── 1. Elo ──
  function mElo(h2h, match) {
    const r = { name: 'Elo Rating', icon: '📐', p1: 50, conf: 0, det: '' };
    if (!h2h) return r;
    const p1R = h2h.firstPlayerResults || [], p2R = h2h.secondPlayerResults || [];
    if (p1R.length < 2 && p2R.length < 2) { r.det = 'Dati insufficienti'; return r; }

    let e1 = 1500, e2 = 1500;
    const K = 32;
    p1R.slice(0, 12).reverse().forEach(m => {
      const won = isWin(m, match.first_player_key);
      e1 += K * ((won ? 1 : 0) - 1 / (1 + Math.pow(10, (1500 - e1) / 400)));
    });
    p2R.slice(0, 12).reverse().forEach(m => {
      const won = isWin(m, match.second_player_key);
      e2 += K * ((won ? 1 : 0) - 1 / (1 + Math.pow(10, (1500 - e2) / 400)));
    });

    const d = e1 - e2;
    r.p1 = clamp(1 / (1 + Math.pow(10, -d / 400)) * 100, 5, 95);
    r.conf = Math.min(Math.abs(d) / 2.5, 100);
    r.det = `${e1.toFixed(0)} vs ${e2.toFixed(0)} (Δ${d > 0 ? '+' : ''}${d.toFixed(0)})`;
    return r;
  }

  // ── 2. Surface ──
  function mSurface(h2h, match, surf) {
    const r = { name: `Superficie (${cap(surf)})`, icon: '🏟️', p1: 50, conf: 0, det: '' };
    if (!h2h || surf === 'unknown') return r;
    const s1 = surfWins(h2h.firstPlayerResults || [], match.first_player_key, surf);
    const s2 = surfWins(h2h.secondPlayerResults || [], match.second_player_key, surf);
    const r1 = s1.w / Math.max(s1.t, 1), r2 = s2.w / Math.max(s2.t, 1);
    r.p1 = clamp(50 + (r1 - r2) * 55, 8, 92);
    r.conf = Math.min((s1.t + s2.t) * 7, 100);
    r.det = `P1: ${(r1 * 100).toFixed(0)}% (${s1.w}/${s1.t}) | P2: ${(r2 * 100).toFixed(0)}% (${s2.w}/${s2.t})`;
    return r;
  }

  function surfWins(res, pk, surf) {
    let w = 0, t = 0;
    res.slice(0, 15).forEach(m => { if (detectSurf(m.tournament_name || '') === surf) { t++; if (isWin(m, pk)) w++; } });
    return { w, t };
  }

  // ── 3. Form Momentum ──
  function mForm(h2h, match) {
    const r = { name: 'Forma Recente', icon: '🔥', p1: 50, conf: 0, det: '', s1: '', s2: '' };
    if (!h2h) return r;
    const f1 = wForm(h2h.firstPlayerResults || [], match.first_player_key);
    const f2 = wForm(h2h.secondPlayerResults || [], match.second_player_key);
    r.p1 = clamp(50 + (f1.sc - f2.sc) * 28, 6, 94);
    r.conf = Math.min((f1.n + f2.n) * 9, 100);
    r.det = `P1: ${(f1.sc * 100).toFixed(0)}% ${f1.str} | P2: ${(f2.sc * 100).toFixed(0)}% ${f2.str}`;
    r.s1 = f1.str; r.s2 = f2.str;
    return r;
  }

  function wForm(res, pk) {
    const l = res.slice(0, 8);
    if (!l.length) return { sc: 0.5, str: '-', n: 0 };
    let ws = 0, wt = 0, sk = 0, st = null;
    l.forEach((m, i) => {
      const w = 1 - i * 0.1, won = isWin(m, pk);
      ws += won ? w : 0; wt += w;
      if (i === 0) { st = won; sk = 1; } else if (won === st) sk++;
    });
    return { sc: wt > 0 ? ws / wt : 0.5, str: st ? `${sk}W🟢` : `${sk}L🔴`, n: l.length };
  }

  // ── 4. H2H ──
  function mH2H(h2h, match) {
    const r = { name: 'Head-to-Head', icon: '⚔️', p1: 50, conf: 0, det: '', w1: 0, w2: 0 };
    if (!h2h || !h2h.H2H || !h2h.H2H.length) { r.det = 'Nessun precedente'; return r; }
    let w1 = 0, w2 = 0, rw1 = 0, rw2 = 0;
    h2h.H2H.forEach((m, i) => {
      const p1w = isWin(m, match.first_player_key);
      if (p1w) w1++; else w2++;
      if (i < 3) { if (p1w) rw1++; else rw2++; }
    });
    const tot = w1 + w2, base = (w1 / tot) * 100;
    const rec = (rw1 + rw2) > 0 ? (rw1 / (rw1 + rw2)) * 100 : base;
    r.p1 = clamp(base * 0.55 + rec * 0.45, 8, 92);
    r.conf = Math.min(tot * 18, 100);
    r.det = `${w1}-${w2} (ultimi 3: ${rw1}-${rw2})`;
    r.w1 = w1; r.w2 = w2;
    return r;
  }

  // ── 5. Dominance Index (NEW) ──
  function mDominance(h2h, match) {
    const r = { name: 'Indice Dominio', icon: '💪', p1: 50, conf: 0, det: '' };
    if (!h2h) return r;
    const d1 = calcDominance(h2h.firstPlayerResults || [], match.first_player_key);
    const d2 = calcDominance(h2h.secondPlayerResults || [], match.second_player_key);
    if (d1.n === 0 && d2.n === 0) return r;
    r.p1 = clamp(50 + (d1.idx - d2.idx) * 20, 10, 90);
    r.conf = Math.min((d1.n + d2.n) * 8, 100);
    r.det = `P1: ${d1.idx.toFixed(2)} (${d1.straight}/${d1.n} in 2) | P2: ${d2.idx.toFixed(2)} (${d2.straight}/${d2.n} in 2)`;
    return r;
  }

  function calcDominance(res, pk) {
    let totalMargin = 0, straight = 0, n = 0;
    res.slice(0, 8).forEach(m => {
      if (!m.scores || !m.scores.length || m.event_winner === null) return;
      const won = isWin(m, pk);
      if (!won) return;
      n++;
      // Calculate game margin
      let gamesWon = 0, gamesLost = 0;
      const isFirst = String(m.first_player_key) === String(pk);
      m.scores.forEach(s => {
        gamesWon += parseInt(isFirst ? s.score_first : s.score_second) || 0;
        gamesLost += parseInt(isFirst ? s.score_second : s.score_first) || 0;
      });
      totalMargin += (gamesWon - gamesLost);
      // Straight sets = won in minimum sets
      const setsWon = m.scores.filter(s => {
        const a = parseInt(isFirst ? s.score_first : s.score_second) || 0;
        const b = parseInt(isFirst ? s.score_second : s.score_first) || 0;
        return a > b;
      }).length;
      if (setsWon === m.scores.length) straight++;
    });
    const idx = n > 0 ? totalMargin / n / 5 : 0; // normalized dominance
    return { idx: clamp(idx, -1, 1), straight, n };
  }

  // ── 6. Serve Efficiency (NEW) ──
  function mServe(h2h, match) {
    const r = { name: 'Efficienza Servizio', icon: '🎯', p1: 50, conf: 0, det: '' };
    if (!h2h) return r;
    const s1 = calcServeEff(h2h.firstPlayerResults || [], match.first_player_key);
    const s2 = calcServeEff(h2h.secondPlayerResults || [], match.second_player_key);
    if (s1.n === 0 && s2.n === 0) return r;
    r.p1 = clamp(50 + (s1.eff - s2.eff) * 35, 10, 90);
    r.conf = Math.min((s1.n + s2.n) * 7, 100);
    r.det = `P1: ${(s1.eff * 100).toFixed(0)}% hold | P2: ${(s2.eff * 100).toFixed(0)}% hold`;
    return r;
  }

  function calcServeEff(res, pk) {
    // Estimate serve hold % from set scores
    // In a set, if player won 6 games, roughly half on serve. 6-4 means ~3 holds + 1 break
    let totalSets = 0, holdRate = 0;
    res.slice(0, 8).forEach(m => {
      if (!m.scores || !m.scores.length) return;
      const isFirst = String(m.first_player_key) === String(pk);
      m.scores.forEach(s => {
        const won = parseInt(isFirst ? s.score_first : s.score_second) || 0;
        const lost = parseInt(isFirst ? s.score_second : s.score_first) || 0;
        const totalGames = won + lost;
        if (totalGames < 6) return;
        // Estimate: in a set, each player serves ~half the games
        // Games won on serve ≈ won - breaks made. Breaks made ≈ (lost_serve_games)
        // Simplified: hold% ≈ games_won / (total_games / 2)
        const serveGames = Math.ceil(totalGames / 2);
        holdRate += Math.min(won / serveGames, 1);
        totalSets++;
      });
    });
    return { eff: totalSets > 0 ? holdRate / totalSets : 0.5, n: totalSets };
  }

  // ── 7. Fatigue Factor (NEW) ──
  function mFatigue(h2h, match) {
    const r = { name: 'Fattore Fatica', icon: '🔋', p1: 50, conf: 0, det: '' };
    if (!h2h) return r;
    const f1 = calcFatigue(h2h.firstPlayerResults || [], match.event_date);
    const f2 = calcFatigue(h2h.secondPlayerResults || [], match.event_date);

    // Lower fatigue = better. If f1 < f2, P1 is more rested
    const diff = f2.score - f1.score; // positive = P1 advantage
    r.p1 = clamp(50 + diff * 8, 20, 80);
    r.conf = Math.min((f1.matches + f2.matches) * 10, 70);
    r.det = `P1: ${f1.label} (${f1.matches} in 7gg) | P2: ${f2.label} (${f2.matches} in 7gg)`;
    return r;
  }

  function calcFatigue(res, matchDate) {
    const today = new Date(matchDate || new Date());
    let matchesIn7d = 0, matchesIn3d = 0, lastMatchDaysAgo = 999;

    res.slice(0, 10).forEach(m => {
      if (!m.event_date) return;
      const mDate = new Date(m.event_date);
      const daysAgo = Math.floor((today - mDate) / 86400000);
      if (daysAgo >= 0 && daysAgo <= 7) matchesIn7d++;
      if (daysAgo >= 0 && daysAgo <= 3) matchesIn3d++;
      if (daysAgo >= 0 && daysAgo < lastMatchDaysAgo) lastMatchDaysAgo = daysAgo;
    });

    // Fatigue score: higher = more tired
    const score = matchesIn3d * 2 + matchesIn7d * 0.5 + (lastMatchDaysAgo <= 1 ? 2 : 0);
    let label = '🟢 Fresco';
    if (score >= 5) label = '🔴 Stanco';
    else if (score >= 3) label = '🟡 Normale';

    return { score, matches: matchesIn7d, label, lastDaysAgo: lastMatchDaysAgo };
  }

  // ── 8. Odds Intelligence ──
  function mOdds(oddsData) {
    const r = { name: 'Intelligence Quote', icon: '💰', p1: 50, conf: 0, det: '', p1O: null, p2O: null };
    if (!oddsData) { r.det = 'Quote N/D'; return r; }
    const o = parseOdds(oddsData);
    if (!o) { r.det = 'Quote non trovate'; return r; }
    r.p1O = o.p1; r.p2O = o.p2;
    const i1 = 1 / o.p1, i2 = 1 / o.p2, mg = i1 + i2 - 1;
    const fair1 = (i1 / (i1 + i2)) * 100;
    r.p1 = fair1;
    r.conf = clamp(mg * 200 + 40, 20, 92);
    r.det = `P1: ${o.p1.toFixed(2)} (${fair1.toFixed(0)}%) | P2: ${o.p2.toFixed(2)} (${(100 - fair1).toFixed(0)}%) | Mg: ${(mg * 100).toFixed(1)}%`;
    return r;
  }

  function parseOdds(data) {
    try {
      const arr = Array.isArray(data) ? data : [data];
      for (const e of arr) {
        if (!e) continue;
        if (e.odd_1 && e.odd_2) return { p1: +e.odd_1, p2: +e.odd_2 };
        for (const bk of (e.bookmakers || [])) {
          for (const mk of (Array.isArray(bk.odds || bk.markets) ? (bk.odds || bk.markets) : [])) {
            if (mk.odd_1 && mk.odd_2) return { p1: +mk.odd_1, p2: +mk.odd_2 };
          }
        }
      }
    } catch (e) {}
    return null;
  }

  // ═══════ CONSENSUS ENGINE ═══════
  function calcConsensus(M) {
    let ws = 0, wt = 0, active = 0;
    const bd = [];
    Object.entries(CFG.WEIGHTS).forEach(([k, w]) => {
      const m = M[k];
      if (!m || m.conf === 0) { bd.push({ k, name: m?.name || k, p1: 50, w: 0, active: false }); return; }
      const ew = w * (m.conf / 100);
      ws += m.p1 * ew; wt += ew; active++;
      bd.push({ k, name: m.name, icon: m.icon, p1: m.p1, w: ew, conf: m.conf, active: true });
    });
    const cp = wt > 0 ? ws / wt : 50;
    return { p1: clamp(cp, 2, 98), p2: clamp(100 - cp, 2, 98), conf: (Math.abs(cp - 50) * 2).toFixed(0), fav: cp >= 50 ? 'P1' : 'P2', active, total: 8, bd };
  }

  // ═══════ REGRESSION SCORE ═══════
  function calcRegression(M, C) {
    const agree = modelAgree(M);
    const avgC = C.bd.filter(b => b.active).reduce((s, b) => s + (b.conf || 0), 0) / Math.max(C.active, 1);
    const sc = +C.conf * 0.35 + agree * 0.35 + avgC * 0.30;
    const tier = sc >= 72 ? 'gold' : sc >= 52 ? 'silver' : sc >= 32 ? 'bronze' : 'skip';
    const stars = sc >= 82 ? 5 : sc >= 67 ? 4 : sc >= 52 ? 3 : sc >= 37 ? 2 : 1;
    return { sc: sc.toFixed(1), tier, stars, agree: agree.toFixed(0), avgC: avgC.toFixed(0) };
  }

  function modelAgree(M) {
    const p = Object.values(M).filter(m => m && m.conf > 0).map(m => m.p1 >= 50 ? 'P1' : 'P2');
    if (!p.length) return 0;
    return (Math.max(p.filter(x => x === 'P1').length, p.filter(x => x === 'P2').length) / p.length) * 100;
  }

  // ═══════ 🕵️ TRAP DETECTOR ═══════
  function detectTrap(M, C) {
    const flags = [];
    // Trap 1: Odds disagree strongly with consensus
    if (M.odds.conf > 0 && Math.abs(M.odds.p1 - C.p1) > 18) {
      flags.push('⚠️ Quote in forte disaccordo con il consensus');
    }
    // Trap 2: Good form but bad H2H
    if (M.form.conf > 0 && M.h2h.conf > 0) {
      const formFav = M.form.p1 >= 50 ? 'P1' : 'P2';
      const h2hFav = M.h2h.p1 >= 50 ? 'P1' : 'P2';
      if (formFav !== h2hFav && Math.abs(M.form.p1 - 50) > 12 && Math.abs(M.h2h.p1 - 50) > 12) {
        flags.push('⚠️ Forma e H2H indicano giocatori diversi');
      }
    }
    // Trap 3: Fatigue imbalance
    if (M.fatigue.conf > 0 && Math.abs(M.fatigue.p1 - 50) > 15) {
      const tired = M.fatigue.p1 > 50 ? 'P2' : 'P1';
      if (tired === C.fav) flags.push('⚠️ Il favorito potrebbe essere stanco');
    }
    // Trap 4: Low model agreement with high confidence
    const agree = modelAgree(M);
    if (agree < 65 && +C.conf > 40) {
      flags.push('⚠️ Modelli divisi — alto rischio');
    }
    // Trap 5: Surface specialist underdog
    if (M.surface.conf > 30 && M.surface.p1 < 40 && C.fav === 'P1') {
      flags.push('⚠️ Sfavorito è uno specialista di questa superficie');
    }
    if (M.surface.conf > 30 && M.surface.p1 > 60 && C.fav === 'P2') {
      flags.push('⚠️ Sfavorito è uno specialista di questa superficie');
    }

    return { isTrap: flags.length >= 2, flags };
  }

  // ═══════ MARKETS + KELLY ═══════
  function calcMarkets(C, match, h2h, surf, bo5, oddsM) {
    const mk = {};
    const fName = C.fav === 'P1' ? match.event_first_player : match.event_second_player;
    const oName = C.fav === 'P1' ? match.event_second_player : match.event_first_player;
    const prob = C.fav === 'P1' ? C.p1 : C.p2;

    // Kelly Criterion
    let kelly = null;
    const favOdds = C.fav === 'P1' ? oddsM.p1O : oddsM.p2O;
    if (favOdds && favOdds > 1) {
      const p = prob / 100, b = favOdds - 1;
      const kf = (b * p - (1 - p)) / b;
      kelly = kf > 0 ? { fraction: (kf * 100).toFixed(1), quarter: (kf * 25).toFixed(1), odds: favOdds.toFixed(2) } : null;
    }

    mk.winner = { name: 'Vincente Match', icon: '🏆', pick: fName, prob: prob.toFixed(1), vs: oName, kelly };

    // Over/Under
    const sets = bo5 ? 3.2 : 2.3;
    const avg = CFG.GAMES_PER_SET[surf] || 9.9;
    const close = 1 - Math.abs(C.p1 - 50) / 50;
    let tg = sets * avg + close * 3.5;
    let h2hAvg = null;
    if (h2h && h2h.H2H) {
      const gc = h2h.H2H.slice(0, 5).map(m => m.scores ? m.scores.reduce((s, sc) => s + (+sc.score_first || 0) + (+sc.score_second || 0), 0) : null).filter(Boolean);
      if (gc.length) h2hAvg = gc.reduce((a, b) => a + b) / gc.length;
    }
    const adj = h2hAvg ? tg * 0.55 + h2hAvg * 0.45 : tg;
    const line = bo5 ? 38.5 : Math.round(adj) + 0.5;
    const oP = clamp(50 + (adj - line) * 9, 12, 88);
    mk.ou = { name: 'Over/Under Game', icon: '📊', line, pred: adj.toFixed(1), pick: oP >= 53 ? `Over ${line}` : oP <= 47 ? `Under ${line}` : 'Neutro', oP: oP.toFixed(0), uP: (100 - oP).toFixed(0), h2hAvg: h2hAvg ? h2hAvg.toFixed(1) : null };

    // Set Score
    const pw = C.p1 / 100;
    mk.sets = { name: 'Risultato Set', icon: '🎯', bo: bo5 ? 5 : 3, preds: bo5 ? bo5Scores(pw) : bo3Scores(pw) };

    return mk;
  }

  function bo3Scores(p) {
    const s = Math.pow(p, 0.82), q = 1 - s;
    const sc = [
      { s: '2-0', p: s * s, f: 'P1' }, { s: '2-1', p: 2 * s * q * s, f: 'P1' },
      { s: '0-2', p: q * q, f: 'P2' }, { s: '1-2', p: 2 * s * q * q, f: 'P2' },
    ];
    const t = sc.reduce((a, b) => a + b.p, 0);
    return sc.map(x => ({ ...x, p: ((x.p / t) * 100).toFixed(1) })).sort((a, b) => b.p - a.p);
  }

  function bo5Scores(p) {
    const s = Math.pow(p, 0.82), q = 1 - s;
    const sc = [
      { s: '3-0', p: s ** 3, f: 'P1' }, { s: '3-1', p: 3 * s ** 3 * q, f: 'P1' }, { s: '3-2', p: 6 * s ** 3 * q ** 2, f: 'P1' },
      { s: '0-3', p: q ** 3, f: 'P2' }, { s: '1-3', p: 3 * q ** 3 * s, f: 'P2' }, { s: '2-3', p: 6 * q ** 3 * s ** 2, f: 'P2' },
    ];
    const t = sc.reduce((a, b) => a + b.p, 0);
    return sc.map(x => ({ ...x, p: ((x.p / t) * 100).toFixed(1) })).sort((a, b) => b.p - a.p);
  }

  function dataQuality(M) {
    const a = Object.values(M).filter(m => m && m.conf > 0).length;
    if (a >= 6) return { l: 'HD', d: 'Alta Definizione', c: 'var(--accent)' };
    if (a >= 4) return { l: 'MD', d: 'Media Definizione', c: 'var(--gold)' };
    return { l: 'LD', d: 'Bassa Definizione', c: 'var(--lose)' };
  }

  // ═══════ UTILS ═══════
  function isWin(m, pk) {
    const isF = String(m.first_player_key) === String(pk);
    return (isF && m.event_winner === 'First Player') || (!isF && m.event_winner === 'Second Player');
  }

  function detectSurf(n) {
    n = n.toLowerCase();
    if (/roland.garros|french.open|rome|roma|madrid|monte.carlo|barcelona|rio|buenos.aires|lyon|hamburg|kitzbuhel|bastad|gstaad|umag|bucharest|marrakech|cordoba|estoril|geneva|parma|sardegna|cagliari|bois.le.duc/i.test(n)) return 'clay';
    if (/wimbledon|queen|halle|eastbourne|hertogenbosch|mallorca|stuttgart|nottingham|newport/i.test(n)) return 'grass';
    if (/paris.masters|paris.indoor|vienna|basel|stockholm|petersburg|moscow|sofia|metz|astana|marseille|dallas|montpellier/i.test(n)) return 'indoor';
    return 'hard';
  }

  function isSlam(n) { return /roland.garros|french.open|wimbledon|us.open|australian.open/i.test(n); }
  function clamp(v, mn, mx) { return Math.max(mn, Math.min(mx, v)); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ════════════════════════════════════════════════════════════
  //  RENDER: ANALYSIS MODAL
  // ════════════════════════════════════════════════════════════

  function renderAnalysis(match, A, h2h) {
    const { M, consensus: C, regression: R, trap: T, markets: MK, surf, bo5, dq } = A;
    const p1 = match.event_first_player, p2 = match.event_second_player;
    const fav = C.fav === 'P1' ? p1 : p2;

    return `
      <div class="analysis-header">
        <div class="analysis-tournament"><span class="surface-badge ${surf}">${surf.toUpperCase()}</span> ${match.tournament_name || ''} <span class="match-round">${match.tournament_round || match.event_type_type || ''}</span>${bo5 ? ' <span class="match-round" style="color:var(--gold)">Grand Slam Bo5</span>' : ''}</div>
        <div class="analysis-time">${match.event_time || 'TBD'}</div>
      </div>

      <div class="analysis-matchup">
        <div class="analysis-player ${C.fav === 'P1' ? 'favored' : ''}">
          <div class="analysis-player-name">${p1}</div>
          <div class="analysis-player-prob">${C.p1.toFixed(1)}%</div>
          ${M.form.s1 ? `<div class="analysis-player-streak">${M.form.s1}</div>` : ''}
        </div>
        <div class="analysis-vs"><div class="analysis-vs-label">VS</div><span class="data-quality-badge" style="color:${dq.c}">${dq.l}</span></div>
        <div class="analysis-player right ${C.fav === 'P2' ? 'favored' : ''}">
          <div class="analysis-player-name">${p2}</div>
          <div class="analysis-player-prob">${C.p2.toFixed(1)}%</div>
          ${M.form.s2 ? `<div class="analysis-player-streak">${M.form.s2}</div>` : ''}
        </div>
      </div>

      <div class="consensus-bar-container">
        <div class="consensus-bar"><div class="consensus-fill p1" style="width:${C.p1}%"></div><div class="consensus-fill p2" style="width:${C.p2}%"></div></div>
        <div class="consensus-labels"><span>${C.p1.toFixed(1)}%</span><span>${C.p2.toFixed(1)}%</span></div>
      </div>

      ${T.isTrap ? `<div class="trap-card"><div class="trap-header">🕵️ TRAP DETECTOR — ATTENZIONE</div>${T.flags.map(f => `<div class="trap-flag">${f}</div>`).join('')}</div>` : ''}

      <div class="regression-card tier-${R.tier}">
        <div class="regression-header"><span class="tier-badge ${R.tier}">${R.tier.toUpperCase()}</span><span class="regression-label">Regression Score</span><span class="regression-score">${R.sc}/100</span></div>
        <div class="regression-details">
          <div class="regression-item"><span>Consensus</span><span>${C.conf}%</span></div>
          <div class="regression-item"><span>Accordo</span><span>${R.agree}%</span></div>
          <div class="regression-item"><span>Confidenza</span><span>${R.avgC}%</span></div>
          <div class="regression-item"><span>Modelli</span><span>${C.active}/${C.total}</span></div>
          <div class="regression-item"><span>Rating</span><span>${'★'.repeat(R.stars)}${'☆'.repeat(5 - R.stars)}</span></div>
        </div>
        ${R.tier !== 'skip' ? `<div class="regression-pick">→ <strong>${fav}</strong> a ${(C.fav === 'P1' ? C.p1 : C.p2).toFixed(1)}%${M.odds.p1O ? ` @ ${(C.fav === 'P1' ? M.odds.p1O : M.odds.p2O)?.toFixed(2) || ''}` : ''}</div>` : ''}
      </div>

      <div class="section-divider"><span>🧠 8 Modelli Predittivi</span></div>
      <div class="models-grid">
        ${C.bd.map(b => { const mod = M[b.k]; return `<div class="model-card ${b.active ? '' : 'inactive'}"><div class="model-card-header"><span class="model-icon">${mod?.icon || '📊'}</span><span class="model-name">${b.name}</span>${b.active ? `<span class="model-confidence">${b.conf?.toFixed(0)}%</span>` : '<span class="model-inactive-label">N/D</span>'}</div>${b.active ? `<div class="model-bar"><div class="model-bar-fill" style="width:${b.p1}%;background:${b.p1 >= 50 ? 'var(--accent)' : 'var(--lose)'}"></div></div><div class="model-probs"><span class="${b.p1 >= 50 ? 'favored-prob' : ''}">${b.p1.toFixed(0)}%</span><span class="${b.p1 < 50 ? 'favored-prob' : ''}">${(100 - b.p1).toFixed(0)}%</span></div>` : ''}<div class="model-detail">${mod?.det || ''}</div></div>`; }).join('')}
      </div>

      <div class="section-divider"><span>🏆 Mercati</span></div>

      <div class="market-card">
        <div class="market-header"><span>${MK.winner.icon} ${MK.winner.name}</span></div>
        <div class="market-pick"><span class="market-pick-name">${MK.winner.pick}</span><span class="market-pick-prob">${MK.winner.prob}%</span></div>
        ${MK.winner.kelly ? `<div class="kelly-box">💰 Kelly: <strong>${MK.winner.kelly.quarter}%</strong> del bankroll (¼K) @ ${MK.winner.kelly.odds} | Full Kelly: ${MK.winner.kelly.fraction}%</div>` : ''}
      </div>

      <div class="market-card">
        <div class="market-header"><span>${MK.ou.icon} ${MK.ou.name}</span><span class="market-line">Linea: ${MK.ou.line}</span></div>
        <div class="market-ou-grid">
          <div class="market-ou-item ${+MK.ou.oP > 50 ? 'highlight' : ''}"><span class="market-ou-label">Over ${MK.ou.line}</span><span class="market-ou-prob">${MK.ou.oP}%</span></div>
          <div class="market-ou-item ${+MK.ou.uP > 50 ? 'highlight' : ''}"><span class="market-ou-label">Under ${MK.ou.line}</span><span class="market-ou-prob">${MK.ou.uP}%</span></div>
        </div>
        <div class="market-detail">Game previsti: <strong>${MK.ou.pred}</strong>${MK.ou.h2hAvg ? ` | Media H2H: <strong>${MK.ou.h2hAvg}</strong>` : ''}</div>
      </div>

      <div class="market-card">
        <div class="market-header"><span>${MK.sets.icon} ${MK.sets.name}</span><span class="market-line">Bo${MK.sets.bo}</span></div>
        <div class="set-score-grid">
          ${MK.sets.preds.map((x, i) => `<div class="set-score-item ${i === 0 ? 'top-pick' : ''}"><span class="set-score-value">${x.s}</span><div class="set-score-bar-bg"><div class="set-score-bar-fill" style="width:${x.p}%"></div></div><span class="set-score-prob">${x.p}%</span><span class="set-score-favored">${x.f === 'P1' ? p1.split(' ').pop() : p2.split(' ').pop()}</span></div>`).join('')}
        </div>
      </div>

      ${h2h && h2h.H2H && h2h.H2H.length ? `
        <div class="section-divider"><span>⚔️ Precedenti (${h2h.H2H.length})</span></div>
        <div class="h2h-mini-list">${h2h.H2H.slice(0, 6).map(m => { const sc = m.scores ? m.scores.map(s => `${s.score_first}-${s.score_second}`).join(' ') : m.event_final_result || ''; return `<div class="h2h-mini-row"><span class="h2h-mini-date">${m.event_date || ''}</span><span class="h2h-mini-player ${m.event_winner === 'First Player' ? 'winner' : ''}">${m.event_first_player}</span><span class="h2h-mini-score">${sc}</span><span class="h2h-mini-player right ${m.event_winner === 'Second Player' ? 'winner' : ''}">${m.event_second_player}</span></div>`; }).join('')}</div>` : ''}
    `;
  }

  // ════════════════════════════════════════════════════════════
  //  TOURNAMENT-GROUPED HOME VIEW
  // ════════════════════════════════════════════════════════════

  async function loadMatches() {
    const c = document.getElementById('tournamentsContainer');
    c.innerHTML = `<div class="loading-state"><div class="loading-spinner"></div><p>Caricamento tornei...</p></div>`;
    const date = dateStr(S.dateOff);
    const d = await api('fixtures', { date });
    if (d.success === 1 && d.result && d.result.length) { S.matches = d.result; renderTournaments(); }
    else { c.innerHTML = `<div class="empty-state"><div class="empty-icon">🎾</div><div class="empty-title">Nessuna partita per ${date}</div></div>`; }
  }

  function renderTournaments() {
    const c = document.getElementById('tournamentsContainer');
    let matches = [...S.matches];

    // Filter
    if (S.filter !== 'all') {
      matches = matches.filter(m => {
        const t = (m.event_type_type || '').toLowerCase();
        return S.filter === 'atp' ? t.includes('atp') : S.filter === 'wta' ? t.includes('wta') : S.filter === 'challenger' ? t.includes('challenger') : S.filter === 'itf' ? t.includes('itf') : true;
      });
    }

    // Group by tournament
    const grouped = {};
    matches.forEach(m => {
      const key = m.tournament_key || m.tournament_name || 'Altro';
      if (!grouped[key]) grouped[key] = { name: m.tournament_name || 'Torneo', type: m.event_type_type || '', key, matches: [] };
      grouped[key].matches.push(m);
    });

    // Sort alphabetically
    const tournaments = Object.values(grouped).sort((a, b) => a.name.localeCompare(b.name));

    if (!tournaments.length) {
      c.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-title">Nessun torneo con questo filtro</div></div>`;
      return;
    }

    c.innerHTML = tournaments.map(t => {
      const surf = detectSurf(t.name);
      const finished = t.matches.filter(m => m.event_status === 'Finished').length;
      const upcoming = t.matches.length - finished;
      const typeLabel = t.type.replace(/Singles|Doubles/gi, '').trim();

      return `
        <div class="tournament-card open" data-tk="${t.key}">
          <div class="tournament-header" onclick="this.parentElement.classList.toggle('open')">
            <div class="tournament-info">
              <span class="surface-badge ${surf}">${surf.toUpperCase()}</span>
              <span class="tournament-name">${t.name}</span>
              <span class="tournament-type">${typeLabel}</span>
            </div>
            <div class="tournament-meta">
              <span class="tournament-count">${t.matches.length} match${t.matches.length > 1 ? 'es' : ''}</span>
              ${upcoming > 0 ? `<span class="tournament-upcoming">${upcoming} da giocare</span>` : ''}
              <span class="tournament-arrow">▾</span>
            </div>
          </div>
          <div class="tournament-matches" id="tm-${t.key}">
            ${t.matches.sort((a, b) => {
              const af = a.event_status === 'Finished' ? 1 : 0, bf = b.event_status === 'Finished' ? 1 : 0;
              return af !== bf ? af - bf : (a.event_time || '').localeCompare(b.event_time || '');
            }).map(m => renderMatchRow(m)).join('')}
          </div>
        </div>`;
    }).join('');
  }


  function renderMatchRow(m) {
    const isF = m.event_status === 'Finished', isL = m.event_live === '1';
    let scoreHtml = '';
    if (m.scores && m.scores.length) {
      scoreHtml = m.scores.map(s => {
        const w = +s.score_first > +s.score_second;
        return `<span class="set-score-mini ${w ? 'won' : ''}">${s.score_first}-${s.score_second}</span>`;
      }).join(' ');
    }

    let status = '';
    if (isF) { const w = m.event_winner === 'First Player' ? m.event_first_player : m.event_second_player; status = `<span class="status-badge finished">✓</span>`; }
    else if (isL) { status = `<span class="status-badge live">LIVE</span>`; }
    else { status = `<span class="status-badge upcoming">${m.event_time || 'TBD'}</span>`; }

    const click = !isF ? `data-ek="${m.event_key}"` : '';
    const round = m.tournament_round ? m.tournament_round.replace(m.tournament_name || '', '').replace(/^\s*-\s*/, '').trim() : '';

    return `
      <div class="match-row ${!isF ? 'clickable' : ''} ${isL ? 'live' : ''}" ${click}>
        <div class="match-row-status">${status}</div>
        <div class="match-row-players">
          <span class="match-row-p ${m.event_winner === 'First Player' ? 'winner' : ''}">${m.event_first_player}</span>
          <span class="match-row-vs">vs</span>
          <span class="match-row-p ${m.event_winner === 'Second Player' ? 'winner' : ''}">${m.event_second_player}</span>
        </div>
        <div class="match-row-score">${scoreHtml}</div>
        <div class="match-row-round">${round}</div>
        ${!isF ? '<div class="match-row-cta">📊</div>' : ''}
      </div>`;
  }

  // ═══════ LIVE ═══════
  async function loadLive() {
    const c = document.getElementById('liveContainer');
    const d = await api('livescore');
    if (d.success === 1 && d.result && d.result.length) {
      S.live = d.result;
      document.getElementById('liveCount').textContent = d.result.length;
      document.getElementById('liveCount').style.display = 'inline';
      renderLive();
    } else {
      S.live = []; document.getElementById('liveCount').style.display = 'none';
      c.innerHTML = `<div class="empty-state"><div class="empty-icon">😴</div><div class="empty-title">Nessun match live</div></div>`;
    }
  }
  function renderLive() {
    const c = document.getElementById('liveContainer');
    let m = [...S.live];
    if (S.liveFilter !== 'all') m = m.filter(x => (x.event_type_type || '').toLowerCase().includes(S.liveFilter));
    if (!m.length) { c.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-title">Nessun match live</div></div>`; return; }
    c.innerHTML = m.map(x => {
      const sv = x.event_serve;
      let sH = ''; if (x.scores && x.scores.length) sH = `<div class="match-score">${x.scores.map(s => `<div class="set-score ${+s.score_first > +s.score_second ? 'won' : ''}">${s.score_first}-${s.score_second}</div>`).join('')}</div>`;
      const gs = x.event_game_result || '';
      return `<div class="match-card live"><div class="match-card-header"><span class="match-tournament"><span class="surface-badge ${detectSurf(x.tournament_name || '')}">${detectSurf(x.tournament_name || '').toUpperCase()}</span> ${x.tournament_name || ''}</span><span class="match-time live">● ${x.event_status || 'LIVE'}</span></div><div class="match-players"><div class="player"><span class="player-name">${sv === 'First Player' ? '🎾 ' : ''}${x.event_first_player}</span></div><div style="text-align:center">${sH}${gs && gs !== '-' ? `<div style="font-family:var(--font-mono);font-size:1rem;color:var(--gold);margin-top:6px;font-weight:700">${gs}</div>` : ''}</div><div class="player right"><span class="player-name">${sv === 'Second Player' ? '🎾 ' : ''}${x.event_second_player}</span></div></div></div>`;
    }).join('');
  }
  function startLive() { loadLive(); S.liveInt = setInterval(loadLive, CFG.LIVE_MS); }
  function stopLive() { if (S.liveInt) { clearInterval(S.liveInt); S.liveInt = null; } }

  // ═══════ H2H TAB ═══════
  async function loadH2H() {
    if (!S.h2hP1Key || !S.h2hP2Key) return;
    const c = document.getElementById('h2hResultContainer');
    c.innerHTML = `<div class="loading-state"><div class="loading-spinner"></div></div>`;
    const d = await getH2H(S.h2hP1Key, S.h2hP2Key);
    if (!d) { c.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><div class="empty-title">H2H non disponibile</div></div>`; return; }
    const h = d.H2H || []; let w1 = 0, w2 = 0;
    h.forEach(m => { if (m.event_winner === 'First Player') w1++; else if (m.event_winner === 'Second Player') w2++; });
    const n1 = document.getElementById('h2hPlayer1').value, n2 = document.getElementById('h2hPlayer2').value;
    c.innerHTML = `<div class="h2h-summary"><div class="h2h-player"><div class="h2h-player-name">${n1}</div><div class="h2h-player-wins">${w1}</div></div><div class="h2h-divider"><div class="h2h-vs-label">VS</div><div class="h2h-total">${h.length} match</div></div><div class="h2h-player"><div class="h2h-player-name">${n2}</div><div class="h2h-player-wins">${w2}</div></div></div>
    ${h.length ? `<div class="h2h-mini-list">${h.slice(0, 10).map(m => { const sc = m.scores ? m.scores.map(s => `${s.score_first}-${s.score_second}`).join(' ') : m.event_final_result || ''; return `<div class="h2h-mini-row"><span class="h2h-mini-date">${m.event_date || ''}</span><span class="h2h-mini-player ${m.event_winner === 'First Player' ? 'winner' : ''}">${m.event_first_player}</span><span class="h2h-mini-score">${sc}</span><span class="h2h-mini-player right ${m.event_winner === 'Second Player' ? 'winner' : ''}">${m.event_second_player}</span></div>`; }).join('')}</div>` : ''}`;
  }

  // ═══════ RANKINGS ═══════
  async function loadRankings() {
    const c = document.getElementById('rankingsContainer');
    c.innerHTML = `<div class="loading-state"><div class="loading-spinner"></div></div>`;
    const d = await api('standings', { etk: S.rankType === 'atp' ? CFG.EVENT.ATP : CFG.EVENT.WTA });
    if (d.success === 1 && d.result && d.result.length) {
      c.innerHTML = `<table class="rankings-table"><thead><tr><th>#</th><th>Giocatore</th><th>Punti</th></tr></thead><tbody>${d.result.slice(0, 100).map((p, i) => {
        const rk = p.place || i + 1, nm = p.player_name || p.team_name || '-', pt = p.points || p.team_points || '-';
        return `<tr><td><span class="rank-number ${rk <= 3 ? 'top-3' : ''}">${rk}</span></td><td>${nm}</td><td class="stat-mono">${pt}</td></tr>`;
      }).join('')}</tbody></table>`;
    } else c.innerHTML = `<div class="empty-state"><div class="empty-icon">🏆</div><div class="empty-title">Non disponibile</div></div>`;
  }

  return { init, openMatch, loadH2H, closeModal, switchTab };
})();

document.addEventListener('DOMContentLoaded', TP.init);
