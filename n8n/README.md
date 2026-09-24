# AI Trading Lab · AI worker in n8n

The backend now collects Freqtrade data, stores it in PostgreSQL, and queues AI work. This workflow is only the AI adapter: it receives the queued market context, asks the configured model for a decision, validates the response, and returns it to the backend. Import the JSON as a template; it does not update an already active workflow by itself.

## Connect n8n

1. Import `AI Trading Lab - Market Analysis.json` and open the workflow.
2. In **Webhook**, assign Header Auth. The header is `Authorization` and value is `Bearer <N8N_WEBHOOK_TOKEN>`.
3. For the included OpenAI node, assign its API credential. If using the existing DeepSeek **AI Agent**, keep your DeepSeek credential and connect its output to **Validate AI Response**.
4. Save and activate the workflow. Configure `N8N_ANALYZE_WEBHOOK_URL` and the same `N8N_WEBHOOK_TOKEN` on the backend API service in EasyPanel.

## Connect Freqtrade to the backend

Set these private API environment variables on the backend service:

- `FREQTRADE_API_URL` — Freqtrade base URL, for example `http://freqtrade:8080` or an internal EasyPanel URL.
- `FREQTRADE_API_USERNAME` and `FREQTRADE_API_PASSWORD` — API Basic Auth credentials.
- `FREQTRADE_STRATEGY` — exact installed strategy class name used to calculate historical indicators.

Prefer a private service address on the VPS network. Do not publish the Freqtrade API to the public internet. The backend calls read-only `ping`, `whitelist`, `available_pairs`, and `pair_history` endpoints; it never calls order, trade, balance, start, stop, or force-entry endpoints.

The Automation page controls the monitored symbols, timeframe, schedule interval, and lookback from 7 to 180 days. The backend obtains analyzed candles from `pair_history`, stores/upserts them in PostgreSQL, summarizes the lookback into daily points, and passes those plus the latest 30 candles to n8n. The panel offers Freqtrade whitelist markets and pairs with downloaded data. Freqtrade can only return history that exists in its data directory. Download the intended pairs/timeframes first, for example `freqtrade download-data --exchange binance --pairs ETH/USDT --timeframes 5m --days 90`, adapting the exchange and market. See the [Freqtrade REST API docs](https://www.freqtrade.io/en/stable/rest-api/) and [data download guide](https://www.freqtrade.io/en/stable/data-download/).

The PostgreSQL queue retries failed AI jobs up to three times and exposes waiting, processing, completed, and failed states in the panel. Two backend workers process jobs by default (`ANALYSIS_WORKER_CONCURRENCY` can be set from 1 to 4). Freqtrade is accessed only by the backend using read-only endpoints; no trading endpoint is used.

## Webhook contract

The backend sends:

```json
{
  "symbol": "ETH/USDT",
  "timeframe": "5m",
  "mode": "DRY_RUN",
  "paper_context": { "portfolio": {}, "performance": {} },
  "market_context": {
    "current": { "price": 2500, "rsi": 52 },
    "historicalSummary": { "historyDays": 90, "dailySeries": [] },
    "candles": []
  }
}
```

Include `market_context.historicalSummary`, recent `market_context.candles`, and `paper_context` in the AI prompt. The model alone chooses BUY, SELL, or HOLD. The backend independently enforces paper-wallet limits and never places real orders. Ask the model to use HOLD when data is missing or conflicting; require exactly these six JSON keys: `decision`, `confidence`, `entry`, `stop_loss`, `take_profit`, `reason`. Keep `reason` in Brazilian Portuguese. Do not let the model call a trading tool.

## Update an existing DeepSeek AI Agent workflow

In the active workflow, keep **Validate Input**, **Prepare AI Context**, **AI Agent**, **Validate AI Response**, and **Success Response**. Remove or bypass the old Freqtrade HTTP Request node: the backend now sends its stored market history in the webhook payload.

Use this code in **Validate Input** (preserve any existing checks for `symbol`, `timeframe`, and `DRY_RUN`):

```javascript
const body = $json.body ?? $json;
const symbol = body.symbol;
const timeframe = body.timeframe;
const paperContext = body.paper_context && typeof body.paper_context === 'object' ? body.paper_context : null;
const marketContext = body.market_context;
if (!marketContext || marketContext.symbol !== symbol || marketContext.timeframe !== timeframe || !Array.isArray(marketContext.candles) || !marketContext.historicalSummary) {
  return [{ json: { ok: false, statusCode: 400, error: { code: 'INVALID_INPUT', message: 'Backend market context is required.' } } }];
}
return [{ json: { ok: true, symbol, timeframe, mode: 'DRY_RUN', paperContext, marketContext } }];
```

Set **Prepare AI Context** to:

```javascript
const request = $('Validate Input').first().json;
return [{ json: { context: request.marketContext, paperContext: request.paperContext } }];
```

Include this context in the **AI Agent** prompt:

```text
CONTEXTO ATUAL E HISTÓRICO DE MERCADO:
{{ JSON.stringify($('Prepare AI Context').first().json.context) }}

CARTEIRA SIMULADA E RESULTADOS ANTERIORES:
{{ JSON.stringify($('Prepare AI Context').first().json.paperContext) }}

Decida somente BUY, SELL ou HOLD com base nos dados recebidos. Avalie a sequência diária histórica, os indicadores fornecidos e os candles recentes. Não invente nem recalcule valores. Se os dados forem insuficientes ou conflitantes, use HOLD. Responda somente com JSON válido contendo exatamente decision, confidence, entry, stop_loss, take_profit e reason. Escreva reason em Português do Brasil. Use null para níveis sem justificativa.
```

Keep **Validate AI Response** between the model and **Success Response**. It must produce `{ ok: true, response: { decision, confidence, entry, stop_loss, take_profit, reason } }`. Set **Success Response** to:

```javascript
const context = $('Prepare AI Context').first().json.context;
return [{ json: { statusCode: 200, response: { ...$json.response, market: context.current, candles: context.candles } } }];
```

The webhook success response must have those six decision fields plus `market` and the latest `candles`; the backend stores the decision, simulates it, and labels forward outcomes later. Keep the provider's error output connected to an error response, then save and activate the workflow.
