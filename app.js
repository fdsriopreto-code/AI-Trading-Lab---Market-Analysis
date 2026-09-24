(() => {
  'use strict';
  const config = window.AI_TRADING_LAB_CONFIG || {};
  const API_BASE_URL = String(config.apiBaseUrl || '').replace(/\/$/, '');
  const mode = API_BASE_URL || config.mode === 'api' ? 'api' : config.mode === 'mock' ? 'mock' : 'unconfigured';
  const t = (text, values) => window.AITradingLabI18n?.t(text, values) ?? text;
  const locale = () => window.AITradingLabI18n?.language === 'en' ? 'en-US' : 'pt-BR';
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
    config: () => request('/api/config'),
    candles: (symbol,timeframe,limit=100) => request(`/api/market/${encodeURIComponent(symbol.replace('/','-'))}/candles?timeframe=${encodeURIComponent(timeframe)}&limit=${limit}`),
    dashboard: () => request('/api/dashboard'), latest: () => request('/api/ai/decisions/latest'),
    decisions: () => request('/api/ai/decisions'), trades: () => request('/api/trades'), learning: () => request('/api/paper/learning'),
    health: () => request('/health'), markets: () => request('/api/markets'), automation: () => request('/api/automation'),
    saveAutomation: (body) => request('/api/automation/settings', { method: 'PUT', body: JSON.stringify(body) }),
    runAutomation: (body = {}) => request('/api/automation/run', { method: 'POST', body: JSON.stringify(body) }),
    job: (id) => request(`/api/analysis/jobs/${encodeURIComponent(id)}`),
    analyze: (symbol, timeframe) => request('/api/ai/analyze', { method: 'POST', body: JSON.stringify({ symbol, timeframe }) }),
    analyzeAll: (timeframe) => request('/api/ai/analyze/all', { method: 'POST', body: JSON.stringify({ timeframe }) })
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
  function money(value) { return `$${Number(value).toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
  function dateTime(value) { if (!value) return 'N/A'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'N/A' : date.toLocaleString(locale()); }
  function badge(decision) { const node = el('span', decision || 'N/A', `badge ${decision === 'BUY' ? 'buy' : decision === 'SELL' ? 'sell' : 'hold'}`); return node; }
  function makeCell(row, text, className) { const td = el('td', text == null || text === '' ? '—' : String(text), className); row.appendChild(td); return td; }
  function renderRecentDecisions(rows, failed = false) {
    const body=$('#recentDecisions'); if(!body) return; body.replaceChildren();
    if(!rows?.length) { const tr=el('tr'); const td=el('td',failed?'Unable to load AI decisions.':'No AI decisions yet.','row-empty'); td.colSpan=5; tr.appendChild(td); body.appendChild(tr); return; }
    for(const item of rows.slice(0,5)) { const tr=el('tr'); makeCell(tr,dateTime(item.createdAt),'mono'); makeCell(tr,item.symbol); makeCell(tr,item.price==null?'N/A':Number(item.price).toLocaleString(locale()),'mono'); const d=el('td'); d.appendChild(badge(item.decision)); tr.appendChild(d); makeCell(tr,item.confidence==null?'N/A':percent(item.confidence),'mono'); body.appendChild(tr); }
  }
  function renderDecisions(rows, failed = false) {
    renderRecentDecisions(rows, failed);
    const body = $('#view-AI Decisions tbody'); if (!body) return; body.replaceChildren();
    if (!rows?.length) { const tr = el('tr'); const td = el('td', failed ? 'Unable to load AI decisions.' : 'No AI decisions yet.', 'row-empty'); td.colSpan = 9; tr.appendChild(td); body.appendChild(tr); return; }
    for (const item of rows) { const tr = el('tr'); makeCell(tr, dateTime(item.createdAt), 'mono'); makeCell(tr, item.symbol); makeCell(tr, item.price == null ? 'N/A' : Number(item.price).toLocaleString(locale()), 'mono'); const d = el('td'); d.appendChild(badge(item.decision)); tr.appendChild(d); makeCell(tr, item.confidence == null ? 'N/A' : percent(item.confidence), 'mono'); makeCell(tr, item.entry); makeCell(tr, item.stopLoss); makeCell(tr, item.takeProfit); makeCell(tr, item.reason); body.appendChild(tr); }
  }
  function renderTrades(rows, failed = false) {
    const host = $('#tradesTable'); if (!host) return; host.replaceChildren();
    const wrap = el('div', undefined, 'table-wrap'); const table = el('table', undefined, 'table');
    const head = el('thead'); const hr = el('tr'); for (const label of ['ID','SYMBOL','SIDE','ENTRY','LAST','EXIT','QUANTITY','PNL','FEES','OPEN TIME','CLOSE TIME','STATUS']) hr.appendChild(el('th', label)); head.appendChild(hr); table.appendChild(head);
    const body = el('tbody');
    if (!rows?.length) { const tr = el('tr'); const td = el('td', failed ? 'Unable to load simulated trades.' : 'No simulated trades yet.', 'row-empty'); td.colSpan = 12; tr.appendChild(td); body.appendChild(tr); }
    else for (const trade of rows) { const tr = el('tr'); for (const value of [trade.id, trade.symbol, trade.side, trade.entry, trade.lastPrice, trade.exit, trade.amount, trade.pnl, Number(trade.entryFee || 0) + Number(trade.exitFee || 0), dateTime(trade.openedAt), dateTime(trade.closedAt), trade.status === 'open' ? 'OPEN' : trade.closeReason || 'CLOSED']) makeCell(tr, value, 'mono'); body.appendChild(tr); }
    table.appendChild(body); wrap.appendChild(table); host.appendChild(wrap); host.appendChild(el('p', 'SIMULATED TRADES · No real orders are placed.', 'disclaimer'));
  }
  function renderPortfolio(paper) {
    const host = $('#portfolioSummary'); if (!host || !paper) return;
    host.replaceChildren();
    const head = el('div', undefined, 'card-head'); head.append(el('div', 'Paper portfolio', 'card-title'), el('span', 'USDT · SIMULATED', 'dry')); host.appendChild(head);
    const grid = el('div', undefined, 'metrics');
    const metrics = [['Equity', money(paper.equity)], ['Cash available', money(paper.cashBalance)], ['Realized PnL', money(paper.realizedPnl)], ['Unrealized PnL', money(paper.unrealizedPnl)], ['Return', percent(paper.returnPct)], ['Drawdown', percent(paper.drawdownPct)], ['Open positions', String(paper.openPositions)], ['Closed trades', String(paper.closedTrades)]];
    for (const [label,value] of metrics) { const card=el('div',undefined,'metric'); card.append(el('div',label,'metric-top'),el('div',value,'value')); grid.appendChild(card); }
    host.appendChild(grid);
    host.appendChild(el('p',t('Limits: {trade}% max per entry · {exposure}% max exposure · {positions} positions · {drawdown}% drawdown stop. Fees: {fees}%.',{trade:(paper.settings.maxTradePct*100).toFixed(0),exposure:(paper.settings.maxExposurePct*100).toFixed(0),positions:paper.settings.maxOpenTrades,drawdown:(paper.settings.maxDrawdownPct*100).toFixed(0),fees:(paper.settings.feeRate*100).toFixed(2)}),'disclaimer'));
  }
  function renderLearning(data) {
    const host=$('#learningSummary'); if(!host || !data) return; host.replaceChildren();
    host.appendChild(el('p',t('Forward labels after {count} candles · {samples} evaluated BUY/SELL decisions. Minimum sample for interpretation: {minimum}.',{count:data.horizonCandles,samples:data.totalEvaluatedDecisions,minimum:data.minimumSampleForInterpretation}),'sub'));
    if(!data.byMarket?.length) { host.appendChild(el('p','No outcomes evaluated yet. New analyses must include market candles, and the configured forward horizon must pass.','row-empty')); return; }
    const wrap=el('div',undefined,'table-wrap'); const table=el('table',undefined,'table'); const thead=el('thead'); const trh=el('tr');
    for(const title of ['SYMBOL','TIMEFRAME','SAMPLE','FAVORABLE','UNFAVORABLE','FLAT','AVG. DIRECTIONAL RETURN']) trh.appendChild(el('th',title)); thead.appendChild(trh); table.appendChild(thead);
    const body=el('tbody'); for(const row of data.byMarket) { const tr=el('tr'); for(const value of [row.symbol,row.timeframe,row.sampleCount,row.favorable,row.unfavorable,row.flat,row.avgDirectionalReturn===null?'N/A':percent(row.avgDirectionalReturn)]) makeCell(tr,value,'mono'); body.appendChild(tr); }
    table.appendChild(body); wrap.appendChild(table); host.appendChild(wrap);
    host.appendChild(el('p',data.sufficientSample?'Forward outcomes are available for analysis. They are not a guarantee of future performance.':'Small sample: treat these results as exploratory, not evidence of a reliable edge.','disclaimer'));
  }
  function renderLatest(item) {
    const decision = item?.decision ?? null; setText('#decision', decision); setText('#metricDecision', decision); setText('#confidence', item?.confidence, percent); setText('#metricConfidence', item?.confidence, percent);
    setText('#reason', item?.reason); setText('#decisionTimestamp', item?.createdAt, value => t('RECORDED {date}', { date: dateTime(value) }));
    setText('#decisionEntry', item?.entry); setText('#decisionStop', item?.stopLoss); setText('#decisionTarget', item?.takeProfit);
    const badgeNode = $('#decisionBadge'); if (badgeNode) { badgeNode.textContent = decision || 'N/A'; badgeNode.className = `badge ${decision === 'BUY' ? 'buy' : decision === 'SELL' ? 'sell' : 'hold'}`; }
    const bar = $('#confidenceBar'); if (bar) bar.style.width = item?.confidence == null ? '0%' : `${Math.max(0, Math.min(1, Number(item.confidence))) * 100}%`;
    const analysis = document.getElementById('view-AI Analysis')?.querySelector('.empty');
    if (analysis) { analysis.replaceChildren(); const title = el('b', decision ? `${decision} · ${percent(item.confidence)}` : 'No AI decisions yet'); if (decision) title.className = decision === 'BUY' ? 'positive' : decision === 'SELL' ? 'negative' : 'amber'; analysis.append(title, el('br'), el('br'), el('span', item?.reason || 'No analysis has been recorded.'), el('br'), el('br'), el('span', dateTime(item?.createdAt))); }
  }
  function renderMarketChart(data){
    const svg=$('#chart');if(!svg)return;svg.replaceChildren();const rows=data?.candles||[];const placeholder=$('.chart-placeholder');
    if(!rows.length){if(placeholder){placeholder.textContent=t('No stored market candles yet. Run an AI collection cycle.');placeholder.style.display='flex';}return;}
    if(placeholder)placeholder.style.display='none';
    const candles=rows.slice(-60).filter(c=>Number.isFinite(Number(c.close))&&Number.isFinite(Number(c.high))&&Number.isFinite(Number(c.low)));if(!candles.length)return;
    const width=760,height=225,pad=10,min=Math.min(...candles.map(c=>Number(c.low))),max=Math.max(...candles.map(c=>Number(c.high))),range=max-min||1,step=(width-pad*2)/candles.length,bodyWidth=Math.max(3,Math.min(9,step*.58)),ns='http://www.w3.org/2000/svg';
    candles.forEach((c,i)=>{const x=pad+i*step+step/2,open=Number(c.open??c.close),close=Number(c.close),high=Number(c.high),low=Number(c.low),y=value=>height-pad-(value-min)/range*(height-pad*2),up=close>=open,color=up?'#56d39b':'#f07878';const wick=document.createElementNS(ns,'line');wick.setAttribute('x1',x);wick.setAttribute('x2',x);wick.setAttribute('y1',y(high));wick.setAttribute('y2',y(low));wick.setAttribute('stroke',color);wick.setAttribute('stroke-width','1.4');svg.appendChild(wick);const rect=document.createElementNS(ns,'rect');rect.setAttribute('x',x-bodyWidth/2);rect.setAttribute('y',Math.min(y(open),y(close)));rect.setAttribute('width',bodyWidth);rect.setAttribute('height',Math.max(1,Math.abs(y(open)-y(close))));rect.setAttribute('rx','1');rect.setAttribute('fill',color);svg.appendChild(rect);});
    const first=candles[0],last=candles.at(-1),labels=$$('.chart-foot span');if(labels.length){labels.forEach((label,index)=>label.textContent=index===0?new Date(first.date).toLocaleDateString(locale()):index===labels.length-1?new Date(last.date).toLocaleTimeString(locale()):'');}for(const [id,value] of [['chartOpen',last.open],['chartHigh',last.high],['chartLow',last.low],['chartClose',last.close]])setText(`#${id}`,value,money);
    const marketLabel=$('#chartMarketLabel');if(marketLabel)marketLabel.textContent=`${data.symbol} · ${data.timeframe}`;
    const points=[['indicatorRsi','rsi',v=>Number(v).toFixed(2)],['indicatorAdx','adx',v=>Number(v).toFixed(2)],['indicatorMfi','mfi',v=>Number(v).toFixed(2)],['indicatorMacd','macd',v=>Number(v).toFixed(4)],['indicatorMacdHist','macdhist',v=>Number(v).toFixed(4)],['indicatorTema','tema',money],['indicatorBollinger','bb_middleband',money],['indicatorVolume','volume',v=>Number(v).toLocaleString(locale())]];
    for(const [id,key,format] of points){const node=$(`#${id}`);if(node){node.textContent=last[key]==null?'N/A':format(last[key]);node.classList.toggle('na',last[key]==null);}}
  }
  function $$(selector,root=document){return [...root.querySelectorAll(selector)];}
  function renderMarketHistoryTable(data){const body=$('#marketCandlesRows');if(!body||!data)return;body.replaceChildren();const rows=[...(data.candles||[])].slice(-30).reverse();if(!rows.length){const tr=el('tr');const td=el('td',t('No stored market candles yet.'),'row-empty');td.colSpan=7;tr.appendChild(td);body.appendChild(tr);return;}for(const candle of rows){const tr=el('tr');for(const value of [dateTime(candle.date),candle.open,candle.high,candle.low,candle.close,candle.volume,candle.rsi])makeCell(tr,value,'mono');body.appendChild(tr);}}
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
    const results = await Promise.allSettled([services.dashboard(), services.latest(), services.decisions(), services.trades(), services.health(), services.learning(),services.candles(selectedSymbol(),selectedTimeframe())]);
    const [dashboard, latest, decisions, trades, health, learning,marketCandles] = results;
    if(marketCandles.status==='fulfilled'){renderMarketChart(marketCandles.value);renderMarketHistoryTable(marketCandles.value);}
    if (dashboard.status === 'fulfilled') {
      const data = dashboard.value; setSource('LIVE DATA', true); setText('#openTrades', data.openTrades);
      setText('#price', data.market?.price, money); setText('#change24h', data.market?.change24h, v => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`);
      setText('#balance', data.balance?.total, money); renderPortfolio(data.portfolio);
      if (data.latestDecision) renderLatest(data.latestDecision); else renderLatest(null);
      const foot = $('.metric .foot'); if (foot) foot.textContent = data.market ? 'LIVE DATA · BACKEND' : 'N/A · MARKET PROVIDER NOT CONNECTED';
      const chartCaption = $('.chart-card .card-sub'); if (chartCaption) chartCaption.textContent = data.market ? 'MARKET DATA FROM BACKEND' : 'NO MARKET PROVIDER CONNECTED';
    } else { setSource('API ERROR'); ['#price','#change24h','#openTrades','#balance'].forEach(selector => setText(selector, null)); }
    if (latest.status === 'fulfilled') renderLatest(latest.value);
    if (decisions.status === 'fulfilled') renderDecisions(decisions.value); else renderDecisions([], true);
    if (trades.status === 'fulfilled') renderTrades(trades.value); else renderTrades([], true);
    if (learning.status === 'fulfilled') renderLearning(learning.value);
    const healthNode = $('.status');
    if (healthNode) healthNode.innerHTML = health.status === 'fulfilled' && health.value.api === 'ok' && health.value.database === 'ok' ? `<i class="dot"></i> ${t('SYSTEM ONLINE')}` : `<i class="dot"></i> ${t('API / DB ISSUE')}`;
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) setState('error', t('API data is incomplete ({count} request(s) failed). Mock values are not substituted. {error}', { count: failures.length, error: failures[0].reason?.message || '' }));
    else setState('success', 'PAPER TRADING · Analyses and simulated portfolio loaded from PostgreSQL. Prices update when an analysis runs.');
  }
  function selectedSymbol() { const select = $('#marketSymbol'); return (select?.value || 'BTC/USDT').replaceAll(' ', ''); }
  function selectedTimeframe() { return $('#timeframes button.selected')?.textContent?.trim() || '5m'; }

  document.querySelectorAll('#nav button,.nav-jump').forEach(button => button.addEventListener('click', () => {
    const page = button.dataset.page; document.querySelectorAll('.page-view').forEach(view => view.classList.toggle('active', view.id === `view-${page}`));
    document.querySelectorAll('#nav button').forEach(nav => nav.classList.toggle('active', nav.dataset.page === page));
    $('#breadcrumb').textContent = page; $('#sidebar').classList.remove('open'); window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
  $('#menu').onclick = () => $('#sidebar').classList.toggle('open');
  $('#marketSymbol')?.addEventListener('change',()=>{if(mode==='api')loadData();});
  document.querySelectorAll('#timeframes button').forEach(button => button.addEventListener('click', () => { document.querySelectorAll('#timeframes button').forEach(item => item.classList.remove('selected')); button.classList.add('selected');if(mode==='api')loadData(); }));
  let toastTimer; function toast(message) { const node = $('#toast'); node.textContent = message; node.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('show'), 3500); }
  $('#refresh').onclick = async event => { const button = event.currentTarget; button.disabled = true; button.textContent = '↻  Loading…'; await loadData(); button.disabled = false; button.textContent = '↻  Refresh'; };
  function renderQueue(snapshot) {
    if (!snapshot) return;
    for (const status of ['pending','processing','completed','failed']) setText(`#queue${status[0].toUpperCase()+status.slice(1)}`, snapshot.counts?.[status] ?? 0);
    const settings=snapshot.settings||{};
    const badgeNode=$('#automationBadge'); if(badgeNode){badgeNode.textContent=settings.enabled?'SCHEDULE ACTIVE':'PAUSED';badgeNode.className=settings.enabled?'badge buy':'dry';}
    const status=$('#automationStatus'); if(status) status.textContent=settings.enabled?t('Next scan every {hours}h · {timeframe} · {days}d lookback',{hours:(settings.intervalMinutes/60).toLocaleString(locale()),timeframe:settings.timeframe,days:settings.historyDays}):t('Schedule paused · manual AI jobs remain available.');
    const last=$('#automationLastRun'); if(last) last.textContent=settings.lastEnqueuedAt?t('Last scheduled queue run: {date}',{date:dateTime(settings.lastEnqueuedAt)}):t('No scheduled cycle has run yet. Historical market data is stored before AI analysis.');
    const table=$('#analysisQueueRows'); if(table){table.replaceChildren();if(!snapshot.jobs?.length){const tr=el('tr');const td=el('td',t('No queued analyses yet.'),'row-empty');td.colSpan=7;tr.appendChild(td);table.appendChild(tr);}else for(const job of snapshot.jobs){const tr=el('tr');makeCell(tr,dateTime(job.createdAt),'mono');makeCell(tr,job.symbol);makeCell(tr,`${job.timeframe} · ${job.historyDays}d`,'mono');const s=el('td',t(job.status.toUpperCase()),`queue-status ${job.status}`);tr.appendChild(s);const decision=el('td');if(job.decision)decision.appendChild(badge(job.decision));else decision.textContent='—';tr.appendChild(decision);makeCell(tr,job.attempts,'mono');makeCell(tr,job.reason||job.error||job.paper_action||t(job.source),'queue-detail');table.appendChild(tr);}}
    const svc=snapshot.services||{};
    const setService=(selector,value)=>{const node=$(selector);if(node){node.textContent=String(value||'unknown').replaceAll('_',' ').toUpperCase();node.className=['online','configured'].includes(value)?'positive':['offline','error','not_configured'].includes(value)?'negative':'';}};
    setService('#queueFreqtradeStatus',svc.freqtrade?.status);setService('#queueAiStatus',svc.ai);setService('#queueDbStatus','online');
    const collector=$('#queueCollectorStatus');if(collector)collector.textContent=snapshot.counts?.processing?'BUSY':'READY';
  }
  let availableMarkets=[];
  async function loadMarketConfig() {
    if (mode !== 'api') return;
    try {
      const [config,markets,automation]=await Promise.all([services.config(),services.markets(),services.automation()]);
      availableMarkets=markets.symbols?.length?markets.symbols:(config.defaultSymbols||config.symbols||[]);
      const marketSelect=$('#marketSymbol');if(marketSelect){marketSelect.replaceChildren();for(const symbol of availableMarkets){const option=el('option',symbol);option.value=symbol;marketSelect.appendChild(option);}if(config.automation?.symbols?.[0])marketSelect.value=config.automation.symbols[0];}
      const list=$('#automationMarkets');if(list){list.replaceChildren();for(const symbol of availableMarkets){const label=el('label',undefined,'market-option');const input=document.createElement('input');input.type='checkbox';input.name='automationMarket';input.value=symbol;input.checked=(config.automation?.symbols||config.defaultSymbols||[]).includes(symbol);label.append(input,el('span',symbol));list.appendChild(label);}}
      const current=config.automation||{};const enabled=$('#automationEnabled');if(enabled)enabled.checked=!!current.enabled;
      const timeframe=$('#automationTimeframe');if(timeframe)timeframe.value=current.timeframe||'5m';
      const interval=$('#automationInterval');if(interval)interval.value=String(current.intervalMinutes||240);
      const history=$('#automationHistory');if(history)history.value=String(current.historyDays||90);
      renderQueue(automation);
      const marketStatus=$('#marketStatus');if(marketStatus)marketStatus.textContent=t('Backend market feed: {source}. {count} pairs available. Data is saved to PostgreSQL before the AI receives its job.',{source:markets.source||'Freqtrade',count:availableMarkets.length});
    } catch (error) { setState('error', t('Could not load configured markets: {error}',{error:error.message})); }
  }
  async function refreshAutomation(){if(mode!=='api')return;try{renderQueue(await services.automation());}catch(error){setState('error',error.message||t('Queue refresh failed.'));}}
  const pause=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
  async function waitForJob(id, timeoutMs=110000){const end=Date.now()+timeoutMs;while(Date.now()<end){const job=await services.job(id);if(job.status==='completed'||job.status==='failed')return job;await pause(2500);}return null;}
  async function renderJobResult(job){if(!job){setState('loading',t('The job is still running. Follow its progress in the Automation queue.'));await refreshAutomation();return;}await loadData();await refreshAutomation();if(job.status==='failed'){const message=job.error||t('Analysis job failed.');setState('error',message);toast(message);}else toast(t('AI decided {decision} for {symbol}.',{decision:job.decision||'HOLD',symbol:job.symbol}));}
  $('#saveAutomation')?.addEventListener('click',async event=>{const button=event.currentTarget;button.disabled=true;try{const symbols=[...document.querySelectorAll('input[name="automationMarket"]:checked')].map(input=>input.value);if(!symbols.length)throw new Error(t('Select at least one market.'));const settings={enabled:$('#automationEnabled').checked,symbols,timeframe:$('#automationTimeframe').value,intervalMinutes:Number($('#automationInterval').value),historyDays:Number($('#automationHistory').value)};await services.saveAutomation(settings);await loadMarketConfig();toast(t('Automation settings saved.'));}catch(error){toast(error.message||t('Could not save automation settings.'));}finally{button.disabled=false;}});
  $('#runAutomation')?.addEventListener('click',async event=>{const button=event.currentTarget;button.disabled=true;try{const symbols=[...document.querySelectorAll('input[name="automationMarket"]:checked')].map(input=>input.value);if(!symbols.length)throw new Error(t('Select at least one market.'));const result=await services.runAutomation({symbols,timeframe:$('#automationTimeframe').value,historyDays:Number($('#automationHistory').value)});toast(t('Queued {count} AI analysis job(s).',{count:result.accepted}));await refreshAutomation();}catch(error){toast(error.message||t('Could not start the analysis queue.'));}finally{button.disabled=false;}});
  $('#automationRefresh')?.addEventListener('click',refreshAutomation);
  setInterval(()=>{if($('#view-Automation')?.classList.contains('active'))refreshAutomation();},12000);
  $('#analyzeAll')?.addEventListener('click', async event => {
    if (mode !== 'api') { toast('Configure the backend API before requesting analysis.'); return; }
    const button=event.currentTarget; button.disabled=true; button.textContent=t('Analyzing all…');
    try { const result=await services.analyzeAll(selectedTimeframe()); toast(t('Queued {count} AI analysis job(s).',{count:result.accepted})); await refreshAutomation(); }
    catch(error) { setState('error',error.message||t('Batch analysis failed.')); toast(error.message||t('Batch analysis failed.')); }
    finally { button.disabled=false; button.textContent=t('Analyze all'); }
  });
  document.querySelectorAll('.analyze').forEach(button => button.addEventListener('click', async () => {
    if (mode !== 'api') { toast(mode === 'mock' ? 'Demo mode: configure a backend API to request analysis.' : 'Configure the backend API before requesting analysis.'); return; }
    const buttons = [...document.querySelectorAll('.analyze')]; buttons.forEach(item => { item.disabled = true; item.textContent = 'Analyzing market…'; });
    setState('loading', t('Analyzing {symbol} on {timeframe}…', { symbol: selectedSymbol(), timeframe: selectedTimeframe() }));
    try {
      const result = await services.analyze(selectedSymbol(), selectedTimeframe());
      if(!result.jobs?.length){toast(t('This market already has a job in the queue.'));await refreshAutomation();return;}
      toast(t('Market data collection and AI analysis added to the queue.'));
      const completed=await waitForJob(result.jobs[0].id);await renderJobResult(completed);
    } catch (error) { setState('error', error.message || 'Analysis request failed.'); toast(error.message || 'Analysis request failed.'); }
    finally { buttons.forEach(item => { item.disabled = false; item.innerHTML = item.id === 'analyze' ? '✳ &nbsp;Analyze now' : '✳ &nbsp;Analyze selected'; }); }
  }));
  window.addEventListener('ai-trading-lab-language-change', () => { if (mode === 'api' || mode === 'mock') loadData(); });
  const refresh = $('#refresh'); if (refresh) refresh.setAttribute('aria-label', 'Refresh dashboard data');
  loadMarketConfig().finally(loadData);
})();
