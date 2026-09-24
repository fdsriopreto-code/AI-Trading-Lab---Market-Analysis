# AI Trading Lab API

Node.js + TypeScript + Fastify API backed by PostgreSQL. The browser calls only this API. The backend reads analyzed history from Freqtrade, stores market candles, queues analysis jobs in PostgreSQL, and calls n8n as the AI execution adapter. The AI decides BUY/SELL/HOLD; the backend only applies paper portfolio accounting and hard risk limits. It never submits exchange orders.

## Frontend runtime configuration

The browser reads `config.js`, a public runtime configuration file, not a secrets file. Keep credentials and webhook tokens out of it. The browser origin must exactly match `FRONTEND_ORIGIN` on the API. Opening `index.html` as `file://` is not a supported API setup.

## API endpoints

- `GET /health` → API and PostgreSQL health.
- `GET /api/config` and `GET /api/markets` → configured paper markets and risk settings.
- `GET /api/dashboard` → latest decision, open positions, last recorded market snapshot, equity, and paper portfolio.
- `GET /api/paper/portfolio` → simulated cash, marked equity, realized/unrealized PnL, drawdown, closed-trade stats, and limits.
- `GET /api/paper/learning` → forward outcome labels grouped by symbol/timeframe; results are marked exploratory below 30 examples.
- `GET /api/paper/learning/dataset?symbol=BTC/USDT&timeframe=5m&limit=1000` → labeled examples with indicator features for offline training research.
- `GET /api/ai/decisions/latest` → most recent decision or `null`.
- `GET /api/ai/decisions?symbol=BTC/USDT&decision=HOLD&limit=50` → decision history.
- `GET /api/trades` → open and closed simulated trades, with fees and close reason.
- `GET /api/market/:symbol` and `/api/market/:symbol/candles?timeframe=5m&limit=100` → most recent snapshot and candles stored by the background collector.
- `GET /api/automation` and `GET /api/analysis/jobs` → persistent schedule and PostgreSQL queue state.
- `PUT /api/automation/settings` → enable/disable schedule, markets, timeframe, lookback, and interval.
- `POST /api/automation/run` → enqueue collection + AI work and return immediately with HTTP 202.
- `GET /api/analysis/jobs/:id` → poll a queued job.
- `POST /api/ai/analyze` and `/api/ai/analyze/all` → compatibility endpoints that enqueue jobs and return HTTP 202.

Decision objects use camelCase. Confidence is stored as a fraction. BUY can open a long position; SELL closes an open long; HOLD does not trade. A SELL with no open position never opens a short. Duplicate positions are blocked. Stop-loss/take-profit checks run whenever a new snapshot for that symbol arrives; if both levels occur in one candle, the simulator assumes the stop was hit first. A decision without a valid market price is recorded but cannot open a position.

## n8n request and response contract

Set `FREQTRADE_API_URL`, `FREQTRADE_API_USERNAME`, `FREQTRADE_API_PASSWORD`, and `FREQTRADE_STRATEGY` as private backend variables. The API calls only Freqtrade read endpoints, refreshes analyzed candles incrementally, and stores them in `market_candles`. Set `N8N_ANALYZE_WEBHOOK_URL` and optionally `N8N_WEBHOOK_TOKEN` in the backend service only. The worker sends a queued market plus the saved history summary and paper portfolio context:

```json
{"symbol":"BTC/USDT","timeframe":"5m","mode":"DRY_RUN","paper_context":{"portfolio":{"...":"..."},"performance":{"...":"..."}},"market_context":{"current":{"price":81298},"historicalSummary":{"dailySeries":[]},"candles":[]}}
```

A successful response contains the decision and market snapshot/candles:

```json
{"decision":"BUY","confidence":0.78,"entry":81298,"stop_loss":80500,"take_profit":82500,"reason":"Example","market":{"price":81298,"high":81320,"low":81200,"date":"2026-09-24T10:00:00Z"},"candles":[{"date":"2026-09-24T10:00:00Z","close":81298}]}
```

`decision` is `BUY`, `SELL`, or `HOLD`; confidence is 0–1; levels are numbers or `null`; reason is text. Copy `market` from `Prepare AI Context.context.current` and `candles` from `Prepare AI Context.context.candles`. Responses without market/candles are accepted for compatibility, but the decision is not paper-filled and forward outcomes cannot be calculated from that response. See `../n8n/README.md` for the exact n8n wiring.

## Paper portfolio and learning data

Migration `003_paper_portfolio.sql` creates a persistent USDT wallet, extends trades with fees/risk levels, and adds forward decision outcomes. Existing PostgreSQL data is preserved. `PAPER_INITIAL_BALANCE` seeds the account only the first time; changing that setting later does not reset an existing wallet.

The simulator is long-only. It limits each position to `PAPER_MAX_TRADE_PCT` of equity, caps total exposure with `PAPER_MAX_EXPOSURE_PCT`, limits the number of open positions, deducts fee and entry/exit slippage estimates, and blocks entries after the drawdown limit. The server enforces these checks independently of the model. No real-money order or exchange credential is used.

BUY/SELL decisions receive a forward outcome label after `PAPER_OUTCOME_HORIZON_CANDLES` candles. Labels use a later candle and subtract estimated round-trip fees and slippage. These outcomes are exploratory and do not modify DeepSeek model weights. n8n receives account/performance context as feedback; that is memory/context, not model training.

The Automation panel stores schedule, markets, timeframe, lookback, and run interval in PostgreSQL. It defaults to paused on first install unless `PAPER_AUTO_ANALYZE=true` seeds it as enabled. Manual collection + analysis can be queued at any time. The scheduler only creates jobs; a PostgreSQL-backed worker collects and processes them after deployment restarts.

## Local setup

1. Copy `.env.example` to `.env` and configure PostgreSQL plus the n8n webhook values.
2. `npm ci`
3. `npm run build`
4. `npm run db:migrate`
5. `npm start`

The migration runner serializes concurrent starts and tracks applied SQL files. Back up PostgreSQL before applying migrations.

## EasyPanel / Docker Compose

For an EasyPanel App plus managed PostgreSQL, use the root `Dockerfile` and expose port `3000`. For Compose, use root `docker-compose.yml`; it runs frontend, API, and PostgreSQL on a private network. Do not publish PostgreSQL or API ports. Set a strong URL-safe `POSTGRES_PASSWORD`; keep live secrets in EasyPanel, never in Git. Configure the Freqtrade, n8n, and paper risk variables from `.env.example` on the API service. The Freqtrade API should use an EasyPanel internal hostname and must not be exposed publicly.
