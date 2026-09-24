(() => {
  'use strict';
  const enToPt = {
    'AI Trading Lab — Market workspace': 'AI Trading Lab — Área de mercado',
    'WORKSPACE': 'ÁREA DE TRABALHO',
    'Dashboard': 'Painel', 'Market': 'Mercado', 'AI Decisions': 'Decisões da IA', 'AI Analysis': 'Análise da IA',
    'Trades': 'Operações', 'History': 'Histórico', 'System': 'Sistema', 'Settings': 'Configurações',
    'Workspace /': 'Área de trabalho /', 'API STATUS': 'STATUS DA API', 'DRY RUN': 'SIMULAÇÃO', 'DRY RUN ACTIVE': 'SIMULAÇÃO ATIVA',
    'MARKET OVERVIEW / LIVE WORKSPACE': 'VISÃO GERAL DO MERCADO / ÁREA AO VIVO',
    'A clear view of the market and recorded AI activity.': 'Visão clara do mercado e das análises registradas pela IA.',
    'Refresh': 'Atualizar', '↻ Refresh': '↻ Atualizar', 'Refresh dashboard data': 'Atualizar dados do painel', 'Loading…': 'Carregando…', '↻ Loading…': '↻ Carregando…',
    'Analyze now': 'Analisar agora', '✳ Analyze now': '✳ Analisar agora', 'Analyzing market…': 'Analisando mercado…', '✳ Analyzing market…': '✳ Analisando mercado…', 'Market price': 'Preço de mercado',
    '24h change': 'Variação em 24h', 'AI decision': 'Decisão da IA', 'LATEST': 'MAIS RECENTE', 'Open trades': 'Operações abertas',
    'BACKEND STATUS': 'STATUS DO BACKEND', 'Dry balance': 'Saldo simulado', 'SIMULATED': 'SIMULADO', 'PAPER TRADING': 'SIMULAÇÃO DE OPERAÇÕES',
    'LAST 24 HOURS': 'ÚLTIMAS 24 HORAS', 'NO MARKET PROVIDER CONNECTED': 'NENHUM PROVEDOR DE MERCADO CONECTADO',
    'Price action': 'Ação do preço', 'BTC/USDT · 5m': 'BTC/USDT · 5m', 'PROVIDED BY MARKET DATA SOURCE': 'FORNECIDO PELA FONTE DE DADOS DO MERCADO',
    'ILLUSTRATIVE CANDLES · API DATA NOT CONNECTED': 'CANDLES ILUSTRATIVOS · API DE DADOS NÃO CONECTADA',
    'NO LIVE MARKET DATA': 'SEM DADOS DE MERCADO AO VIVO', 'Indicator snapshot': 'Resumo dos indicadores', 'Recent AI decisions': 'Decisões recentes da IA',
    'LATEST RECORDED ANALYSES': 'ANÁLISES REGISTRADAS RECENTEMENTE', 'View all →': 'Ver todas →', 'View all  →': 'Ver todas  →',
    'System health': 'Saúde do sistema', 'COMPONENT STATUS': 'STATUS DOS COMPONENTES', 'Details →': 'Detalhes →', 'Details  →': 'Detalhes  →',
    'Online': 'Online', 'Online*': 'Online*', 'Ready*': 'Pronto*', 'Unknown': 'Desconhecido', 'Illustrative status · Awaiting backend health checks': 'Status ilustrativo · Aguardando verificações do backend',
    'Market figures, indicators, chart, and service statuses shown here are illustrative mock data. Connect the backend to display live values.': 'Valores de mercado, indicadores, gráfico e status dos serviços são ilustrativos. Conecte o backend para exibir dados ao vivo.',
    'WORKSPACE / MARKET DATA': 'ÁREA DE TRABALHO / DADOS DE MERCADO', 'Price action and market context received through the backend.': 'Variação de preço e contexto de mercado recebidos pelo backend.',
    'Market feed is not connected. This asset selector is illustrative; available symbols will come from the API.': 'O feed de mercado não está conectado. Este seletor é ilustrativo; os símbolos disponíveis virão da API.',
    'WORKSPACE / MODEL ACTIVITY': 'ÁREA DE TRABALHO / ATIVIDADE DO MODELO', 'Recorded experimental decisions and their context.': 'Decisões experimentais registradas e seus contextos.',
    'TIMESTAMP': 'DATA E HORA', 'TIME': 'HORÁRIO', 'SYMBOL': 'SÍMBOLO', 'PRICE': 'PREÇO', 'DECISION': 'DECISÃO', 'CONFIDENCE': 'CONFIANÇA',
    'CONF.': 'CONF.', 'ENTRY': 'ENTRADA', 'STOP': 'STOP', 'STOP LOSS': 'STOP LOSS', 'TAKE PROFIT': 'ALVO', 'REASON': 'MOTIVO',
    'Export ↗': 'Exportar ↗', 'Export  ↗': 'Exportar  ↗', 'Decision history is illustrative mock data. Outcomes are not generated in the frontend.': 'O histórico é ilustrativo. Os resultados não são calculados no frontend.',
    'WORKSPACE / EXPERIMENT': 'ÁREA DE TRABALHO / EXPERIMENTO', 'Request an analysis through the backend API.': 'Solicite uma análise pela API do backend.',
    'The latest experimental decision is': 'A decisão experimental mais recente é', 'Illustrative mock record · Not investment advice': 'Registro ilustrativo · Não é recomendação de investimento',
    'Experimental system record · Not investment advice': 'Registro experimental do sistema · Não é recomendação de investimento',
    'WORKSPACE / SIMULATION': 'ÁREA DE TRABALHO / SIMULAÇÃO', 'Paper trading activity recorded by the system.': 'Operações simuladas registradas pelo sistema.',
    'No simulated trades yet.': 'Ainda não há operações simuladas.', 'SIMULATED TRADE': 'OPERAÇÃO SIMULADA', 'No real orders are placed.': 'Nenhuma ordem real é enviada.',
    'WORKSPACE / AUDIT TRAIL': 'ÁREA DE TRABALHO / REGISTRO DE ATIVIDADES', 'Decision outcomes will appear when supplied by the backend.': 'Os resultados das decisões aparecerão quando forem fornecidos pelo backend.',
    'No outcome data connected. Future 5m, 15m, 30m, and 60m price observations will be supplied by the backend; none are calculated here.': 'Não há dados de resultados conectados. Observações futuras de preço em 5m, 15m, 30m e 60m serão fornecidas pelo backend; nenhuma é calculada aqui.',
    'WORKSPACE / INFRASTRUCTURE': 'ÁREA DE TRABALHO / INFRAESTRUTURA', 'Service health is awaiting backend health checks.': 'A saúde dos serviços aguarda as verificações do backend.',
    'No live health endpoint is configured. Component states are not inferred from the mock data.': 'Nenhum endpoint de saúde ao vivo está configurado. O status dos componentes não é inferido pelos dados ilustrativos.',
    'WORKSPACE / PREFERENCES': 'ÁREA DE TRABALHO / PREFERÊNCIAS', 'Local display defaults · no credentials stored in the frontend.': 'Preferências locais de exibição · nenhuma credencial é armazenada no frontend.',
    'Default symbol': 'Símbolo padrão', 'Default timeframe': 'Período padrão', 'Auto refresh': 'Atualização automática', 'Refresh interval': 'Intervalo de atualização', 'Theme': 'Tema',
    'No AI decisions yet.': 'Ainda não há decisões da IA.', 'No analysis has been recorded.': 'Nenhuma análise foi registrada.', 'Unable to load AI decisions.': 'Não foi possível carregar as decisões da IA.',
    'Unable to load simulated trades.': 'Não foi possível carregar as operações simuladas.', 'No simulated trades yet.': 'Ainda não há operações simuladas.',
    'SIMULATED TRADES · No real orders are placed.': 'OPERAÇÕES SIMULADAS · Nenhuma ordem real é enviada.',
    'API not configured. Set outputs/config.js to connect a backend, or explicitly enable mock mode for development.': 'API não configurada. Configure outputs/config.js para conectar o backend ou ative explicitamente o modo de demonstração para desenvolvimento.',
    'DEMO DATA · Illustrative values only; no live market feed is connected.': 'DADOS DE DEMONSTRAÇÃO · Valores ilustrativos; nenhum feed de mercado ao vivo está conectado.',
    'Loading dashboard and activity from API…': 'Carregando painel e atividades da API…',
    'LIVE DATA · Loaded from the configured backend API. Market price and balance show N/A until those providers are connected.': 'DADOS AO VIVO · Carregados da API do backend. Preço de mercado e saldo aparecem como N/A até que esses provedores sejam conectados.',
    'Analysis recorded by the backend.': 'Análise registrada pelo backend.', 'Demo mode: configure a backend API to request analysis.': 'Modo de demonstração: configure a API do backend para solicitar uma análise.',
    'RECORDED {date}': 'REGISTRADO EM {date}',
    'API data is incomplete ({count} request(s) failed). Mock values are not substituted. {error}': 'Os dados da API estão incompletos ({count} solicitação(ões) falharam). Valores ilustrativos não serão usados. {error}',
    'Analyzing {symbol} on {timeframe}…': 'Analisando {symbol} em {timeframe}…',
    'Configure the backend API before requesting analysis.': 'Configure a API do backend antes de solicitar uma análise.', 'Cannot reach API. Check the API URL and CORS configuration.': 'Não foi possível acessar a API. Verifique a URL da API e a configuração de CORS.',
    'Analysis workflow failed or returned an invalid response': 'O fluxo de análise falhou ou retornou uma resposta inválida.', 'API / DB ISSUE': 'PROBLEMA NA API / BANCO',
    'SYSTEM ONLINE': 'SISTEMA ONLINE', 'DEMO MODE': 'MODO DEMONSTRAÇÃO', 'DEMO DATA': 'DADOS DE DEMONSTRAÇÃO', 'CONNECTING': 'CONECTANDO', 'LIVE DATA': 'DADOS AO VIVO', 'API ERROR': 'ERRO NA API', 'NOT CONFIGURED': 'NÃO CONFIGURADO',
    'NO DECISION RECORDED': 'NENHUMA DECISÃO REGISTRADA', 'RECORDED': 'REGISTRADO', 'N/A · MARKET PROVIDER NOT CONNECTED': 'N/A · PROVEDOR DE MERCADO NÃO CONECTADO',
    'MARKET DATA FROM BACKEND': 'DADOS DE MERCADO DO BACKEND', 'Market overview / live workspace': 'Visão geral do mercado / área ao vivo',
    'Refresh dashboard data': 'Atualizar dados do painel', 'ID': 'ID', 'SIDE': 'LADO', 'EXIT': 'SAÍDA', 'AMOUNT': 'QUANTIDADE', 'PNL': 'LUCRO/PREJUÍZO', 'OPEN TIME': 'ABERTURA', 'CLOSE TIME': 'FECHAMENTO', 'STATUS': 'STATUS',
    'Market analysis': 'Análise de mercado', 'Volume': 'Volume', '30 seconds': '30 segundos', '1 minute': '1 minuto', '5 minutes': '5 minutos',
    '● Online': '● Online', '● Online*': '● Online*', '● Ready*': '● Pronto*', '● Unknown': '● Desconhecido',
    '· This interface does not place real orders.': '· Esta interface não envia ordens reais.'
  };
  const ptToEn = Object.fromEntries(Object.entries(enToPt).map(([en, pt]) => [pt, en]));
  const storageKey = 'ai-trading-lab-language';
  let language = localStorage.getItem(storageKey) === 'en' ? 'en' : 'pt-BR';

  function translateTextNode(node) {
    if (!node?.nodeValue || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(node.parentElement?.tagName || '')) return;
    const raw = node.nodeValue;
    const value = raw.trim().replace(/\s+/g, ' ');
    const translated = language === 'pt-BR' ? enToPt[value] : ptToEn[value];
    if (translated) {
      const prefix = raw.match(/^\s*/)?.[0] || '';
      const suffix = raw.match(/\s*$/)?.[0] || '';
      node.nodeValue = prefix + translated + suffix;
    }
  }
  function translateTree(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) return translateTextNode(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) translateTextNode(node);
  }
  function t(text, values = {}) {
    let result = language === 'pt-BR' ? (enToPt[text] || text) : text;
    for (const [key, value] of Object.entries(values)) result = result.replaceAll(`{${key}}`, String(value));
    return result;
  }
  function setLanguage(next) {
    language = next === 'en' ? 'en' : 'pt-BR';
    localStorage.setItem(storageKey, language);
    document.documentElement.lang = language;
    document.title = language === 'pt-BR' ? 'AI Trading Lab — Área de mercado' : 'AI Trading Lab — Market workspace';
    const picker = document.querySelector('#languagePicker');
    if (picker) { picker.value = language; picker.setAttribute('aria-label', language === 'pt-BR' ? 'Idioma' : 'Language'); }
    translateTree(document.body);
    window.dispatchEvent(new CustomEvent('ai-trading-lab-language-change', { detail: { language } }));
  }
  window.AITradingLabI18n = { t, get language() { return language; }, setLanguage };

  document.documentElement.lang = language;
  document.title = language === 'pt-BR' ? 'AI Trading Lab — Área de mercado' : 'AI Trading Lab — Market workspace';
  const picker = document.querySelector('#languagePicker');
  if (picker) {
    picker.value = language;
    picker.setAttribute('aria-label', language === 'pt-BR' ? 'Idioma' : 'Language');
    picker.addEventListener('change', () => setLanguage(picker.value));
  }
  translateTree(document.body);
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') translateTextNode(mutation.target);
      for (const added of mutation.addedNodes || []) translateTree(added);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true });
})();
