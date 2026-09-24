# AI Trading Lab API

Node.js + TypeScript + Fastify API backed by PostgreSQL. The browser calls only this API. n8n is a server-side integration; Freqtrade is not connected in this stage and no order execution endpoint exists.

## Frontend runtime configuration

The existing static frontend reads `outputs/config.js`; this is a public runtime config file, not a secrets file. Set `apiBaseUrl` to the API's public HTTPS origin. Use `mode: 'api'` when configured. For local UI development without a backend, explicitly set `mode: 'mock'`; those values are visibly marked DEMO DATA. Keep credentials and webhook tokens out of this file. If the API URL is set, failures stay visible and never silently fall back to mock data.

The browser origin must exactly match `FRONTEND_ORIGIN` on the API. When developing locally, use the HTTP origin from your local static server (for example `http://localhost:8000`). Opening `index.html` as a `file://` URL is not a supported API setup.

## API endpoints

- `GET /health` → `{ "api": "ok", "database": "ok" }`; if PostgreSQL is down, HTTP 503 with `{ "api": "ok", "database": "unavailable" }`.
- `GET /api/dashboard` → mode, latest decision, open trade count, plus `market: null` and `balance: null` until providers are added.
- `GET /api/ai/decisions/latest` → decision object or `null`.
- `GET /api/ai/decisions?symbol=BTC/USDT&decision=HOLD&limit=50` → array of decisions.
- `GET /api/trades` → array of simulated trades.
- `POST /api/ai/analyze` → request `{ "symbol": "BTC/USDT", "timeframe": "5m" }`; returns the persisted decision.

Decision API objects use camelCase: `id`, `symbol`, `timeframe`, `decision`, `confidence` (0–1), `price`, `entry`, `stopLoss`, `takeProfit`, `reason`, `indicators`, `candles`, `createdAt`. Confidence is stored as a fraction. Market and balance values are absent (`null`) until a real provider is connected.

## n8n request and response contract

Set `N8N_ANALYZE_WEBHOOK_URL` and optionally `N8N_WEBHOOK_TOKEN` in the backend service only. On analysis, the backend forwards exactly:

```json
{"symbol":"BTC/USDT","timeframe":"5m","mode":"DRY_RUN"}
```

n8n must synchronously return a JSON object:

```json
{"decision":"BUY","confidence":0.78,"entry":81298,"stop_loss":80500,"take_profit":82500,"reason":"Example"}
```

`decision` is `BUY`, `SELL`, or `HOLD`; `confidence` is a number from 0 through 1; entry/stop/take-profit are numbers or `null`; reason is a string. Invalid/non-2xx responses are logged, return HTTP 502, and are not saved. This stage does not call Freqtrade. The n8n workflow can be developed against this contract, then later gain a server-side Freqtrade step.

## Local setup

1. Copy `.env.example` to `.env`; set a PostgreSQL `DATABASE_URL`, local `FRONTEND_ORIGIN`, and optionally the n8n webhook settings.
2. `npm ci`
3. `npm run build`
4. `npm run db:migrate`
5. `npm start`

The migration runner serializes concurrent container starts, tracks applied SQL files, and safely converts legacy confidence percentages (for example `67`) into fractions (`0.67`). Back up the database before applying schema migrations.

## EasyPanel / Docker Compose

Use the repository-root `docker-compose.yml` as an EasyPanel Compose service (Git branch `main`, build path `/`). It builds the API from this directory's `Dockerfile`, serves the static frontend from the `frontend` service, and starts PostgreSQL with a named `postgres_data` volume. Add the public domain to `frontend` on internal port 80; the frontend Nginx proxies `/api/*` and `/health` over the private Compose network. Do not publish PostgreSQL or API ports.

Set `POSTGRES_PASSWORD` in EasyPanel to a long random alphanumeric value. `DATABASE_URL` is composed from the Postgres variables, and `PGSSL=false` is appropriate only for the private Docker network in this Compose setup. The same-origin frontend requires no public API URL and does not need cross-origin browser access. Configure `N8N_ANALYZE_WEBHOOK_URL` and `N8N_WEBHOOK_TOKEN` as Compose environment values after setting up the workflow. For backups and integration setup, see the root deployment guide and `n8n/README.md`.
