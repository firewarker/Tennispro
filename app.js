/**
 * TennisPro v7.1 — Firebase + Advanced Engine v8
 * Predictions saved to Firebase on first generation, never recalculated
 */
const TP = (() => {
  const CFG = {
    W: 'https://tennispro.lucalagan.workers.dev',
    LIVE_MS: 30000,
    WTS: { elo: 0.13, surface: 0.11, form: 0.12, h2h: 0.09, clutch: 0.08, dominance: 0.07, serve: 0.08, fatigue: 0.06, odds: 0.13, smartMoney: 0.13 },
    GPS: { clay: 10.2, grass: 9.6, hard: 9.8, indoor: 9.7, unknown: 9.9 },
  };
  let S = {
    tab: 'matches', dOff: 0, flt: 'all', lFlt: 'all', rk: 'atp', lInt: null,
    matches: [], live: [], hc: {}, theodds: null,
    rankMap: {}, acc: { hit: 0, miss: 0, total: 0 }, topPicks: [],
    bankroll: JSON.parse(localStorage.getItem('tp_bankroll') || '{"capital":100,"bets":[]}'),
  };

  // ═══ FIREBASE HELPERS ═══
  function fbRef(path) { return DB.ref(path); }
  async function fbGet(path) { const snap = await fbRef(path).once('value'); return snap.val(); }
  async function fbSet(path, data) { await fbRef(path).set(data); }

  // Save prediction to Firebase (only if not exists)
  async function savePrediction(date, ek, pred) {
    const existing = await fbGet(`predictions/${date}/${ek}`);
    if (existing) return existing; // Already saved, return existing
    const toSave = {
      fav: pred.fav, favName: pred.favName, prob: pred.prob, tier: pred.tier, score: pred.score,
      ou: pred.ou, firstSet: pred.firstSet, handicap: pred.handicap, sets: pred.sets,
      timestamp: Date.now(),
    };
    await fbSet(`predictions/${date}/${ek}`, toSave);
    document.getElementById('apiStatus').textContent = '● DB ✓';
    document.getElementById('apiStatus').style.color = '#34d399';
    return toSave;
  }

  // Load prediction from Firebase
  async function loadPrediction(date, ek) {
    return await fbGet(`predictions/${date}/${ek}`);
  }

  // Save match result verification
  async function saveResult(date, ek, result) {
    await fbSet(`results/${date}/${ek}`, result);
  }

  // ═══ INIT ═══
  function init() {
    document.getElementById('headerDate').textContent = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    document.querySelectorAll('.nav-tab').forEach(t => t.addEventListener('click', () => swTab(t.dataset.tab)));
    document.querySelectorAll('.date-btn').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('.date-btn').forEach(x => x.classList.remove('active')); b.classList.add('active'); S.dOff = +b.dataset.offset; loadMatches(); }));
    document.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('[data-filter]').forEach(x => x.classList.remove('active')); b.classList.add('active'); S.flt = b.dataset.filter; renderHome(); }));
    document.querySelectorAll('[data-live-filter]').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('[data-live-filter]').forEach(x => x.classList.remove('active')); b.classList.add('active'); S.lFlt = b.dataset.liveFilter; renderLive(); }));
    document.querySelectorAll('[data-ranking]').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('[data-ranking]').forEach(x => x.classList.remove('active')); b.classList.add('active'); S.rk = b.dataset.ranking; loadRank(); }));
    document.getElementById('tournamentsContainer').addEventListener('click', e => { const r = e.target.closest('.match-row[data-ek]'); if (r) openMatch(r.dataset.ek); });
    loadRankingsCache();
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
      switch (m) { case 'fix': path = `fixtures/${p.date || ds()}`; break; case 'live': path = 'livescore'; break; case 'h2h': path = 'h2h'; q.set('p1', p.p1); q.set('p2', p.p2); break; case 'stand': path = 'standings'; if (p.etk) q.set('event_type_key', p.etk); break; case 'odds': path = 'odds'; if (p.mk) q.set('match_key', p.mk); break; }
      const qs = q.toString(); return await (await fetch(`${CFG.W}/${path}${qs ? '?' + qs : ''}`)).json();
    } catch (e) { return { success: 0, result: [] }; }
  }
  async function gh(p1, p2) { const k = `${p1}_${p2}`; if (S.hc[k]) return S.hc[k]; const d = await api('h2h', { p1, p2 }); if (d.success === 1 && d.result) { S.hc[k] = d.result; return d.result; } return null; }

  // ═══ THE ODDS API + RANKINGS ═══
  async function loadTheOdds() { try { const r = await fetch(`${CFG.W}/theodds/all?regions=eu`); const d = await r.json(); if (d.success === 1) S.theodds = d.odds; } catch (e) {} }
  function normN(n) { return n.toLowerCase().replace(/[^a-z]/g, ''); }
  function mSc(a, b) { const sa = a.split(' ').pop().toLowerCase(), sb = b.split(' ').pop().toLowerCase(); return sa === sb ? 80 : (sa.includes(sb) || sb.includes(sa)) ? 60 : 0; }
  function findTO(p1, p2) {
    if (!S.theodds) return null; let best = null, bs = 0;
    for (const m of S.theodds) { const s1 = Math.max(mSc(p1, m.home_team), mSc(p1, m.away_team)); const s2 = Math.max(mSc(p2, m.home_team), mSc(p2, m.away_team)); if (s1 + s2 > bs && s1 >= 60 && s2 >= 60) { bs = s1 + s2; best = m; } }
    if (!best) return null;
    const bks = []; let bH = null, bT = null;
    for (const bk of (best.bookmakers || [])) for (const mk of (bk.markets || [])) {
      if (mk.key === 'h2h' && mk.outcomes) { const o = {}; mk.outcomes.forEach(oc => { if (mSc(p1, oc.name) >= 60) o.p1 = oc.price; else o.p2 = oc.price; }); if (o.p1 && o.p2) { bks.push({ name: bk.title || bk.key, p1: o.p1, p2: o.p2 }); if (!bH) bH = o; } }
      if (mk.key === 'totals' && mk.outcomes) { const t = {}; mk.outcomes.forEach(oc => { if (oc.name === 'Over') { t.over = oc.price; t.line = oc.point; } if (oc.name === 'Under') { t.under = oc.price; t.line = oc.point; } }); if (t.over && t.under && !bT) bT = t; }
    }
    return { bookmakers: bks, h2h: bH, totals: bT, count: bks.length };
  }

  async function loadRankingsCache() {
    try {
      const [atp, wta] = await Promise.all([api('stand', { etk: '265' }), api('stand', { etk: '266' })]);
      if (atp.success === 1 && atp.result) atp.result.forEach(p => { const n = p.player_name || p.team_name || ''; if (n) S.rankMap[normN(n)] = +(p.place || 999); });
      if (wta.success === 1 && wta.result) wta.result.forEach(p => { const n = p.player_name || p.team_name || ''; if (n) S.rankMap[normN(n)] = +(p.place || 999); });
    } catch (e) {}
  }
  function getRank(name) { const k = normN(name); if (S.rankMap[k]) return S.rankMap[k]; const sn = normN(name.split(' ').pop()); for (const [x, v] of Object.entries(S.rankMap)) { if (x.endsWith(sn) || x.includes(sn)) return v; } return null; }

  // ═══ OPEN MATCH — WITH FIREBASE ═══
  async function openMatch(ek) {
    const match = S.matches.find(m => String(m.event_key) === String(ek));
    if (!match) return;
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById('tab-analysis').classList.add('active');
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    window.scrollTo(0, 0);
    const pg = document.getElementById('analysisPage');
    pg.innerHTML = `<div class="loading-state"><div class="loading-spinner"></div><p>🧠 Analisi in corso...</p></div>`;

    const date = match.event_date || ds(S.dOff);
    const h2h = await gh(match.first_player_key, match.second_player_key);
    const td = findTO(match.event_first_player, match.event_second_player);

    // Check Firebase for saved prediction
    let saved = await loadPrediction(date, ek);
    const A = runEngine(match, h2h, td);

    if (!saved && match.event_status !== 'Finished') {
      // First time — save to Firebase
      saved = await savePrediction(date, ek, {
        fav: A.C.fav, favName: A.C.fav === 'P1' ? match.event_first_player : match.event_second_player,
        prob: +(A.C.fav === 'P1' ? A.C.p1 : A.C.p2).toFixed(1),
        tier: A.R.tier, score: A.R.sc,
        ou: A.MK.ou, firstSet: A.MK.firstSet, handicap: A.MK.handicap,
        sets: A.MK.sets.preds.slice(0, 4).map(x => ({ s: x.s, p: x.p, f: x.f })),
      });
    }

    // Use saved prediction if available (prevents changes)
    const pred = saved || {
      fav: A.C.fav, favName: A.C.fav === 'P1' ? match.event_first_player : match.event_second_player,
      prob: +(A.C.fav === 'P1' ? A.C.p1 : A.C.p2).toFixed(1),
      tier: A.R.tier, score: A.R.sc,
      ou: A.MK.ou, firstSet: A.MK.firstSet, handicap: A.MK.handicap,
      sets: A.MK.sets.preds.slice(0, 4).map(x => ({ s: x.s, p: x.p, f: x.f })),
    };

    // Verify result for finished matches
    let V = null;
    if (match.event_status === 'Finished' && match.event_winner) {
      const predWinner = pred.fav === 'P1' ? 'First Player' : 'Second Player';
      const tg = (match.scores || []).reduce((s, sc) => s + (+sc.score_first || 0) + (+sc.score_second || 0), 0);
      const as = (match.scores || []).reduce((a, sc) => { if (+sc.score_first > +sc.score_second) a.p1++; else a.p2++; return a; }, { p1: 0, p2: 0 });
      V = {
        hit: match.event_winner === predWinner,
        actualName: match.event_winner === 'First Player' ? match.event_first_player : match.event_second_player,
        totalGames: tg, setScore: `${as.p1}-${as.p2}`,
        ouHit: pred.ou ? (pred.ou.pick.includes('Over') ? tg > pred.ou.line : pred.ou.pick.includes('Under') ? tg < pred.ou.line : null) : null,
        setHit: pred.sets && pred.sets[0] ? pred.sets[0].s === `${as.p1}-${as.p2}` : false,
      };
      saveResult(date, ek, V);
    }

    pg.innerHTML = renderPage(match, A, pred, V, h2h);
    window.scrollTo(0, 0);
  }

  // ══════════════════════════════════════════
  //  🧠 ENGINE (same as v6 but cleaner)
  // ══════════════════════════════════════════
  // ══════════════════════════════════════════════════════════════
  //  🧠 ENGINE v8 — Advanced Stats from Score Data
  //  Tournament-Weighted Elo, Match Stats, Tiebreak, Momentum
  // ══════════════════════════════════════════════════════════════

  // ═══ MATCH STATS EXTRACTOR — derive stats from set scores ═══
  function extractStats(results, pk) {
    const clean = cleanResults(results);
    let totalSetsWon = 0, totalSetsLost = 0, totalGamesWon = 0, totalGamesLost = 0;
    let tiebreakWon = 0, tiebreakTotal = 0, decisiveSetsWon = 0, decisiveSetsTotal = 0;
    let straightSetWins = 0, totalWins = 0, matchCount = 0;
    let setsPlayed = 0, holdRate = 0, holdSets = 0;
    let oppQuality = []; // track opponent ranking when available

    clean.slice(0, 15).forEach((m, mi) => {
      if (!m.scores || !m.scores.length) return;
      matchCount++;
      const isP1 = String(m.first_player_key) === String(pk);
      const won = iW(m, pk);
      if (won === true) totalWins++;

      let setsW = 0, setsL = 0;
      m.scores.forEach(s => {
        const gw = +(isP1 ? s.score_first : s.score_second) || 0;
        const gl = +(isP1 ? s.score_second : s.score_first) || 0;
        totalGamesWon += gw; totalGamesLost += gl;
        setsPlayed++;

        // Set won/lost
        if (gw > gl) { setsW++; totalSetsWon++; } else { setsL++; totalSetsLost++; }

        // Tiebreak detection (7-6 or 6-7)
        if ((gw === 7 && gl === 6) || (gw === 6 && gl === 7)) {
          tiebreakTotal++;
          if (gw > gl) tiebreakWon++;
        }

        // Serve hold estimation: in a normal set, each player serves ~equal games
        // If player won 6 games in a 6-4 set, they likely held most serves + broke once
        if (gw + gl >= 6) {
          const totalGames = gw + gl;
          const serveGames = Math.ceil(totalGames / 2); // approx serve games
          const expectedHolds = Math.round(gw * serveGames / totalGames);
          holdRate += expectedHolds / Math.max(serveGames, 1);
          holdSets++;
        }
      });

      // Decisive set: 3rd set in Bo3, 5th set in Bo5
      const totalSets = m.scores.length;
      if (totalSets >= 3 && (totalSets === 3 || totalSets === 5)) {
        const lastSet = m.scores[totalSets - 1];
        const lwon = +(isP1 ? lastSet.score_first : lastSet.score_second) || 0;
        const llost = +(isP1 ? lastSet.score_second : lastSet.score_first) || 0;
        if (setsW > 0 && setsL > 0) { // it was a close match
          decisiveSetsTotal++;
          if (lwon > llost) decisiveSetsWon++;
        }
      }

      // Straight set detection
      if (won && setsL === 0) straightSetWins++;

      // Opponent quality (check if opponent has a rank)
      const oppName = isP1 ? (m.event_second_player || '') : (m.event_first_player || '');
      const oppRank = getRank(oppName);
      if (oppRank && mi < 8) oppQuality.push(oppRank);
    });

    return {
      matchCount, totalWins, straightSetWins,
      setsWon: totalSetsWon, setsLost: totalSetsLost,
      gamesWon: totalGamesWon, gamesLost: totalGamesLost,
      tiebreakWon, tiebreakTotal,
      decisiveSetsWon, decisiveSetsTotal,
      holdRate: holdSets > 0 ? holdRate / holdSets : 0.5,
      holdSets, setsPlayed,
      avgOppRank: oppQuality.length > 0 ? oppQuality.reduce((a, b) => a + b) / oppQuality.length : null,
      oppCount: oppQuality.length,
    };
  }

  // Tournament level multiplier for Elo K-factor
  function tournamentLevel(name) {
    const n = (name || '').toLowerCase();
    if (/grand.slam|roland.garros|french.open|wimbledon|us.open|australian.open/i.test(n)) return 2.0;
    if (/masters|monte.carlo|madrid|rome|roma|indian.wells|miami|shanghai|canada|cincinnati|paris.masters/i.test(n)) return 1.5;
    if (/atp.500|500|queen|halle|barcelona|hamburg|vienna|beijing|tokyo/i.test(n)) return 1.2;
    if (/atp.250|250/i.test(n)) return 1.0;
    if (/challenger/i.test(n)) return 0.7;
    if (/itf|futures/i.test(n)) return 0.5;
    return 0.9;
  }

  function runEngine(match, h2h, td) {
    const sf = dSurf(match.tournament_name || ''), bo5 = isSl(match.tournament_name || '');
    const rd = match.tournament_round || '';
    // Extract advanced stats for both players
    const stats1 = h2h ? extractStats(h2h.firstPlayerResults || [], match.first_player_key) : null;
    const stats2 = h2h ? extractStats(h2h.secondPlayerResults || [], match.second_player_key) : null;
    const M = {};
    M.elo = mEloAdv(h2h, match);        // Tournament-weighted Elo
    M.surface = mSurfM(h2h, match, sf);  // Same but with clean results
    M.form = mFormAdv(h2h, match);       // Exponential decay + momentum
    M.h2h = mH2H(h2h, match);           // Same but retirement-safe
    M.clutch = mClutch(stats1, stats2);  // Tiebreak + Decisive sets
    M.dominance = mDomAdv(stats1, stats2); // Game margin + straight sets
    M.serve = mSrvAdv(stats1, stats2);   // Improved from match stats
    M.fatigue = mFat(h2h, match, rd);    // With round pressure
    M.odds = td && td.h2h ? mOddsTD(td) : { name: 'Quote', icon: '💰', p1: 50, conf: 0, det: 'N/D', p1O: null, p2O: null, bks: [] };
    M.smartMoney = td && td.bookmakers && td.bookmakers.length >= 2 ? mSmartTD(td, M) : { name: 'Smart Money', icon: '🧠', p1: 50, conf: 0, det: 'N/D', signal: null };
    // Inject real rankings
    const r1 = getRank(match.event_first_player), r2 = getRank(match.event_second_player);
    if (r1 && r2) { const rdiff = r2 - r1; const rp = cl(50 + rdiff * 0.3, 10, 90); if (M.elo.conf > 0) { M.elo.p1 = M.elo.p1 * 0.7 + rp * 0.3; M.elo.conf = Math.min(M.elo.conf + 20, 100); } else { M.elo.p1 = rp; M.elo.conf = Math.min(Math.abs(rdiff) * 1.5, 80); } M.elo.det += ` #${r1} vs #${r2}`; }
    // Qualification discount
    const isQual = isQualMatch(match);
    if (isQual) { Object.values(M).forEach(m => { if (m.conf > 0) m.conf = Math.round(m.conf * 0.75); }); }
    const C = calcC(M);
    const rw = roundWeight(rd);
    const R = calcR(M, C, rw);
    const T = calcT(M, C);
    const MK = calcMK(C, match, h2h, sf, bo5, M.odds, td);
    return { M, C, R, T, MK, sf, bo5, dq: dQ(M), r1, r2, isQual, round: rd, rw, stats1, stats2 };
  }

  // ═══ MODEL 1: Tournament-Weighted Elo ═══
  function mEloAdv(h, m) {
    const r = { name: 'Elo + Ranking', icon: '📐', p1: 50, conf: 0, det: '' };
    if (!h) return r;
    const a = cleanResults(h.firstPlayerResults), b = cleanResults(h.secondPlayerResults);
    if (a.length < 2 && b.length < 2) return r;
    let e1 = 1500, e2 = 1500;
    a.slice(0, 15).reverse().forEach(x => {
      const w = iW(x, m.first_player_key); if (w === null) return;
      const K = 32 * tournamentLevel(x.tournament_name || '');
      e1 += K * ((w ? 1 : 0) - 1 / (1 + Math.pow(10, (1500 - e1) / 400)));
    });
    b.slice(0, 15).reverse().forEach(x => {
      const w = iW(x, m.second_player_key); if (w === null) return;
      const K = 32 * tournamentLevel(x.tournament_name || '');
      e2 += K * ((w ? 1 : 0) - 1 / (1 + Math.pow(10, (1500 - e2) / 400)));
    });
    const d = e1 - e2;
    r.p1 = cl(1 / (1 + Math.pow(10, -d / 400)) * 100, 5, 95);
    r.conf = Math.min(Math.abs(d) / 2, 100);
    r.det = `Elo ${e1.toFixed(0)} vs ${e2.toFixed(0)}`;
    return r;
  }

  // ═══ MODEL 2: Surface (unchanged but with cleanResults) ═══
  function mSurfM(h, m, sf) { const r = { name: 'Superficie', icon: '🏟️', p1: 50, conf: 0, det: '' }; if (!h || sf === 'unknown') return r; const s1 = swCl(cleanResults(h.firstPlayerResults), m.first_player_key, sf), s2 = swCl(cleanResults(h.secondPlayerResults), m.second_player_key, sf); const r1 = s1.w / Math.max(s1.t, 1), r2 = s2.w / Math.max(s2.t, 1); r.p1 = cl(50 + (r1 - r2) * 55, 8, 92); r.conf = Math.min((s1.t + s2.t) * 7, 100); r.det = `${(r1 * 100).toFixed(0)}% vs ${(r2 * 100).toFixed(0)}%`; return r; }
  function swCl(res, pk, sf) { let w = 0, t = 0; res.slice(0, 15).forEach(m => { const won = iW(m, pk); if (won === null) return; if (dSurf(m.tournament_name || '') === sf) { t++; if (won) w++; } }); return { w, t }; }

  // ═══ MODEL 3: Form — Exponential Decay + Momentum ═══
  function mFormAdv(h, m) {
    const r = { name: 'Forma', icon: '🔥', p1: 50, conf: 0, det: '', s1: '', s2: '' };
    if (!h) return r;
    const f1 = formExp(cleanResults(h.firstPlayerResults), m.first_player_key, m.event_date);
    const f2 = formExp(cleanResults(h.secondPlayerResults), m.second_player_key, m.event_date);
    r.p1 = cl(50 + (f1.sc - f2.sc) * 32, 6, 94);
    r.conf = Math.min((f1.n + f2.n) * 8, 100);
    r.det = `${(f1.sc * 100).toFixed(0)}% vs ${(f2.sc * 100).toFixed(0)}%`;
    r.s1 = f1.str; r.s2 = f2.str;
    return r;
  }
  function formExp(res, pk, matchDate) {
    const l = res.slice(0, 10);
    if (!l.length) return { sc: 0.5, str: '-', n: 0 };
    const now = new Date(matchDate || new Date());
    let ws = 0, wt = 0, sk = 0, st = null;
    l.forEach(m => {
      const won = iW(m, pk); if (won === null) return;
      // Exponential decay based on days ago
      const daysAgo = Math.max(0, Math.floor((now - new Date(m.event_date || now)) / 86400000));
      const decay = Math.exp(-daysAgo / 30); // Half-life ~21 days
      // Tournament weight bonus
      const tw = tournamentLevel(m.tournament_name || '') * 0.3 + 0.7;
      const weight = decay * tw;
      ws += won ? weight : 0;
      wt += weight;
      if (st === null) { st = won; sk = 1; } else if (won === st) sk++;
    });
    return { sc: wt > 0 ? ws / wt : 0.5, str: st === true ? `${sk}W🟢` : st === false ? `${sk}L🔴` : '-', n: l.length };
  }

  // ═══ MODEL 4: H2H (retirement-safe) ═══
  function mH2H(h, m) { const r = { name: 'H2H', icon: '⚔️', p1: 50, conf: 0, det: '', w1: 0, w2: 0 }; if (!h || !h.H2H || !h.H2H.length) return r; let w1 = 0, w2 = 0; h.H2H.filter(x => !isRet(x)).forEach(x => { const won = iW(x, m.first_player_key); if (won === true) w1++; else if (won === false) w2++; }); const tot = w1 + w2; if (!tot) return r; r.p1 = cl((w1 / tot) * 100, 8, 92); r.conf = Math.min(tot * 18, 100); r.det = `${w1}-${w2}`; r.w1 = w1; r.w2 = w2; return r; }

  // ═══ MODEL 5: Clutch — Tiebreak + Decisive Sets ═══ (replaces Dominance)
  function mClutch(s1, s2) {
    const r = { name: 'Clutch', icon: '🧊', p1: 50, conf: 0, det: '' };
    if (!s1 || !s2) return r;
    // Tiebreak win rate
    const tb1 = s1.tiebreakTotal > 0 ? s1.tiebreakWon / s1.tiebreakTotal : 0.5;
    const tb2 = s2.tiebreakTotal > 0 ? s2.tiebreakWon / s2.tiebreakTotal : 0.5;
    // Decisive set win rate
    const ds1 = s1.decisiveSetsTotal > 0 ? s1.decisiveSetsWon / s1.decisiveSetsTotal : 0.5;
    const ds2 = s2.decisiveSetsTotal > 0 ? s2.decisiveSetsWon / s2.decisiveSetsTotal : 0.5;
    // Blend: 55% tiebreak, 45% decisive sets
    const c1 = tb1 * 0.55 + ds1 * 0.45;
    const c2 = tb2 * 0.55 + ds2 * 0.45;
    const totalData = s1.tiebreakTotal + s2.tiebreakTotal + s1.decisiveSetsTotal + s2.decisiveSetsTotal;
    r.p1 = cl(50 + (c1 - c2) * 45, 10, 90);
    r.conf = cl(totalData * 10, 0, 85);
    r.det = `TB ${s1.tiebreakWon}/${s1.tiebreakTotal} vs ${s2.tiebreakWon}/${s2.tiebreakTotal}`;
    return r;
  }

  // ═══ MODEL 6: Dominance — Game margin + Straight sets ═══
  function mDomAdv(s1, s2) {
    const r = { name: 'Dominio', icon: '💪', p1: 50, conf: 0, det: '' };
    if (!s1 || !s2 || !s1.matchCount || !s2.matchCount) return r;
    // Game margin: how many more games you win than lose
    const gm1 = (s1.gamesWon - s1.gamesLost) / Math.max(s1.setsPlayed, 1);
    const gm2 = (s2.gamesWon - s2.gamesLost) / Math.max(s2.setsPlayed, 1);
    // Straight set win rate (among wins)
    const ss1 = s1.totalWins > 0 ? s1.straightSetWins / s1.totalWins : 0;
    const ss2 = s2.totalWins > 0 ? s2.straightSetWins / s2.totalWins : 0;
    // Set win ratio
    const sr1 = s1.setsWon / Math.max(s1.setsWon + s1.setsLost, 1);
    const sr2 = s2.setsWon / Math.max(s2.setsWon + s2.setsLost, 1);
    // Blend: 40% game margin, 30% straight set rate, 30% set win ratio
    const d1 = (gm1 / 3) * 0.4 + ss1 * 0.3 + sr1 * 0.3;
    const d2 = (gm2 / 3) * 0.4 + ss2 * 0.3 + sr2 * 0.3;
    r.p1 = cl(50 + (d1 - d2) * 50, 10, 90);
    r.conf = cl((s1.matchCount + s2.matchCount) * 5, 0, 85);
    r.det = `Mg ${gm1 > 0 ? '+' : ''}${gm1.toFixed(1)} vs ${gm2 > 0 ? '+' : ''}${gm2.toFixed(1)}`;
    return r;
  }

  // ═══ MODEL 7: Serve — Advanced from match stats ═══
  function mSrvAdv(s1, s2) {
    const r = { name: 'Servizio', icon: '🎯', p1: 50, conf: 0, det: '' };
    if (!s1 || !s2 || !s1.holdSets || !s2.holdSets) return r;
    // Serve hold rate from extracted stats
    const h1 = s1.holdRate, h2 = s2.holdRate;
    // Game win ratio (games won / total games)
    const gwr1 = s1.gamesWon / Math.max(s1.gamesWon + s1.gamesLost, 1);
    const gwr2 = s2.gamesWon / Math.max(s2.gamesWon + s2.gamesLost, 1);
    // Blend hold rate (60%) + game win ratio (40%)
    const srv1 = h1 * 0.6 + gwr1 * 0.4;
    const srv2 = h2 * 0.6 + gwr2 * 0.4;
    r.p1 = cl(50 + (srv1 - srv2) * 55, 10, 90);
    r.conf = cl((s1.holdSets + s2.holdSets) * 5, 0, 90);
    r.det = `Hold ${(h1 * 100).toFixed(0)}% vs ${(h2 * 100).toFixed(0)}%`;
    return r;
  }

  // ═══ MODEL 7: Fatigue (with round pressure) ═══
  function mFat(h, m, round) { const r = { name: 'Fatica', icon: '🔋', p1: 50, conf: 0, det: '' }; if (!h) return r; const rp = roundPressure(round); const f1 = cfat(h.firstPlayerResults || [], m.event_date, rp), f2 = cfat(h.secondPlayerResults || [], m.event_date, rp); r.p1 = cl(50 + (f2.sc - f1.sc) * 8, 20, 80); r.conf = Math.min((f1.m + f2.m) * 10 + (rp > 0 ? 15 : 0), 80); r.det = `${f1.lb} vs ${f2.lb}${rp > 0 ? ' | ' + round.replace(/.*-\s*/, '').trim() : ''}`; return r; }
  function cfat(res, md, roundPr) { const t = new Date(md || new Date()); let m7 = 0, m3 = 0; res.slice(0, 10).forEach(m => { if (!m.event_date) return; const da = Math.floor((t - new Date(m.event_date)) / 86400000); if (da >= 0 && da <= 7) m7++; if (da >= 0 && da <= 3) m3++; }); const sc = m3 * 2 + m7 * 0.5 + (roundPr || 0); return { sc, m: m7, lb: sc >= 6 ? '🔴Stanco' : sc >= 3 ? '🟡Norm' : '🟢Fresco' }; }

  // ═══ MODEL 8 + 9: Odds + Smart Money (unchanged) ═══
  function mOddsTD(td) { const r = { name: 'Quote', icon: '💰', p1: 50, conf: 0, det: '', p1O: null, p2O: null, bks: [] }; r.p1O = td.h2h.p1; r.p2O = td.h2h.p2; r.bks = td.bookmakers || []; const i1 = 1 / td.h2h.p1, i2 = 1 / td.h2h.p2; r.p1 = (i1 / (i1 + i2)) * 100; r.conf = cl((i1 + i2 - 1) * 200 + 40, 20, 95); r.det = `${td.h2h.p1.toFixed(2)} / ${td.h2h.p2.toFixed(2)} (${td.count} book)`; return r; }
  function mSmartTD(td, M) { const r = { name: 'Smart Money', icon: '🧠', p1: 50, conf: 0, det: '', signal: null }; const ps = td.bookmakers.map(b => (1 / b.p1) / (1 / b.p1 + 1 / b.p2) * 100); const avg = ps.reduce((a, b) => a + b) / ps.length; const sp = Math.max(...ps) - Math.min(...ps); r.p1 = cl(avg, 8, 92); r.conf = cl(90 - sp * 2.5, 15, 92); const of = M.elo.p1 >= 50 ? 'P1' : 'P2'; const mf = avg >= 50 ? 'P1' : 'P2'; r.signal = of === mf && sp < 6 ? 'CONFERMA' : of !== mf ? 'DIVERGENZA' : 'NEUTRO'; r.det = `${td.count} book, spread ${sp.toFixed(1)}%`; return r; }

  // Consensus + Regression + Trap
  function calcC(M) { let ws = 0, wt = 0, ac = 0; const bd = []; Object.entries(CFG.WTS).forEach(([k, w]) => { const m = M[k]; if (!m || m.conf === 0) { bd.push({ k, name: m?.name || k, p1: 50, active: false }); return; } const ew = w * (m.conf / 100); ws += m.p1 * ew; wt += ew; ac++; bd.push({ k, name: m.name, icon: m.icon, p1: m.p1, w: ew, conf: m.conf, active: true }); }); const cp = wt > 0 ? ws / wt : 50; return { p1: cl(cp, 2, 98), p2: cl(100 - cp, 2, 98), conf: (Math.abs(cp - 50) * 2).toFixed(0), fav: cp >= 50 ? 'P1' : 'P2', ac, total: 10, bd }; }
  function calcR(M, C, rw) { const ag = mAg(M); const ac = C.bd.filter(b => b.active).reduce((s, b) => s + (b.conf || 0), 0) / Math.max(C.ac, 1); let sc = +C.conf * 0.35 + ag * 0.35 + ac * 0.30; sc = cl(sc * (rw || 1), 0, 100); return { sc: sc.toFixed(1), tier: sc >= 72 ? 'gold' : sc >= 52 ? 'silver' : sc >= 32 ? 'bronze' : 'skip', stars: sc >= 82 ? 5 : sc >= 67 ? 4 : sc >= 52 ? 3 : sc >= 37 ? 2 : 1, ag: ag.toFixed(0), ac: ac.toFixed(0) }; }
  function mAg(M) { const p = Object.values(M).filter(m => m && m.conf > 0).map(m => m.p1 >= 50 ? 'P1' : 'P2'); if (!p.length) return 0; return (Math.max(p.filter(x => x === 'P1').length, p.filter(x => x === 'P2').length) / p.length) * 100; }
  function calcT(M, C) { const f = []; if (M.odds.conf > 0 && Math.abs(M.odds.p1 - C.p1) > 18) f.push('Quote vs consensus divergono'); if (M.form.conf > 0 && M.h2h.conf > 0 && (M.form.p1 >= 50 ? 'P1' : 'P2') !== (M.h2h.p1 >= 50 ? 'P1' : 'P2')) f.push('Forma e H2H discordano'); if (M.fatigue.conf > 0 && Math.abs(M.fatigue.p1 - 50) > 15 && (M.fatigue.p1 > 50 ? 'P2' : 'P1') === C.fav) f.push('Favorito stanco'); if (mAg(M) < 65 && +C.conf > 40) f.push('Modelli divisi'); if (M.smartMoney.signal === 'DIVERGENZA') f.push('Smart Money diverge'); return { is: f.length >= 2, sc: Math.min(f.length * 18 + 10, 100), fl: f }; }

  // Markets
  function calcMK(C, m, h, sf, b5, oM, td) {
    const mk = {}; const fn = C.fav === 'P1' ? m.event_first_player : m.event_second_player; const pr = C.fav === 'P1' ? C.p1 : C.p2;
    let kelly = null; const fo = C.fav === 'P1' ? oM.p1O : oM.p2O;
    if (fo && fo > 1) { const p = pr / 100, b = fo - 1, kf = (b * p - (1 - p)) / b; if (kf > 0) kelly = { f: (kf * 100).toFixed(1), q: (kf * 25).toFixed(1), o: fo.toFixed(2) }; }
    mk.winner = { pick: fn, prob: pr.toFixed(1), vs: C.fav === 'P1' ? m.event_second_player : m.event_first_player, kelly, tier: +C.conf >= 60 ? 'Alta' : +C.conf >= 35 ? 'Media' : 'Bassa' };
    // O/U
    const sets = b5 ? 3.2 : 2.3, avg = CFG.GPS[sf] || 9.9, close = 1 - Math.abs(C.p1 - 50) / 50;
    let tg = sets * avg + close * 3.5, ha = null;
    if (h && h.H2H) { const gc = h.H2H.slice(0, 5).map(x => x.scores ? x.scores.reduce((s, sc) => s + (+sc.score_first || 0) + (+sc.score_second || 0), 0) : null).filter(Boolean); if (gc.length) ha = gc.reduce((a, b) => a + b) / gc.length; }
    const adj = ha ? tg * 0.55 + ha * 0.45 : tg;
    const line = td && td.totals ? td.totals.line : (b5 ? 38.5 : Math.round(adj) + 0.5);
    const oP = cl(50 + (adj - line) * 9, 12, 88);
    mk.ou = { line, pred: adj.toFixed(1), pick: oP >= 53 ? `Over ${line}` : oP <= 47 ? `Under ${line}` : 'Neutro', prob: (oP >= 53 ? oP : 100 - oP).toFixed(0), oP: oP.toFixed(0), uP: (100 - oP).toFixed(0), ha: ha ? ha.toFixed(1) : null };
    // Sets
    const pw = C.p1 / 100; mk.sets = { bo: b5 ? 5 : 3, preds: b5 ? b5S(pw) : b3S(pw) };
    // First Set
    const fsa = pw * 0.85 + 0.075;
    mk.firstSet = { pick: fsa >= 0.5 ? m.event_first_player : m.event_second_player, prob: (Math.max(fsa, 1 - fsa) * 100).toFixed(0) };
    // Handicap
    const sp = mk.sets.preds.filter(x => x.f === C.fav && (x.s === '2-0' || x.s === '3-0')).reduce((s, x) => s + +x.p, 0);
    mk.handicap = { favMinus: { label: `${fn} -1.5`, prob: sp.toFixed(0) }, undPlus: { label: `${mk.winner.vs} +1.5`, prob: (100 - sp).toFixed(0) } };
    return mk;
  }
  function b3S(p) { const s = Math.pow(p, 0.82), q = 1 - s; const sc = [{ s: '2-0', p: s * s, f: 'P1' }, { s: '2-1', p: 2 * s * q * s, f: 'P1' }, { s: '0-2', p: q * q, f: 'P2' }, { s: '1-2', p: 2 * s * q * q, f: 'P2' }]; const t = sc.reduce((a, b) => a + b.p, 0); return sc.map(x => ({ ...x, p: ((x.p / t) * 100).toFixed(1) })).sort((a, b) => b.p - a.p); }
  function b5S(p) { const s = Math.pow(p, 0.82), q = 1 - s; const sc = [{ s: '3-0', p: s ** 3, f: 'P1' }, { s: '3-1', p: 3 * s ** 3 * q, f: 'P1' }, { s: '3-2', p: 6 * s ** 3 * q ** 2, f: 'P1' }, { s: '0-3', p: q ** 3, f: 'P2' }, { s: '1-3', p: 3 * q ** 3 * s, f: 'P2' }, { s: '2-3', p: 6 * q ** 3 * s ** 2, f: 'P2' }]; const t = sc.reduce((a, b) => a + b.p, 0); return sc.map(x => ({ ...x, p: ((x.p / t) * 100).toFixed(1) })).sort((a, b) => b.p - a.p); }
  function dQ(M) { const a = Object.values(M).filter(m => m && m.conf > 0).length; return a >= 7 ? { l: 'HD', c: '#34d399' } : a >= 4 ? { l: 'MD', c: '#f59e0b' } : { l: 'LD', c: '#f87171' }; }
  function iW(m, pk) { if (isRet(m)) return null; const f = String(m.first_player_key) === String(pk); return (f && m.event_winner === 'First Player') || (!f && m.event_winner === 'Second Player'); }

  // ═══ 1. RETIREMENT / WALKOVER DETECTION ═══
  function isRet(m) {
    if (!m) return true;
    const status = (m.event_status || '').toLowerCase();
    const result = (m.event_final_result || '').toLowerCase();
    // Detect retirements/walkovers
    if (status.includes('retired') || status.includes('walkover') || status.includes('w/o') || status.includes('abandon')) return true;
    if (result.includes('ret') || result.includes('w/o') || result.includes('walk')) return true;
    // Incomplete match: e.g. "1 - 0" with only 1 set completed in Bo3
    if (m.scores && m.scores.length === 1 && m.event_status === 'Finished') {
      const s1 = +(m.scores[0].score_first || 0), s2 = +(m.scores[0].score_second || 0);
      if (s1 < 6 && s2 < 6) return true; // set didn't finish
    }
    return false;
  }

  // Filter results excluding retirements
  function cleanResults(results) {
    return (results || []).filter(m => !isRet(m) && m.event_winner);
  }

  // ═══ 2. QUALIFICATION FLAG ═══
  function isQualMatch(m) {
    return m.event_qualification === 'True' || m.event_qualification === true ||
      (m.tournament_round || '').toLowerCase().includes('qualif');
  }

  // ═══ 3. ROUND IMPORTANCE ═══
  function roundWeight(round) {
    if (!round) return 1.0;
    const r = round.toLowerCase();
    if (r.includes('final') && !r.includes('semi') && !r.includes('quarter')) return 1.25; // Final
    if (r.includes('semi')) return 1.15; // Semifinal
    if (r.includes('quarter')) return 1.08; // Quarterfinal
    if (r.includes('1/8') || r.includes('round of 16') || r.includes('4th')) return 1.03;
    if (r.includes('1st') || r.includes('1/32') || r.includes('round of 64')) return 0.92; // Early rounds less reliable
    if (r.includes('qualif')) return 0.80; // Qualifications
    return 1.0;
  }

  function roundPressure(round) {
    if (!round) return 0;
    const r = round.toLowerCase();
    if (r.includes('final') && !r.includes('semi') && !r.includes('quarter')) return 3; // Finals = more pressure/fatigue
    if (r.includes('semi')) return 2;
    if (r.includes('quarter')) return 1;
    return 0;
  }
  function dSurf(n) { n = n.toLowerCase(); if (/roland.garros|french.open|rome|roma|madrid|monte.carlo|barcelona|rio|buenos.aires|lyon|hamburg|kitzbuhel|bastad|gstaad|umag|bucharest|marrakech|cordoba|estoril|geneva|parma|sardegna/i.test(n)) return 'clay'; if (/wimbledon|queen|halle|eastbourne|hertogenbosch|mallorca|stuttgart|nottingham/i.test(n)) return 'grass'; if (/paris.masters|paris.indoor|vienna|basel|stockholm|petersburg|moscow|sofia|metz|astana|marseille|dallas|montpellier/i.test(n)) return 'indoor'; return 'hard'; }
  function isSl(n) { return /roland.garros|french.open|wimbledon|us.open|australian.open/i.test(n); }
  function cl(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // ══════════════════════════════════════════
  //  TACHIMETER — FIXED
  // ══════════════════════════════════════════
  function tachSVG(score) {
    const s = cl(+score, 0, 100);
    const color = s >= 70 ? '#34d399' : s >= 50 ? '#f59e0b' : s >= 30 ? '#f97316' : '#f87171';
    // Semicircle gauge: center bottom, sweeps from left to right
    // Using stroke-dasharray technique for clean arcs
    const R = 65; // radius
    const cx = 100, cy = 90;
    const circumference = Math.PI * R; // half circle length
    const filled = (s / 100) * circumference;
    // Needle: rotate from -180 (left, score=0) to 0 (right, score=100)
    const needleDeg = -180 + (s / 100) * 180;
    const needleLen = R - 12;
    const nRad = needleDeg * Math.PI / 180;
    const nx = cx + needleLen * Math.cos(nRad);
    const ny = cy + needleLen * Math.sin(nRad);
    return `<svg viewBox="0 0 200 110" class="tach-svg">
      <!-- Background arc -->
      <path d="M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}" 
        fill="none" stroke="rgba(148,163,184,0.15)" stroke-width="14" stroke-linecap="round"/>
      <!-- Red segment 0-30% -->
      <path d="M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}" 
        fill="none" stroke="#f87171" stroke-width="14" stroke-linecap="round"
        stroke-dasharray="${circumference * 0.30} ${circumference}" opacity="0.6"/>
      <!-- Orange segment 30-50% -->
      <path d="M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}" 
        fill="none" stroke="#f97316" stroke-width="14" stroke-linecap="round"
        stroke-dasharray="${circumference * 0.20} ${circumference}" stroke-dashoffset="-${circumference * 0.30}" opacity="0.5"/>
      <!-- Yellow segment 50-70% -->
      <path d="M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}" 
        fill="none" stroke="#f59e0b" stroke-width="14" stroke-linecap="round"
        stroke-dasharray="${circumference * 0.20} ${circumference}" stroke-dashoffset="-${circumference * 0.50}" opacity="0.5"/>
      <!-- Green segment 70-100% -->
      <path d="M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}" 
        fill="none" stroke="#34d399" stroke-width="14" stroke-linecap="round"
        stroke-dasharray="${circumference * 0.30} ${circumference}" stroke-dashoffset="-${circumference * 0.70}" opacity="0.5"/>
      <!-- Active fill (bright) -->
      <path d="M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}" 
        fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round"
        stroke-dasharray="${filled.toFixed(1)} ${circumference.toFixed(1)}"/>
      <!-- Needle -->
      <line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" 
        stroke="white" stroke-width="2.5" stroke-linecap="round"/>
      <circle cx="${cx}" cy="${cy}" r="4" fill="white"/>
      <!-- Score -->
      <text x="${cx}" y="${cy - 22}" text-anchor="middle" fill="${color}" 
        font-size="30" font-weight="800" font-family="JetBrains Mono,monospace">${Math.round(s)}</text>
      <text x="${cx}" y="${cy - 6}" text-anchor="middle" fill="#64748b" 
        font-size="10" font-family="JetBrains Mono,monospace">/100</text>
      <!-- Min/Max labels -->
      <text x="${cx - R - 5}" y="${cy + 14}" text-anchor="middle" fill="#475569" font-size="8" font-family="JetBrains Mono,monospace">0</text>
      <text x="${cx + R + 5}" y="${cy + 14}" text-anchor="middle" fill="#475569" font-size="8" font-family="JetBrains Mono,monospace">100</text>
    </svg>`;
  }

  // ══════════════════════════════════════════
  //  RENDER PAGE — BettingPro style cards
  // ══════════════════════════════════════════
  function renderPage(match, A, pred, V, h2h) {
    const { M, C, R, T, sf, bo5, dq, r1, r2 } = A;
    const p1 = match.event_first_player, p2 = match.event_second_player;
    const fav = pred.favName || (C.fav === 'P1' ? p1 : p2);
    const unfav = fav === p1 ? p2 : p1;
    const fp = pred.prob || (C.fav === 'P1' ? C.p1 : C.p2);
    const isF = match.event_status === 'Finished';
    const tl = pred.tier === 'gold' ? 'A+ GIOCABILE' : pred.tier === 'silver' ? 'B+ GIOCABILE' : pred.tier === 'bronze' ? 'C CAUTELA' : 'D SKIP';
    const gc = pred.tier === 'gold' ? '#34d399' : pred.tier === 'silver' ? '#f59e0b' : pred.tier === 'bronze' ? '#f97316' : '#f87171';

    let h = `<button class="back-btn" onclick="TP.goHome()">← Partite</button>`;

    // RESULT for finished
    if (isF && V) {
      h += `<div class="result-final ${V.hit ? 'hit' : 'miss'}"><div class="rf-header"><span class="rf-icon">${V.hit ? '✅' : '❌'}</span> Risultato FINALE <span class="rf-badge ${V.hit ? 'hit' : 'miss'}">${V.hit ? 'PRESO' : 'SBAGLIATO'}</span></div><div class="rf-scores"><span class="${match.event_winner === 'First Player' ? 'winner' : ''}">${p1}</span><span class="rf-sets">${(match.scores || []).map(s => `<span class="rf-set ${+s.score_first > +s.score_second ? 'won' : ''}">${s.score_first}-${s.score_second}</span>`).join('')}</span><span class="${match.event_winner === 'Second Player' ? 'winner' : ''}">${p2}</span></div><div class="rf-checks"><div class="rf-check ${V.hit ? 'hit' : 'miss'}"><span>Vincente</span><strong>Prev: ${fav}</strong><small>${V.hit ? '✅' : '❌'} ${V.actualName}</small></div>${V.ouHit !== null ? `<div class="rf-check ${V.ouHit ? 'hit' : 'miss'}"><span>O/U</span><strong>${pred.ou?.pick || 'N/D'}</strong><small>${V.ouHit ? '✅' : '❌'} ${V.totalGames}g</small></div>` : ''}<div class="rf-check ${V.setHit ? 'hit' : 'miss'}"><span>Set</span><strong>${pred.sets?.[0]?.s || '?'}</strong><small>${V.setHit ? '✅' : '❌'} ${V.setScore}</small></div></div></div>`;
    }

    // HEADER
    h += `<div class="ap-header"><div class="ap-header-info"><span class="surface-badge ${sf}">${sf.toUpperCase()}</span> ${match.tournament_name || ''} • ${match.event_type_type || ''} • ${match.event_time || ''}</div><div class="ap-header-badges"><span class="dq-badge" style="color:${dq.c};border-color:${dq.c}">📡 ${dq.l}</span>${r1 ? `<span class="rank-badge">#${r1} ${p1.split(' ').pop()}</span>` : ''}${r2 ? `<span class="rank-badge">#${r2} ${p2.split(' ').pop()}</span>` : ''}${M.form.s1 ? `<span class="form-badge">${p1.split(' ').pop()}: ${M.form.s1}</span>` : ''}${M.form.s2 ? `<span class="form-badge">${p2.split(' ').pop()}: ${M.form.s2}</span>` : ''}</div></div>`;

    // MATCHUP
    h += `<div class="ap-matchup"><div class="ap-player ${C.fav === 'P1' ? 'fav' : ''}"><div class="ap-player-name">${p1}</div>${r1 ? `<div class="ap-player-rank">#${r1}</div>` : ''}</div><div class="ap-center"><div class="ap-vs">VS</div></div><div class="ap-player right ${C.fav === 'P2' ? 'fav' : ''}"><div class="ap-player-name">${p2}</div>${r2 ? `<div class="ap-player-rank">#${r2}</div>` : ''}</div></div>`;
    h += `<div class="ap-prob-bar"><div class="ap-prob-fill p1" style="width:${C.p1}%"><span>${C.p1.toFixed(0)}%</span></div><div class="ap-prob-fill p2" style="width:${C.p2}%"><span>${C.p2.toFixed(0)}%</span></div></div>`;

    // TACHIMETER + MODELS
    h += `<div class="ap-section"><div class="ap-section-header"><span>⚡ Pressione Pre-Match</span><span style="color:${gc};font-family:var(--font-mono);font-size:0.78rem;font-weight:700">${tl}</span></div><div class="ap-tach-row"><div class="ap-tach">${tachSVG(pred.score)}</div><div class="ap-models-list">${C.bd.filter(b => b.active).map(b => `<div class="ap-model-row"><span class="ap-model-icon">${M[b.k]?.icon}</span><span class="ap-model-name">${b.name}</span><div class="ap-model-bar"><div class="ap-model-fill" style="width:${b.p1}%;background:${b.p1 >= 55 ? '#34d399' : b.p1 >= 45 ? '#f59e0b' : '#f87171'}"></div></div><span class="ap-model-val" style="color:${b.p1 >= 55 ? '#34d399' : b.p1 >= 45 ? '#f59e0b' : '#f87171'}">${Math.round(b.p1)}</span></div>`).join('')}</div></div></div>`;

    // ══════ PRONOSTICI — BettingPro style with reasoning ══════
    const confCls = +fp >= 65 ? 'alta' : +fp >= 52 ? 'media' : 'bassa';
    const ouPred = pred.ou || A.MK.ou;
    const fsPred = pred.firstSet || A.MK.firstSet;
    const hcPred = pred.handicap || A.MK.handicap;

    // Generate reasoning from model data
    const reasons = [];
    const activeM = C.bd.filter(b => b.active).sort((a, b) => Math.abs(b.p1 - 50) - Math.abs(a.p1 - 50));
    activeM.slice(0, 3).forEach(b => {
      const favors = b.p1 >= 50 ? fav.split(' ').pop() : unfav.split(' ').pop();
      const str = Math.abs(b.p1 - 50) > 20 ? '✅' : Math.abs(b.p1 - 50) > 8 ? '🟡' : '⚪';
      reasons.push(`${str} ${M[b.k]?.icon || ''} ${b.name}: favorisce ${favors} (${Math.round(Math.max(b.p1, 100 - b.p1))}%)`);
    });

    h += `<div class="prono-grid">`;
    // Card 1: AI Consiglio (full BettingPro style)
    h += `<div class="prono-card main">
      <div class="prono-card-header"><span class="prono-card-icon">🎾</span><span class="prono-card-title">Consiglio AI</span><span class="prono-conf-badge ${confCls}">✓ ${confCls.charAt(0).toUpperCase() + confCls.slice(1)}</span></div>
      <div class="prono-card-body">
        <div class="prono-pick-label">PRONOSTICO CONSIGLIATO</div>
        <div class="prono-pick-value">${fav}</div>
        <div class="prono-pick-prob">${(+fp).toFixed(0)}% probabilità</div>
        ${A.MK.winner.kelly ? `<div class="prono-pick-odds">@ ${A.MK.winner.kelly.o} • Stake ${A.MK.winner.kelly.q}%</div>` : ''}
      </div>
      <div class="prono-reasons"><div class="prono-reasons-title">💡 PERCHÉ QUESTO PRONOSTICO</div>${reasons.map(r => `<div class="prono-reason">${r}</div>`).join('')}</div>
      <div class="prono-alts"><span style="font-size:0.72rem;color:var(--t3)">Alternative:</span>${fsPred ? `<span class="prono-alt-chip">1° Set ${fsPred.pick.split(' ').pop()} ${fsPred.prob}%</span>` : ''}${hcPred ? `<span class="prono-alt-chip">${+hcPred.favMinus.prob > 50 ? hcPred.favMinus.label : hcPred.undPlus.label} ${Math.max(+hcPred.favMinus.prob, +hcPred.undPlus.prob)}%</span>` : ''}</div>
    </div>`;

    // Card 2: Pronostico Statistico (O/U)
    h += `<div class="prono-card">
      <div class="prono-card-header"><span class="prono-card-icon">📊</span><span class="prono-card-title">Pronostico Statistico</span><span class="prono-conf-badge ${+ouPred.prob >= 70 ? 'alta' : +ouPred.prob >= 55 ? 'media' : 'bassa'}">🔥 ${+ouPred.prob >= 70 ? 'Alta' : +ouPred.prob >= 55 ? 'Media' : 'Bassa'}</span></div>
      <div class="prono-card-body">
        <div class="prono-pick-label">PROB. PIÙ ALTA</div>
        <div class="prono-pick-value">${ouPred.pick}</div>
        <div class="prono-pick-prob">${ouPred.prob}% probabilità</div>
        <div class="prono-pick-detail">Previsti: ${ouPred.pred}${ouPred.ha ? ` • H2H: ${ouPred.ha}` : ''}</div>
      </div>
      <div class="prono-reasons"><div class="prono-reasons-title">📋 DETTAGLI</div><div class="prono-reason">✅ Mercato: O/U ${ouPred.line}</div><div class="prono-reason">📊 Over ${ouPred.oP}% | Under ${ouPred.uP}%</div><div class="prono-reason">🧮 Basato su 10 modelli + H2H</div></div>
      <div class="prono-alts"><span style="font-size:0.72rem;color:var(--t3)">Top alternative:</span><span class="prono-alt-chip">${ouPred.pick.includes('Over') ? `Under ${ouPred.line}` : `Over ${ouPred.line}`} ${ouPred.pick.includes('Over') ? ouPred.uP : ouPred.oP}%</span></div>
    </div>`;
    h += `</div>`;

    // Row 2: First Set + Handicap + Set Score
    h += `<div class="prono-grid three">`;
    h += `<div class="prono-card sm"><div class="prono-card-header"><span class="prono-card-icon">🏅</span><span class="prono-card-title">Primo Set</span></div><div class="prono-card-body"><div class="prono-pick-value sm">${fsPred.pick}</div><div class="prono-pick-prob">${fsPred.prob}%</div></div></div>`;
    h += `<div class="prono-card sm"><div class="prono-card-header"><span class="prono-card-icon">📐</span><span class="prono-card-title">Handicap Set</span></div><div class="prono-card-body"><div class="prono-hc-grid"><div class="prono-hc-item ${+hcPred.favMinus.prob > 50 ? 'active' : ''}"><span>${hcPred.favMinus.label}</span><strong>${hcPred.favMinus.prob}%</strong></div><div class="prono-hc-item ${+hcPred.undPlus.prob > 50 ? 'active' : ''}"><span>${hcPred.undPlus.label}</span><strong>${hcPred.undPlus.prob}%</strong></div></div></div></div>`;
    const setPreds = pred.sets || A.MK.sets.preds;
    h += `<div class="prono-card sm"><div class="prono-card-header"><span class="prono-card-icon">🎯</span><span class="prono-card-title">Set Score</span></div><div class="prono-card-body"><div class="prono-sets-mini">${setPreds.slice(0, 3).map((x, i) => `<span class="prono-set-chip ${i === 0 ? 'top' : ''}">${x.s} <strong>${x.p}%</strong></span>`).join('')}</div></div></div>`;
    h += `</div>`;

    // Trap
    if (T.is) h += `<div class="ap-section ap-trap"><div class="ap-section-header"><span>🕵️ Trap Detector</span><span class="ap-badge-orange">${T.sc}/100</span></div>${T.fl.map(f => `<div class="trap-flag">⚠️ ${f}</div>`).join('')}</div>`;

    // Consensus
    h += `<div class="ap-section"><div class="ap-section-header"><span>🏆 Consensus Engine</span><span class="ap-badge-green">${C.ac}/${C.total} • ${R.ag}%</span></div><div class="consensus-pick"><div class="consensus-name">${fav}</div><div class="consensus-prob">${(+fp).toFixed(1)}% • Accordo: ${R.ag}%</div></div><div class="consensus-chips">${C.bd.filter(b => b.active).map(b => `<div class="cm-chip"><span>${M[b.k]?.icon}</span><span>${b.name}</span><strong style="color:${b.p1 >= 50 ? '#34d399' : '#f87171'}">${b.p1 >= 50 ? p1.split(' ').pop() : p2.split(' ').pop()}</strong><span class="cm-pct">${Math.max(b.p1, 100 - b.p1).toFixed(0)}%</span></div>`).join('')}</div></div>`;

    // H2H
    if (h2h && h2h.H2H && h2h.H2H.length) {
      const surfH2H = h2h.H2H.filter(x => dSurf(x.tournament_name || '') === sf);
      h += `<div class="ap-section"><div class="ap-section-header"><span>⚔️ Precedenti (${h2h.H2H.length})</span><span style="font-size:0.78rem;color:var(--text-muted)">${M.h2h.w1}-${M.h2h.w2}</span></div>`;
      if (surfH2H.length && surfH2H.length < h2h.H2H.length) h += `<div style="font-size:0.78rem;color:#f59e0b;margin-bottom:8px">🏟️ Su ${sf.toUpperCase()} (${surfH2H.length}):</div><div class="h2h-list">${surfH2H.slice(0, 3).map(h2hR).join('')}</div><div style="font-size:0.78rem;color:var(--text-muted);margin:8px 0">Tutti:</div>`;
      h += `<div class="h2h-list">${h2h.H2H.slice(0, 6).map(h2hR).join('')}</div></div>`;
    }

    h += `<div style="text-align:center;padding:2rem 0;color:var(--text-dim);font-size:0.72rem">⚠️ Solo scopo informativo</div>`;
    return h;
  }

  function h2hR(x) { const sc = x.scores ? x.scores.map(s => `${s.score_first}-${s.score_second}`).join(' ') : x.event_final_result || ''; return `<div class="h2h-row"><span class="h2h-date">${x.event_date || ''}</span><span class="h2h-p ${x.event_winner === 'First Player' ? 'w' : ''}">${x.event_first_player}</span><span class="h2h-sc">${sc}</span><span class="h2h-p right ${x.event_winner === 'Second Player' ? 'w' : ''}">${x.event_second_player}</span></div>`; }

  // ══════════════════════════════════════════
  //  HOME + QUICK PREDICTIONS (Firebase cached)
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
      return `<div class="tournament-card open"><div class="tournament-header" onclick="this.parentElement.classList.toggle('open')"><div class="tournament-info"><span class="surface-badge ${sf}">${sf.toUpperCase()}</span><span class="tournament-name">${t.name}</span><span class="tournament-type">${t.type.replace(/Singles|Doubles/gi, '').trim()}</span></div><div class="tournament-meta"><span class="tournament-count">${t.m.length}</span>${up ? `<span class="tournament-upcoming">${up} da giocare</span>` : ''}<span class="tournament-arrow">▾</span></div></div><div class="tournament-matches">${t.m.sort((a, b) => (a.event_status === 'Finished' ? 1 : 0) - (b.event_status === 'Finished' ? 1 : 0) || (a.event_time || '').localeCompare(b.event_time || '')).map(rmr).join('')}</div></div>`;
    }).join('');
    loadQuickPreds();
  }

  function rmr(m) {
    const isF = m.event_status === 'Finished', isL = m.event_live === '1';
    let sc = ''; if (m.scores && m.scores.length) sc = m.scores.map(s => `<span class="set-score-mini ${+s.score_first > +s.score_second ? 'won' : ''}">${s.score_first}-${s.score_second}</span>`).join(' ');
    const st = isF ? `<span class="status-badge finished">✓</span>` : isL ? `<span class="status-badge live">LIVE</span>` : `<span class="status-badge upcoming">${m.event_time || 'TBD'}</span>`;
    return `<div class="match-row clickable ${isL ? 'live' : ''}" data-ek="${m.event_key}"><div class="mr-status">${st}</div><div class="mr-players"><span class="mr-p ${m.event_winner === 'First Player' ? 'w' : ''}">${m.event_first_player}</span><span class="mr-vs">vs</span><span class="mr-p ${m.event_winner === 'Second Player' ? 'w' : ''}">${m.event_second_player}</span></div><div class="mr-pred" id="pred-${m.event_key}"><span class="pred-loading">⏳</span></div><div class="mr-score">${sc}</div><div class="mr-cta">📊</div></div>`;
  }

  async function loadQuickPreds() {
    const date = ds(S.dOff);
    // Try to load all predictions from Firebase at once
    const allPreds = await fbGet(`predictions/${date}`) || {};
    const allResults = await fbGet(`results/${date}`) || {};

    for (const match of S.matches) {
      if (S.tab !== 'matches') break;
      const el = document.getElementById(`pred-${match.event_key}`);
      if (!el) continue;
      const ek = String(match.event_key);

      // Check Firebase first
      let pred = allPreds[ek];
      if (!pred) {
        // Generate and save
        try {
          const h2h = await gh(match.first_player_key, match.second_player_key);
          const td = findTO(match.event_first_player, match.event_second_player);
          const A = runEngine(match, h2h, td);
          const C = A.C, R = A.R;
          pred = {
            fav: C.fav, favName: C.fav === 'P1' ? match.event_first_player : match.event_second_player,
            prob: +(C.fav === 'P1' ? C.p1 : C.p2).toFixed(1), tier: R.tier, score: R.sc,
            ou: A.MK.ou, firstSet: A.MK.firstSet, handicap: A.MK.handicap,
            sets: A.MK.sets.preds.slice(0, 4).map(x => ({ s: x.s, p: x.p, f: x.f })),
          };
          if (match.event_status !== 'Finished') {
            fbSet(`predictions/${date}/${ek}`, { ...pred, timestamp: Date.now() });
          }
        } catch (e) { el.innerHTML = ''; continue; }
      }

      const favN = (pred.favName || '').split(' ').pop();
      const prob = Math.round(pred.prob || 50);
      const isF = match.event_status === 'Finished';

      if (isF && match.event_winner) {
        const predW = pred.fav === 'P1' ? 'First Player' : 'Second Player';
        const hit = match.event_winner === predW;
        S.acc.total++; if (hit) S.acc.hit++; else S.acc.miss++;
        el.innerHTML = `<span class="pred-badge ${hit ? 'hit' : 'miss'}"><span class="pred-icon">${hit ? '✅' : '❌'}</span><span class="pred-name">${favN}</span><span class="pred-pct">${prob}%</span></span>`;
        updateAcc();
      } else {
        const cls = prob >= 65 ? 'green' : prob >= 52 ? 'yellow' : 'red';
        el.innerHTML = `<span class="pred-badge ${cls}"><span class="pred-name">${favN}</span><span class="pred-pct">${prob}%</span></span>`;
        if (pred.tier === 'gold' || (pred.tier === 'silver' && prob >= 62)) {
          S.topPicks.push({ match, fav: pred.favName, prob, tier: pred.tier, sc: pred.score, ek: match.event_key });
          renderTopPicks();
        }
      }
    }
  }

  function renderTopPicks() {
    const c = document.getElementById('topPicksContainer');
    if (!S.topPicks.length) { c.style.display = 'none'; return; }
    c.style.display = 'block';
    const sorted = S.topPicks.sort((a, b) => +b.sc - +a.sc).slice(0, 5);
    c.innerHTML = `<div class="top-picks"><div class="tp-header"><span>🎯 Top Picks del Giorno</span><span class="tp-count">${sorted.length}</span></div>${sorted.map(p => `<div class="tp-item" onclick="TP.openMatch('${p.ek}')"><div class="tp-left"><span class="tp-dot ${p.tier}"></span><span class="tp-name">${p.fav}</span></div><div class="tp-right"><span class="tp-vs">vs ${p.match.event_first_player === p.fav ? p.match.event_second_player.split(' ').pop() : p.match.event_first_player.split(' ').pop()}</span><span class="tp-prob">${p.prob}%</span></div></div>`).join('')}</div>`;
  }

  function updateAcc() {
    const bar = document.getElementById('accuracyBar');
    if (!S.acc.total) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    const pct = ((S.acc.hit / S.acc.total) * 100).toFixed(0);
    const cls = +pct >= 70 ? 'green' : +pct >= 50 ? 'yellow' : 'red';
    bar.innerHTML = `<div class="acc-label">📊 Accuracy</div><span class="acc-pct ${cls}">${pct}%</span><span class="acc-detail">✅${S.acc.hit} ❌${S.acc.miss} / ${S.acc.total}</span><div class="acc-bar-track"><div class="acc-bar-fill ${cls}" style="width:${pct}%"></div></div>`;
  }

  // ═══ BANKROLL ═══
  function addBet(ek, pick, prob, odds) { const stake = +(S.bankroll.capital * (+prob > 65 ? 0.15 : +prob > 55 ? 0.10 : 0.05)).toFixed(2); S.bankroll.bets.push({ ek, pick, prob: +prob, odds: +odds, stake, date: ds(), result: null }); saveBR(); alert(`✅ ${pick} @${odds} — €${stake}`); }
  function resolveBet(i, won) { const b = S.bankroll.bets[i]; if (!b) return; b.result = won ? 'win' : 'loss'; S.bankroll.capital = +(S.bankroll.capital + (won ? b.stake * (b.odds - 1) : -b.stake)).toFixed(2); saveBR(); renderBankroll(); }
  function saveBR() { localStorage.setItem('tp_bankroll', JSON.stringify(S.bankroll)); }
  function setCapital(v) { S.bankroll.capital = +v || 100; saveBR(); renderBankroll(); }
  function renderBankroll() {
    const d = document.getElementById('bankrollDashboard'), bets = S.bankroll.bets;
    const won = bets.filter(b => b.result === 'win').length, lost = bets.filter(b => b.result === 'loss').length;
    const profit = bets.reduce((s, b) => s + (b.result === 'win' ? b.stake * (b.odds - 1) : b.result === 'loss' ? -b.stake : 0), 0);
    const roi = bets.filter(b => b.result).length > 0 ? (profit / bets.filter(b => b.result).reduce((s, b) => s + b.stake, 0) * 100) : 0;
    d.innerHTML = `<div class="bk-grid"><div class="bk-card main"><div class="bk-label">CAPITALE</div><div class="bk-value">€${S.bankroll.capital.toFixed(2)}</div></div><div class="bk-card ${profit >= 0 ? 'pos' : 'neg'}"><div class="bk-label">P/L</div><div class="bk-value">${profit >= 0 ? '+' : ''}€${profit.toFixed(2)}</div></div><div class="bk-card"><div class="bk-label">ROI</div><div class="bk-value">${roi.toFixed(1)}%</div></div><div class="bk-card"><div class="bk-label">W/L</div><div class="bk-value">${won}/${lost}</div></div></div>`;
    document.getElementById('bankrollHistory').innerHTML = bets.length ? bets.slice().reverse().map((b, ri) => { const i = bets.length - 1 - ri; return `<div class="bk-row ${b.result || 'pending'}"><span class="bk-pick">${b.pick} @${b.odds.toFixed(2)}</span><span class="bk-stake">€${b.stake.toFixed(2)}</span><span class="bk-date">${b.date}</span><span class="bk-result">${b.result === 'win' ? '✅+€' + (b.stake * (b.odds - 1)).toFixed(2) : b.result === 'loss' ? '❌-€' + b.stake.toFixed(2) : `<button class="bk-btn w" onclick="TP.resolveBet(${i},true)">✅</button><button class="bk-btn l" onclick="TP.resolveBet(${i},false)">❌</button>`}</span></div>`; }).join('') : '<div class="empty-state"><div class="empty-title">Nessuna scommessa</div></div>';
  }

  // ═══ LIVE / RANK ═══
  async function loadLive() { const c = document.getElementById('liveContainer'); const d = await api('live'); if (d.success === 1 && d.result && d.result.length) { S.live = d.result; document.getElementById('liveCount').textContent = d.result.length; document.getElementById('liveCount').style.display = 'inline'; renderLive(); } else { S.live = []; document.getElementById('liveCount').style.display = 'none'; c.innerHTML = `<div class="empty-state"><div class="empty-icon">😴</div><div class="empty-title">Nessun match live</div></div>`; } }
  function renderLive() { const c = document.getElementById('liveContainer'); let m = [...S.live]; if (S.lFlt !== 'all') m = m.filter(x => (x.event_type_type || '').toLowerCase().includes(S.lFlt)); if (!m.length) { c.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div></div>`; return; } c.innerHTML = m.map(x => { const sv = x.event_serve; let sH = ''; if (x.scores && x.scores.length) sH = `<div class="match-score">${x.scores.map(s => `<div class="set-score ${+s.score_first > +s.score_second ? 'won' : ''}">${s.score_first}-${s.score_second}</div>`).join('')}</div>`; const gs = x.event_game_result || ''; return `<div class="match-card live"><div class="match-card-header"><span class="match-tournament"><span class="surface-badge ${dSurf(x.tournament_name || '')}">${dSurf(x.tournament_name || '').toUpperCase()}</span> ${x.tournament_name || ''}</span><span class="match-time live">● ${x.event_status || 'LIVE'}</span></div><div class="match-players"><div class="player"><span class="player-name">${sv === 'First Player' ? '🎾 ' : ''}${x.event_first_player}</span></div><div style="text-align:center">${sH}${gs && gs !== '-' ? `<div style="font-family:var(--font-mono);font-size:1rem;color:var(--gold);margin-top:6px;font-weight:700">${gs}</div>` : ''}</div><div class="player right"><span class="player-name">${sv === 'Second Player' ? '🎾 ' : ''}${x.event_second_player}</span></div></div></div>`; }).join(''); }
  function startLive() { loadLive(); S.lInt = setInterval(loadLive, CFG.LIVE_MS); } function stopLive() { if (S.lInt) { clearInterval(S.lInt); S.lInt = null; } }
  async function loadRank() { const c = document.getElementById('rankingsContainer'); c.innerHTML = `<div class="loading-state"><div class="loading-spinner"></div></div>`; const d = await api('stand', { etk: S.rk === 'atp' ? '265' : '266' }); if (d.success === 1 && d.result && d.result.length) { c.innerHTML = `<table class="rankings-table"><thead><tr><th>#</th><th>Giocatore</th><th>Punti</th></tr></thead><tbody>${d.result.slice(0, 100).map((p, i) => `<tr><td><span class="rank-number ${(p.place || i + 1) <= 3 ? 'top-3' : ''}">${p.place || i + 1}</span></td><td>${p.player_name || p.team_name || '-'}</td><td class="stat-mono">${p.points || p.team_points || '-'}</td></tr>`).join('')}</tbody></table>`; } else c.innerHTML = `<div class="empty-state"><div class="empty-icon">🏆</div><div class="empty-title">N/D</div></div>`; }

  return { init, openMatch, goHome, switchTab: swTab, addBet, resolveBet, setCapital };
})();
document.addEventListener('DOMContentLoaded', TP.init);
