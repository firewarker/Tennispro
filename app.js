/**
 * TennisPro — app.js v1.0
 * Prediction Engine + API Integration + UI Logic
 */

const TennisPro = (() => {

  // ─── Configuration ───
  const CONFIG = {
    // WORKER_URL: 'https://tennispro-api.YOUR_SUBDOMAIN.workers.dev',
    // Durante sviluppo, chiamate dirette:
    WORKER_URL: 'https://tennispro.lucalagan.workers.dev',
    DIRECT_API: 'https://api.api-tennis.com/tennis/',
    API_KEY: '4e2024edac52697afb5f6016f7cc98b24956bf9e45e6491f105593e740174678',
    USE_WORKER: true, // toggle: true = worker proxy, false = direct API
    LIVE_INTERVAL: 30000, // 30s refresh live
    TIMEZONE: 'Europe/Rome',
    // Event type keys for filtering
    EVENT_TYPES: {
      ATP_SINGLES: '265',
      WTA_SINGLES: '266',
      ATP_DOUBLES: '267',
      WTA_DOUBLES: '268',
      CHALLENGER_SINGLES: '281',
      CHALLENGER_DOUBLES: '282',
      ITF_MEN: '269',
      ITF_WOMEN: '270',
    }
  };

  // ─── State ───
  let state = {
    currentTab: 'matches',
    selectedDate: 0, // offset from today
    matchFilter: 'all',
    tierFilter: 'all',
    liveFilter: 'all',
    rankingType: 'atp',
    liveInterval: null,
    allMatches: [],
    liveMatches: [],
    h2hPlayer1Key: null,
    h2hPlayer2Key: null,
    playersCache: {},
    oddsCache: {},
  };

  // ─── Initialize ───
  function init() {
    setupDate();
    setupTabs();
    setupDateSelector();
    setupFilters();
    loadMatches();
    loadRankings();
  }

  // ─── Date Utilities ───
  function setupDate() {
    const now = new Date();
    const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    document.getElementById('headerDate').textContent = now.toLocaleDateString('it-IT', options);
  }

  function getDateString(offset = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toISOString().split('T')[0];
  }

  // ─── API Calls ───
  async function apiCall(method, params = {}) {
    try {
      if (CONFIG.USE_WORKER) {
        // Use Worker proxy
        let path = '';
        const queryParams = new URLSearchParams();

        switch (method) {
          case 'get_fixtures':
            path = 'fixtures/' + (params.date_start || getDateString());
            if (params.event_type_key) queryParams.set('event_type_key', params.event_type_key);
            break;
          case 'get_livescore':
            path = 'livescore';
            break;
          case 'get_H2H':
            path = 'h2h';
            queryParams.set('p1', params.first_player_key);
            queryParams.set('p2', params.second_player_key);
            break;
          case 'get_standings':
            path = 'standings';
            if (params.event_type_key) queryParams.set('event_type_key', params.event_type_key);
            break;
          case 'get_players':
            path = 'players';
            if (params.player_key) queryParams.set('player_key', params.player_key);
            break;
          case 'get_odds':
            path = 'odds';
            if (params.match_key) queryParams.set('match_key', params.match_key);
            break;
          case 'get_events':
            path = 'events';
            break;
          case 'get_tournaments':
            path = 'tournaments';
            break;
          default:
            path = 'api';
            queryParams.set('method', method);
            Object.entries(params).forEach(([k, v]) => queryParams.set(k, v));
        }

        const qs = queryParams.toString();
        const url = `${CONFIG.WORKER_URL}/${path}${qs ? '?' + qs : ''}`;
        const resp = await fetch(url);
        return await resp.json();

      } else {
        // Direct API call
        const queryParams = new URLSearchParams({
          method,
          APIkey: CONFIG.API_KEY,
          timezone: CONFIG.TIMEZONE,
          ...params,
        });
        const resp = await fetch(`${CONFIG.DIRECT_API}?${queryParams}`);
        return await resp.json();
      }
    } catch (err) {
      console.error(`API Error [${method}]:`, err);
      return { success: 0, result: [], error: err.message };
    }
  }

  // ─── Tab Management ───
  function setupTabs() {
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabId = tab.dataset.tab;
        switchTab(tabId);
      });
    });
  }

  function switchTab(tabId) {
    state.currentTab = tabId;

    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');

    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(`tab-${tabId}`).classList.add('active');

    // Load data for tab
    if (tabId === 'live') startLiveUpdates();
    else stopLiveUpdates();

    if (tabId === 'rankings') loadRankings();
  }

  // ─── Date Selector ───
  function setupDateSelector() {
    document.querySelectorAll('.date-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.date-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.selectedDate = parseInt(btn.dataset.offset);
        loadMatches();
      });
    });
  }

  // ─── Filters ───
  function setupFilters() {
    // Match category filters
    document.querySelectorAll('[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.matchFilter = btn.dataset.filter;
        renderMatches();
      });
    });

    // Tier filter
    document.getElementById('tierFilter').addEventListener('change', (e) => {
      state.tierFilter = e.target.value;
      renderMatches();
    });

    // Live filters
    document.querySelectorAll('[data-live-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-live-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.liveFilter = btn.dataset.liveFilter;
        renderLive();
      });
    });

    // Ranking type
    document.querySelectorAll('[data-ranking]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-ranking]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.rankingType = btn.dataset.ranking;
        loadRankings();
      });
    });
  }

  // ════════════════════════════════════════════
  //  PREDICTION ENGINE
  // ════════════════════════════════════════════

  /**
   * Multi-factor tennis prediction model.
   * Factors:
   *  1. Ranking Gap (weight: 25%)
   *  2. Recent Form — last 5 matches (weight: 25%)
   *  3. H2H Record (weight: 20%)
   *  4. Surface Affinity (weight: 15%)
   *  5. Odds Value Detection (weight: 15%)
   *
   * Returns: { prediction, confidence, tier, factors, valueBet }
   */
  function predictMatch(match, h2hData = null, odds = null) {
    const factors = {};
    let totalScore = 50; // neutral starting point
    let dataPoints = 0;

    // --- Factor 1: Ranking Gap ---
    const rank1 = extractRank(match, 'first');
    const rank2 = extractRank(match, 'second');

    if (rank1 && rank2) {
      const rankDiff = rank2 - rank1; // positive = P1 higher ranked
      const rankFactor = sigmoid(rankDiff / 50) * 100;
      factors.ranking = {
        label: 'Ranking',
        p1: `#${rank1}`,
        p2: `#${rank2}`,
        score: rankFactor,
        impact: rankFactor > 50 ? 'P1' : 'P2',
      };
      totalScore += (rankFactor - 50) * 0.25;
      dataPoints++;
    } else {
      factors.ranking = { label: 'Ranking', p1: 'N/D', p2: 'N/D', score: 50, impact: '-' };
    }

    // --- Factor 2: Recent Form ---
    // We extract form from H2H data's individual results if available
    if (h2hData) {
      const p1Results = h2hData.firstPlayerResults || [];
      const p2Results = h2hData.secondPlayerResults || [];
      const p1Form = calcFormScore(p1Results, match.first_player_key);
      const p2Form = calcFormScore(p2Results, match.second_player_key);

      const formDiff = p1Form - p2Form;
      const formFactor = 50 + (formDiff * 5);

      factors.form = {
        label: 'Forma',
        p1: `${p1Form.toFixed(0)}%`,
        p2: `${p2Form.toFixed(0)}%`,
        score: clamp(formFactor, 0, 100),
        impact: formFactor > 50 ? 'P1' : 'P2',
      };
      totalScore += (clamp(formFactor, 0, 100) - 50) * 0.25;
      dataPoints++;
    } else {
      factors.form = { label: 'Forma', p1: 'N/D', p2: 'N/D', score: 50, impact: '-' };
    }

    // --- Factor 3: H2H Record ---
    if (h2hData && h2hData.H2H && h2hData.H2H.length > 0) {
      let p1Wins = 0, p2Wins = 0;
      h2hData.H2H.forEach(m => {
        if (m.event_winner === 'First Player' && m.first_player_key == match.first_player_key) p1Wins++;
        else if (m.event_winner === 'Second Player' && m.second_player_key == match.second_player_key) p1Wins++;
        else if (m.event_winner === 'First Player' && m.first_player_key == match.second_player_key) p2Wins++;
        else if (m.event_winner === 'Second Player' && m.second_player_key == match.first_player_key) p2Wins++;
        else if (m.event_winner) p2Wins++;
      });

      const total = p1Wins + p2Wins;
      const h2hFactor = total > 0 ? (p1Wins / total) * 100 : 50;

      factors.h2h = {
        label: 'H2H',
        p1: `${p1Wins}W`,
        p2: `${p2Wins}W`,
        score: h2hFactor,
        impact: h2hFactor > 50 ? 'P1' : 'P2',
      };
      totalScore += (h2hFactor - 50) * 0.20;
      dataPoints++;
    } else {
      factors.h2h = { label: 'H2H', p1: 'N/D', p2: 'N/D', score: 50, impact: '-' };
    }

    // --- Factor 4: Surface Affinity ---
    const surface = detectSurface(match.tournament_name || '');
    factors.surface = {
      label: 'Superficie',
      value: surface || 'Sconosciuta',
      score: 50,
      impact: '-',
    };
    // Surface scoring would require player stats per surface — placeholder for enrichment
    totalScore += 0; // neutral until we have surface data
    if (surface) dataPoints++;

    // --- Factor 5: Odds Value ---
    if (odds) {
      const impliedP1 = odds.p1Odds ? (1 / odds.p1Odds) : null;
      const impliedP2 = odds.p2Odds ? (1 / odds.p2Odds) : null;
      const ourProb = totalScore / 100;

      if (impliedP1 && impliedP2) {
        const margin = impliedP1 + impliedP2 - 1;
        const fairP1 = impliedP1 / (1 + margin);
        const edge = ourProb - fairP1;

        factors.odds = {
          label: 'Quote',
          p1: odds.p1Odds.toFixed(2),
          p2: odds.p2Odds.toFixed(2),
          score: 50 + (edge * 100),
          impact: edge > 0.03 ? 'VALUE P1' : edge < -0.03 ? 'VALUE P2' : 'Fair',
          edge: (edge * 100).toFixed(1),
        };
        totalScore += edge * 15;
        dataPoints++;
      }
    } else {
      factors.odds = { label: 'Quote', p1: 'N/D', p2: 'N/D', score: 50, impact: '-' };
    }

    // --- Final Score ---
    const finalScore = clamp(totalScore, 0, 100);
    const confidence = Math.abs(finalScore - 50) * 2; // 0-100 confidence
    const tier = calcTier(confidence, dataPoints);
    const favored = finalScore >= 50 ? 'P1' : 'P2';

    return {
      finalScore: finalScore.toFixed(1),
      confidence: confidence.toFixed(0),
      tier,
      favored,
      favoredName: favored === 'P1' ? match.event_first_player : match.event_second_player,
      probability: favored === 'P1' ? finalScore.toFixed(0) : (100 - finalScore).toFixed(0),
      factors,
      dataPoints,
      valueBet: factors.odds?.impact?.startsWith('VALUE') || false,
    };
  }

  function calcFormScore(results, playerKey) {
    const last5 = results.slice(0, 5);
    if (last5.length === 0) return 50;

    let wins = 0;
    last5.forEach(m => {
      const isFirst = m.first_player_key == playerKey;
      if ((isFirst && m.event_winner === 'First Player') ||
          (!isFirst && m.event_winner === 'Second Player')) {
        wins++;
      }
    });

    return (wins / last5.length) * 100;
  }

  function calcTier(confidence, dataPoints) {
    if (dataPoints < 2) return 'skip';
    if (confidence >= 65) return 'gold';
    if (confidence >= 45) return 'silver';
    if (confidence >= 25) return 'bronze';
    return 'skip';
  }

  function detectSurface(tournamentName) {
    const name = tournamentName.toLowerCase();
    // Known clay tournaments
    if (/roland\s*garros|rome|madrid|monte\s*carlo|barcelona|rio|buenos\s*aires|lyon|hamburg|kitzbuhel|bastad|gstaad|umag|bucharest/i.test(name)) return 'clay';
    // Known grass
    if (/wimbledon|queen|halle|eastbourne|s-hertogenbosch|mallorca|stuttgart|nottingham/i.test(name)) return 'grass';
    // Known indoor
    if (/paris\s*masters|vienna|basel|stockholm|st\.\s*petersburg|moscow|sofia|metz|astana/i.test(name)) return 'indoor';
    // Default hard
    return 'hard';
  }

  function extractRank(match, player) {
    // API doesn't directly provide ranking in fixtures — would need standings data
    // For now we use a placeholder; real implementation fetches from standings cache
    return null;
  }

  function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  // ════════════════════════════════════════════
  //  LOAD & RENDER: MATCHES
  // ════════════════════════════════════════════

  async function loadMatches() {
    const container = document.getElementById('matchesContainer');
    container.innerHTML = `<div class="loading-state"><div class="loading-spinner"></div><p>Caricamento partite...</p></div>`;

    const date = getDateString(state.selectedDate);
    const data = await apiCall('get_fixtures', {
      date_start: date,
      date_stop: date,
    });

    if (data.success === 1 && data.result && data.result.length > 0) {
      state.allMatches = data.result;
      renderMatches();
    } else {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🎾</div>
          <div class="empty-title">Nessuna partita trovata</div>
          <p class="empty-text">Non ci sono partite programmate per ${date}. Prova un'altra data.</p>
        </div>`;
    }
  }

  function renderMatches() {
    const container = document.getElementById('matchesContainer');
    let matches = [...state.allMatches];

    // Category filter
    if (state.matchFilter !== 'all') {
      matches = matches.filter(m => {
        const type = (m.event_type_type || '').toLowerCase();
        if (state.matchFilter === 'atp') return type.includes('atp');
        if (state.matchFilter === 'wta') return type.includes('wta');
        if (state.matchFilter === 'challenger') return type.includes('challenger');
        return true;
      });
    }

    // Sort: upcoming first, then by time
    matches.sort((a, b) => {
      const aFinished = a.event_status === 'Finished' ? 1 : 0;
      const bFinished = b.event_status === 'Finished' ? 1 : 0;
      if (aFinished !== bFinished) return aFinished - bFinished;
      return (a.event_time || '').localeCompare(b.event_time || '');
    });

    // Generate predictions (basic — without H2H for speed)
    const cardsHtml = matches.map(match => {
      const prediction = predictMatch(match);

      // Tier filter
      if (state.tierFilter !== 'all') {
        const tierOrder = { gold: 1, silver: 2, bronze: 3, skip: 4 };
        const filterLevel = tierOrder[state.tierFilter] || 4;
        const matchLevel = tierOrder[prediction.tier] || 4;
        if (matchLevel > filterLevel) return '';
      }

      return renderMatchCard(match, prediction);
    }).join('');

    container.innerHTML = cardsHtml || `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <div class="empty-title">Nessun match con questi filtri</div>
        <p class="empty-text">Prova a cambiare i filtri per vedere più partite.</p>
      </div>`;
  }

  function renderMatchCard(match, prediction) {
    const isFinished = match.event_status === 'Finished';
    const isLive = match.event_live === '1';
    const surface = detectSurface(match.tournament_name || '');

    // Score display
    let scoreHtml = '';
    if (match.scores && match.scores.length > 0) {
      scoreHtml = `<div class="match-score">
        ${match.scores.map(s => {
          const p1Won = parseInt(s.score_first) > parseInt(s.score_second);
          return `<div class="set-score ${p1Won ? 'won' : ''}">${s.score_first}-${s.score_second}</div>`;
        }).join('')}
      </div>`;
    }

    // Result badge for finished
    let resultBadge = '';
    if (isFinished && match.event_winner) {
      const winner = match.event_winner === 'First Player' ? match.event_first_player : match.event_second_player;
      resultBadge = `<span class="status-badge finished">✓ ${winner}</span>`;
    } else if (isLive) {
      resultBadge = `<span class="status-badge live">● LIVE</span>`;
    } else {
      resultBadge = `<span class="status-badge upcoming">${match.event_time || 'TBD'}</span>`;
    }

    // Surface badge
    const surfaceHtml = surface ? `<span class="surface-badge ${surface}">${surface.toUpperCase()}</span>` : '';

    // Prediction bar (only for upcoming matches)
    let predictionHtml = '';
    if (!isFinished) {
      predictionHtml = `
        <div class="prediction-bar">
          <span class="tier-badge ${prediction.tier}">${prediction.tier.toUpperCase()}</span>
          <span class="prediction-text">
            ${prediction.tier !== 'skip' ? `→ <strong>${prediction.favoredName}</strong>` : 'Dati insufficienti'}
          </span>
          ${prediction.tier !== 'skip' ? `
            <div class="prediction-prob">
              <div class="prob-bar">
                <div class="prob-fill" style="width:${prediction.probability}%"></div>
              </div>
              <span class="prob-label">${prediction.probability}%</span>
            </div>
          ` : ''}
          ${prediction.valueBet ? '<span class="value-bet">💰 VALUE</span>' : ''}
        </div>`;
    }

    // Expandable factors
    let factorsHtml = '';
    if (!isFinished && prediction.tier !== 'skip') {
      factorsHtml = `
        <div class="match-details">
          <div class="factors-grid">
            ${Object.values(prediction.factors).map(f => `
              <div class="factor-item">
                <span class="factor-label">${f.label}</span>
                <span class="factor-value ${f.score > 55 ? 'positive' : f.score < 45 ? 'negative' : 'neutral'}">
                  ${f.p1 || f.value || '-'} ${f.p2 ? `vs ${f.p2}` : ''}
                </span>
              </div>
            `).join('')}
          </div>
        </div>
        <button class="expand-toggle" onclick="TennisPro.toggleExpand(this)">
          ▾ Dettagli fattori
        </button>`;
    }

    // H2H button
    const h2hButton = !isFinished ? `
      <button class="filter-btn" style="font-size:0.7rem; padding:4px 10px;"
        onclick="TennisPro.quickH2H('${match.first_player_key}','${match.second_player_key}','${escapeHtml(match.event_first_player)}','${escapeHtml(match.event_second_player)}')">
        🔄 H2H
      </button>` : '';

    return `
      <div class="match-card tier-${prediction.tier} ${isLive ? 'live' : ''}" data-match="${match.event_key}">
        <div class="match-card-header">
          <span class="match-tournament">
            ${surfaceHtml}
            ${match.tournament_name || 'Torneo'}
            <span class="match-round">${match.tournament_round || match.event_type_type || ''}</span>
          </span>
          <div style="display:flex; gap:8px; align-items:center;">
            ${h2hButton}
            ${resultBadge}
          </div>
        </div>

        <div class="match-players">
          <div class="player">
            <span class="player-name ${match.event_winner === 'First Player' ? 'winner' : ''}">${match.event_first_player}</span>
          </div>
          <div style="text-align:center">
            <div class="match-vs">VS</div>
            ${scoreHtml}
          </div>
          <div class="player right">
            <span class="player-name ${match.event_winner === 'Second Player' ? 'winner' : ''}">${match.event_second_player}</span>
          </div>
        </div>

        ${predictionHtml}
        ${factorsHtml}
      </div>`;
  }

  // ════════════════════════════════════════════
  //  LOAD & RENDER: LIVE SCORE
  // ════════════════════════════════════════════

  async function loadLive() {
    const container = document.getElementById('liveContainer');
    const data = await apiCall('get_livescore');

    if (data.success === 1 && data.result && data.result.length > 0) {
      state.liveMatches = data.result;

      // Update live count badge
      const badge = document.getElementById('liveCount');
      badge.textContent = data.result.length;
      badge.style.display = 'inline';

      renderLive();
    } else {
      state.liveMatches = [];
      document.getElementById('liveCount').style.display = 'none';

      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">😴</div>
          <div class="empty-title">Nessun match live</div>
          <p class="empty-text">Non ci sono partite in corso al momento. Controlla più tardi!</p>
        </div>`;
    }
  }

  function renderLive() {
    const container = document.getElementById('liveContainer');
    let matches = [...state.liveMatches];

    if (state.liveFilter !== 'all') {
      matches = matches.filter(m => {
        const type = (m.event_type_type || '').toLowerCase();
        if (state.liveFilter === 'atp') return type.includes('atp');
        if (state.liveFilter === 'wta') return type.includes('wta');
        return true;
      });
    }

    if (matches.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <div class="empty-title">Nessun match live per questo filtro</div>
        </div>`;
      return;
    }

    container.innerHTML = matches.map(match => renderLiveCard(match)).join('');
  }

  function renderLiveCard(match) {
    const surface = detectSurface(match.tournament_name || '');
    const surfaceHtml = surface ? `<span class="surface-badge ${surface}">${surface.toUpperCase()}</span>` : '';

    let scoreHtml = '';
    if (match.scores && match.scores.length > 0) {
      scoreHtml = `<div class="match-score">
        ${match.scores.map(s => {
          const p1Won = parseInt(s.score_first) > parseInt(s.score_second);
          return `<div class="set-score ${p1Won ? 'won' : ''}">${s.score_first}-${s.score_second}</div>`;
        }).join('')}
      </div>`;
    }

    const gameScore = match.event_game_result || '';
    const serving = match.event_serve;

    return `
      <div class="match-card live">
        <div class="match-card-header">
          <span class="match-tournament">
            ${surfaceHtml}
            ${match.tournament_name || 'Torneo'}
          </span>
          <span class="match-time live">
            ● ${match.event_status || 'LIVE'}
          </span>
        </div>

        <div class="match-players">
          <div class="player">
            <span class="player-name">${serving === 'First Player' ? '🎾 ' : ''}${match.event_first_player}</span>
          </div>
          <div style="text-align:center">
            ${scoreHtml}
            ${gameScore && gameScore !== '-' ? `<div style="font-family:var(--font-mono); font-size:0.9rem; color:var(--gold); margin-top:6px; font-weight:700">${gameScore}</div>` : ''}
          </div>
          <div class="player right">
            <span class="player-name">${serving === 'Second Player' ? '🎾 ' : ''}${match.event_second_player}</span>
          </div>
        </div>
      </div>`;
  }

  function startLiveUpdates() {
    loadLive();
    if (state.liveInterval) clearInterval(state.liveInterval);
    state.liveInterval = setInterval(loadLive, CONFIG.LIVE_INTERVAL);
  }

  function stopLiveUpdates() {
    if (state.liveInterval) {
      clearInterval(state.liveInterval);
      state.liveInterval = null;
    }
  }

  // ════════════════════════════════════════════
  //  HEAD-TO-HEAD
  // ════════════════════════════════════════════

  async function loadH2H() {
    const p1Input = document.getElementById('h2hPlayer1').value.trim();
    const p2Input = document.getElementById('h2hPlayer2').value.trim();

    if (!p1Input || !p2Input) return;

    const container = document.getElementById('h2hResultContainer');
    container.innerHTML = `<div class="loading-state"><div class="loading-spinner"></div><p>Caricamento H2H...</p></div>`;

    // If we have player keys from quick H2H
    let p1Key = state.h2hPlayer1Key;
    let p2Key = state.h2hPlayer2Key;

    // Otherwise we'd need player search — for now use keys if set
    if (!p1Key || !p2Key) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⚠️</div>
          <div class="empty-title">Usa il pulsante H2H dalle partite</div>
          <p class="empty-text">Per ora, clicca il pulsante "🔄 H2H" da una partita del giorno per caricare il confronto diretto.</p>
        </div>`;
      return;
    }

    const data = await apiCall('get_H2H', {
      first_player_key: p1Key,
      second_player_key: p2Key,
    });

    if (data.success === 1 && data.result) {
      renderH2H(data.result, p1Input, p2Input);
    } else {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">❌</div>
          <div class="empty-title">H2H non disponibile</div>
          <p class="empty-text">Non sono stati trovati dati per questo confronto.</p>
        </div>`;
    }
  }

  function quickH2H(p1Key, p2Key, p1Name, p2Name) {
    state.h2hPlayer1Key = p1Key;
    state.h2hPlayer2Key = p2Key;
    document.getElementById('h2hPlayer1').value = p1Name;
    document.getElementById('h2hPlayer2').value = p2Name;
    switchTab('h2h');
    loadH2H();
  }

  function renderH2H(result, p1Name, p2Name) {
    const container = document.getElementById('h2hResultContainer');
    const h2hMatches = result.H2H || [];
    const p1Results = result.firstPlayerResults || [];
    const p2Results = result.secondPlayerResults || [];

    // Count H2H wins
    let p1Wins = 0, p2Wins = 0;
    h2hMatches.forEach(m => {
      if (m.event_winner === 'First Player') p1Wins++;
      else if (m.event_winner === 'Second Player') p2Wins++;
    });

    // Recent form
    const p1Form = p1Results.slice(0, 5);
    const p2Form = p2Results.slice(0, 5);

    container.innerHTML = `
      <!-- H2H Summary -->
      <div class="h2h-summary">
        <div class="h2h-player">
          <div class="h2h-player-name">${p1Name}</div>
          <div class="h2h-player-wins">${p1Wins}</div>
          <div style="font-size:0.8rem; color:var(--text-muted)">vittorie</div>
        </div>
        <div class="h2h-divider">
          <div class="h2h-vs-label">VS</div>
          <div class="h2h-total">${h2hMatches.length} match</div>
        </div>
        <div class="h2h-player">
          <div class="h2h-player-name">${p2Name}</div>
          <div class="h2h-player-wins">${p2Wins}</div>
          <div style="font-size:0.8rem; color:var(--text-muted)">vittorie</div>
        </div>
      </div>

      <!-- H2H Match History -->
      ${h2hMatches.length > 0 ? `
        <h3 style="font-size:1rem; font-weight:600; margin:1.5rem 0 1rem; color:var(--text-secondary);">📜 Precedenti diretti</h3>
        <div class="match-grid">
          ${h2hMatches.slice(0, 10).map(m => renderH2HMatchRow(m)).join('')}
        </div>
      ` : '<p style="color:var(--text-muted); text-align:center; padding:2rem;">Nessun precedente diretto trovato.</p>'}

      <!-- Recent Form P1 -->
      <h3 style="font-size:1rem; font-weight:600; margin:1.5rem 0 1rem; color:var(--text-secondary);">📊 Ultime partite di ${p1Name}</h3>
      <div class="match-grid">
        ${p1Form.map(m => renderFormRow(m)).join('')}
      </div>

      <!-- Recent Form P2 -->
      <h3 style="font-size:1rem; font-weight:600; margin:1.5rem 0 1rem; color:var(--text-secondary);">📊 Ultime partite di ${p2Name}</h3>
      <div class="match-grid">
        ${p2Form.map(m => renderFormRow(m)).join('')}
      </div>
    `;
  }

  function renderH2HMatchRow(match) {
    const scoreStr = match.scores ? match.scores.map(s => `${s.score_first}-${s.score_second}`).join(' ') : match.event_final_result || '';
    return `
      <div class="match-card" style="padding:0.8rem 1rem;">
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.82rem;">
          <span style="color:var(--text-muted); font-family:var(--font-mono); font-size:0.72rem;">${match.event_date || ''}</span>
          <span style="color:var(--text-dim); font-size:0.72rem;">${match.tournament_name || ''}</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px;">
          <span class="player-name ${match.event_winner === 'First Player' ? 'winner' : ''}" style="font-size:0.88rem;">${match.event_first_player}</span>
          <span style="font-family:var(--font-mono); color:var(--text-secondary); font-size:0.82rem;">${scoreStr}</span>
          <span class="player-name ${match.event_winner === 'Second Player' ? 'winner' : ''}" style="font-size:0.88rem;">${match.event_second_player}</span>
        </div>
      </div>`;
  }

  function renderFormRow(match) {
    const isWinP1 = match.event_winner === 'First Player';
    return `
      <div class="match-card" style="padding:0.7rem 1rem;">
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.8rem;">
          <span style="color:var(--text-muted); font-family:var(--font-mono); font-size:0.7rem;">${match.event_date || ''}</span>
          <span style="color:var(--text-dim); font-size:0.7rem;">${match.tournament_name || ''}</span>
          <span style="font-size:0.7rem; color:${isWinP1 ? 'var(--win)' : 'var(--lose)'}; font-weight:600;">
            ${match.event_final_result || '-'}
          </span>
        </div>
        <div style="margin-top:4px; font-size:0.82rem;">
          <span class="${isWinP1 ? 'winner' : ''}" style="color:${isWinP1 ? 'var(--accent)' : 'var(--text-primary)'}">${match.event_first_player}</span>
          <span style="color:var(--text-dim);"> vs </span>
          <span class="${!isWinP1 ? 'winner' : ''}" style="color:${!isWinP1 ? 'var(--accent)' : 'var(--text-primary)'}">${match.event_second_player}</span>
        </div>
      </div>`;
  }

  // ════════════════════════════════════════════
  //  RANKINGS
  // ════════════════════════════════════════════

  async function loadRankings() {
    const container = document.getElementById('rankingsContainer');
    container.innerHTML = `<div class="loading-state"><div class="loading-spinner"></div><p>Caricamento classifiche...</p></div>`;

    const eventTypeKey = state.rankingType === 'atp' ? CONFIG.EVENT_TYPES.ATP_SINGLES : CONFIG.EVENT_TYPES.WTA_SINGLES;

    const data = await apiCall('get_standings', { event_type_key: eventTypeKey });

    if (data.success === 1 && data.result && data.result.length > 0) {
      renderRankings(data.result);
    } else {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🏆</div>
          <div class="empty-title">Classifiche non disponibili</div>
          <p class="empty-text">Impossibile caricare le classifiche. Riprova più tardi.</p>
        </div>`;
    }
  }

  function renderRankings(standings) {
    const container = document.getElementById('rankingsContainer');

    // API returns standings — adapt to their structure
    // Structure may be: [{player_name, player_key, place, points, ...}]
    const players = standings.slice(0, 100); // top 100

    container.innerHTML = `
      <table class="rankings-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Giocatore</th>
            <th>Punti</th>
            <th>Torneo</th>
          </tr>
        </thead>
        <tbody>
          ${players.map((p, i) => {
            const rank = p.place || p.team_rank || (i + 1);
            const name = p.player_name || p.team_name || p.first_player || '-';
            const points = p.points || p.team_points || '-';
            const tournament = p.tournament_name || p.season || '';

            return `
              <tr>
                <td><span class="rank-number ${rank <= 3 ? 'top-3' : ''}">${rank}</span></td>
                <td>
                  <div class="player-cell">
                    <span>${name}</span>
                  </div>
                </td>
                <td><span class="stat-mono">${points}</span></td>
                <td style="color:var(--text-dim); font-size:0.78rem;">${tournament}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  }

  // ─── Utilities ───
  function toggleExpand(btn) {
    const card = btn.closest('.match-card');
    card.classList.toggle('expanded');
    btn.textContent = card.classList.contains('expanded') ? '▴ Chiudi dettagli' : '▾ Dettagli fattori';
  }

  function escapeHtml(str) {
    return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
  }

  // ─── Public API ───
  return {
    init,
    loadH2H,
    quickH2H,
    toggleExpand,
    switchTab,
  };

})();

// Boot
document.addEventListener('DOMContentLoaded', TennisPro.init);
