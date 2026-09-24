(() => {
  'use strict';
  const config = window.AI_TRADING_LAB_CONFIG || {};
  const API_BASE_URL = String(config.apiBaseUrl || '').replace(/\/$/, '');
  const mode = API_BASE_URL || config.mode === 'api' ? 'api' : config.mode === 'mock' ? 'mock' : 'unconfigured';
  const $ = (selector, root = document) => root.querySelector(selector);
  const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
  const mockDecision = (id, decision, confidence, price, time, reason) => ({ id, symbol: 'BTC/USDT', timeframe: '5m', decision, confidence, price, entry: null, stopLoss: null, takeProfit: null, reason, indicators: {}, candles: [], createdAt: new Date(Date.now() - id * 300000).toISOString() });
  const demo = {
    dashboard: { mode: 'DRY_RUN', latestDecision: mockDecision(1, 'HOLD', .67, 81298, '09:30', 'Current context does not show sufficient confirmation for an entry.'), openTrades: 0, market: { symbol: 'BTC/USDT', price: 81298, change24h: .0042 }, balance: { total: 1000, currency: 'USDT' } },
    decisions: [mockDecision(1, 'HOLD', .67, 81298, '09:30', 'Current context does not show sufficient confirmation for an entry.'), mockDecision(2, 'BUY', .78, 81240, '09:25', 'Illustrative demo record.'), mockDecision(3, 'HOLD', .61, 81185, '09:20', 'Illustrative demo record.')],
    trades: []
  };
  async function request(path, options) {
    let response;
    try { response = await fetch(API_BASE_URL + path, { headers: { 'Content-Type': 'application/json' }, ...options }); }
    catch { throw new Error('Cannot reach API. Check the API URL and CORS configuration.'); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `API request failed (${response.status})`);
    return data;
  }
  const apiService = {
    dashboard: () => request('/api/dashboard'), latest: () => request('/api/ai/decisions/latest'),
    decisions: () => request('/api/ai/decisions'), trades: () => request('/api/trades'),
    health: () => request('/health'), analyze: (symbol, timeframe) => request('/api/ai/analyze', { method: 'POST', body: JSON.stringify({ symbol, timeframe }) })
  };
  const services = mode === 'api' ? apiService : mode === 'mock' ? {
    dashboard: async () => demo.dashboard, latest: async () => demo.dashboard.latestDecision,
    decisions: async () => demo.decisions, trades: async () => demo.trades,
    health: async () => ({ api: 'demo', database: 'demo' }),
    analyze: async () => { await new Promise(resolve => setTimeout(resolve, 550)); throw new Error('Analysis is unavailable in demo mode. Configure a backend to analyze.'); }
  } : null;
  let stateBanner;
  function setState(state, message = '') { if (!stateBanner) { stateBanner = el('div', undefined, 'state-banner'); stateBanner.id = 'loadState'; $('.page-head').after(stateBanner); } stateBanner.className = `state-banner ${state}`; stateBanner.textContent = message; stateBanner.style.display = message ? 'block' : 'none'; }
  function setSource(label, live = false, demoMode = false) { const badge = $('#dataMode'); if (badge) { badge.textContent = label; badge.className = `dry ${live ? 'source-tag live' : demoMode ? 'source-tag demo' : ''}`; } }
  function setText(selector, value, formatter = String) { const node = $(selector); if (node) { node.textContent = value === null || value === undefined || value === '' ? 'N/A' : formatter(value); node.classList.toggle('na', value === null || value === undefined || value === ''); } }
  function percent(value) { return `${(Number(value) * 100).toFixed(0)}%`; }
  function money(value) { return `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
  function dateTime(value) { if (!value) return 'N/A'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'N/A' : date.toLocaleString(); }
  function badge(decision) { const node = el('span', decision || 'N/A', `badge ${decision === 'BUY' ? 'buy' : decision === 'SELL' ? 'sell' : 'hold'}`); return node; }
  function makeCell(row, text, className) { const td = el('td', text == null || text === '' ? '—' : String(text), className); row.appendChild(td); return td; }
  function renderDecisions(rows, failed = false) {
    const body = $('#view-AI Decisions tbody'); if (!body) return; body.replaceChildren();
    if (!rows?.length) { const tr = el('tr'); const td = el('td', failed ? 'Unable to load AI decisions.' : 'No AI decisions yet.', 'row-empty'); td.colSpan = 9; tr.appendChild(td); body.appendChild(tr); return; }
    for (const item of rows) { const tr = el('tr'); makeCell(tr, dateTime(item.createdAt), 'mono'); makeCell(tr, item.symbol); makeCell(tr, item.price == null ? 'N/A' : Number(item.price).toLocaleString('en-US'), 'mono'); const d = el('td'); d.appendChild(badge(item.decision)); tr.appendChild(d); makeCell(tr, item.confidence == null ? 'N/A' : percent(item.confidence), 'mono'); makeCell(tr, item.entry); makeCell(tr, item.stopLoss); makeCell(tr, item.takeProfit); makeCell(tr, item.reason); body.appendChild(tr); }
  }
  function renderTrades(rows, failed = false) {
    const host = $('#view-Trades .card'); if (!host) return; host.replaceChildren();
    const wrap = el('div', undefined, 'table-wrap'); const table = el('table', undefined, 'table');
    const head = el('thead'); const hr = el('tr'); for (const label of ['ID','SYMBOL','SIDE','ENTRY','EXIT','AMOUNT','PNL','OPEN TIME','CLOSE TIME','STATUS']) hr.appendChild(el('th', label)); head.appendChild(hr); table.appendChild(head);
    const body = el('tbody');
    if (!rows?.length) { const tr = el('tr'); const td = el('td', failed ? 'Unable to load simulated trades.' : 'No simulated trades yet.', 'row-empty'); td.colSpan = 10; tr.appendChild(td); body.appendChild(tr); }
    else for (const trade of rows) { const tr = el('tr'); for (const value of [trade.id, trade.symbol, trade.side, trade.entry, trade.exit, trade.amount, trade.pnl, dateTime(trade.openedAt), dateTime(trade.closedAt), trade.status]) makeCell(tr, value, 'mono'); body.appendChild(tr); }
    table.appendChild(body); wrap.appendChild(table); host.appendChild(wrap); host.appendChild(el('p', 'SIMULATED TRADES · No real orders are placed.', 'disclaimer'));
  }
  function renderLatest(item) {
    const decision = item?.decision ?? null; setText('#decision', decision); setText('#metricDecision', decision); setText('#confidence', item?.confidence, percent); setText('#metricConfidence', item?.confidence, percent);
    setText('#reason', item?.reason); setText('#decisionTimestamp', item?.createdAt, value => `RECORDED ${dateTime(value)}`);
    setText('#decisionEntry', item?.entry); setText('#decisionStop', item?.stopLoss); setText('#decisionTarget', item?.takeProfit);
    const badgeNode = $('#decisionBadge'); if (badgeNode) { badgeNode.textContent = decision || 'N/A'; badgeNode.className = `badge ${decision === 'BUY' ? 'buy' : decision === 'SELL' ? 'sell' : 'hold'}`; }
    const bar = $('#confidenceBar'); if (bar) bar.style.width = item?.confidence == null ? '0%' : `${Math.max(0, Math.min(1, Number(item.confidence))) * 100}%`;
    const analysis = document.getElementById('view-AI Analysis')?.querySelector('.empty');
    if (analysis) { analysis.replaceChildren(); const title = el('b', decision ? `${decision} · ${percent(item.confidence)}` : 'No AI decisions yet'); if (decision) title.className = decision === 'BUY' ? 'positive' : decision === 'SELL' ? 'negative' : 'amber'; analysis.append(title, el('br'), el('br'), el('span', item?.reason || 'No analysis has been recorded.'), el('br'), el('br'), el('span', dateTime(item?.createdAt))); }
  }
  function markUnavailable() {
    setText('#price', null); setText('#change24h', null); setText('#openTrades', null); setText('#balance', null);
    setText('#decision', null); setText('#metricDecision', null); setText('#confidence', null); setText('#metricConfidence', null); setText('#reason', null); setText('#decisionTimestamp', null); setText('#decisionEntry', null); setText('#decisionStop', null); setText('#decisionTarget', null);
    document.querySelectorAll('.ind b').forEach(node => { node.textContent = 'N/A'; node.classList.add('na'); });
    const foot = $('.metric .foot'); if (foot) foot.textContent = 'NO MARKET PROVIDER CONNECTED';
    const chartCaption = $('.chart-card .card-sub'); if (chartCaption) chartCaption.textContent = 'NO MARKET PROVIDER CONNECTED';
    const placeholder = $('.chart-placeholder'); if (placeholder) placeholder.textContent = 'NO LIVE MARKET DATA';
    renderLatest(null); renderDecisions([]); renderTrades([]);
  }
  async function loadData() {
    if (mode === 'unconfigured') { setSource('NOT CONFIGURED'); setState('error', 'API not configured. Set outputs/config.js to connect a backend, or explicitly enable mock mode for development.'); markUnavailable(); return; }
    if (mode === 'mock') {
      setSource('DEMO DATA', false, true); setState('success', 'DEMO DATA · Illustrative values only; no live market feed is connected.');
      const d = demo.dashboard; setText('#price', d.market.price, money); setText('#change24h', d.market.change24h, v => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`); setText('#openTrades', d.openTrades); setText('#balance', d.balance.total, money);
      renderLatest(d.latestDecision); renderDecisions(demo.decisions); renderTrades(demo.trades);
      const health = $('.status'); if (health) health.innerHTML = '<i class="dot"></i> DEMO MODE';
      return;
    }
    setSource('CONNECTING'); setState('loading', 'Loading dashboard and activity from API…');
    const results = await Promise.allSettled([services.dashboard(), services.latest(), services.decisions(), services.trades(), services.health()]);
    const [dashboard, latest, decisions, trades, health] = results;
    if (dashboard.status === 'fulfilled') {
      const data = dashboard.value; setSource('LIVE DATA', true); setText('#openTrades', data.openTrades);
      setText('#price', data.market?.price, money); setText('#change24h', data.market?.change24h, v => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`);
      setText('#balance', data.balance?.total, money);
      if (data.latestDecision) renderLatest(data.latestDecision); else renderLatest(null);
      const foot = $('.metric .foot'); if (foot) foot.textContent = data.market ? 'LIVE DATA · BACKEND' : 'N/A · MARKET PROVIDER NOT CONNECTED';
      const chartCaption = $('.chart-card .card-sub'); if (chartCaption) chartCaption.textContent = data.market ? 'MARKET DATA FROM BACKEND' : 'NO MARKET PROVIDER CONNECTED';
    } else { setSource('API ERROR'); ['#price','#change24h','#openTrades','#balance'].forEach(selector => setText(selector, null)); }
    if (latest.status === 'fulfilled') renderLatest(latest.value);
    if (decisions.status === 'fulfilled') renderDecisions(decisions.value); else renderDecisions([], true);
    if (trades.status === 'fulfilled') renderTrades(trades.value); else renderTrades([], true);
    const healthNode = $('.status');
    if (healthNode) healthNode.innerHTML = health.status === 'fulfilled' && health.value.api === 'ok' && health.value.database === 'ok' ? '<i class="dot"></i> SYSTEM ONLINE' : '<i class="dot"></i> API / DB ISSUE';
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) setState('error', `API data is incomplete (${failures.length} request${failures.length === 1 ? '' : 's'} failed). Mock values are not substituted. ${failures[0].reason?.message || ''}`);
    else setState('success', 'LIVE DATA · Loaded from the configured backend API. Market price and balance show N/A until those providers are connected.');
  }
  function selectedSymbol() { const select = $('#view-Market select'); return (select?.value || 'BTC / USDT').replaceAll(' ', ''); }
  function selectedTimeframe() { return $('#timeframes button.selected')?.textContent?.trim() || '5m'; }

  document.querySelectorAll('#nav button,.nav-jump').forEach(button => button.addEventListener('click', () => {
    const page = button.dataset.page; document.querySelectorAll('.page-view').forEach(view => view.classList.toggle('active', view.id === `view-${page}`));
    document.querySelectorAll('#nav button').forEach(nav => nav.classList.toggle('active', nav.dataset.page === page));
    $('#breadcrumb').textContent = page; $('#sidebar').classList.remove('open'); window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
  $('#menu').onclick = () => $('#sidebar').classList.toggle('open');
  document.querySelectorAll('#timeframes button').forEach(button => button.addEventListener('click', () => { document.querySelectorAll('#timeframes button').forEach(item => item.classList.remove('selected')); button.classList.add('selected'); }));
  let toastTimer; function toast(message) { const node = $('#toast'); node.textContent = message; node.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('show'), 3500); }
  $('#refresh').onclick = async event => { const button = event.currentTarget; button.disabled = true; button.textContent = '↻  Loading…'; await loadData(); button.disabled = false; button.textContent = '↻  Refresh'; };
  document.querySelectorAll('.analyze').forEach(button => button.addEventListener('click', async () => {
    if (mode !== 'api') { toast(mode === 'mock' ? 'Demo mode: configure a backend API to request analysis.' : 'Configure the backend API before requesting analysis.'); return; }
    const buttons = [...document.querySelectorAll('.analyze')]; buttons.forEach(item => { item.disabled = true; item.textContent = 'Analyzing market…'; });
    setState('loading', `Analyzing ${selectedSymbol()} on ${selectedTimeframe()}…`);
    try {
      const result = await services.analyze(selectedSymbol(), selectedTimeframe());
      renderLatest(result); await loadData(); toast('Analysis recorded by the backend.');
    } catch (error) { setState('error', error.message || 'Analysis request failed.'); toast(error.message || 'Analysis request failed.'); }
    finally { buttons.forEach(item => { item.disabled = false; item.innerHTML = '✳ &nbsp;Analyze now'; }); }
  }));
  const refresh = $('#refresh'); if (refresh) refresh.setAttribute('aria-label', 'Refresh dashboard data');
  loadData();
})();
