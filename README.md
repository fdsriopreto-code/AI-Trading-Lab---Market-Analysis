# AI Trading Lab — Market Analysis

Static dashboard + Fastify API + PostgreSQL, packaged for EasyPanel. The frontend design is unchanged. The interface supports Português (Brazil) and English, and saves the selected language in the browser. Use the root `Dockerfile` if deploying as a single EasyPanel **App** service with a separate EasyPanel PostgreSQL service; it serves the dashboard and API together on port `3000`. Or use `docker-compose.yml` as a **Compose** service to run the frontend, API, and PostgreSQL together; Nginx proxies `/api/*` and `/health` over the private Compose network.

## Deploy on EasyPanel

### Existing EasyPanel App service + managed PostgreSQL

Use GitHub source, branch `main`, build path `/`, Dockerfile build type, and Dockerfile path `Dockerfile`. Expose the domain on port `3000`. Configure runtime environment variables on the App service: `DATABASE_URL`, `PGSSL`, `FRONTEND_ORIGIN`, `N8N_ANALYZE_WEBHOOK_URL`, `N8N_WEBHOOK_TOKEN`, `FREQTRADE_API_URL`, `FREQTRADE_API_USERNAME`, `FREQTRADE_API_PASSWORD`, `FREQTRADE_STRATEGY`, plus the paper settings in `.env.example`. The Automation page is paused on a fresh install; enable it only when ready for recurring model/API calls. Use the PostgreSQL service's private host and credentials in `DATABASE_URL`. Redeploy after saving.

### Compose alternative

Create a **Compose** service using this Git repository, branch `main`, build path `/`, and Compose file `docker-compose.yml`. Set `POSTGRES_PASSWORD` to a long random alphanumeric secret. Deploy, then add the public HTTPS domain to the `frontend` service on internal port `80`. Do not expose PostgreSQL or the API directly. No `ports` mapping is needed.

Configure the active n8n AI workflow using [`n8n/README.md`](n8n/README.md). The backend reads analyzed Freqtrade history, stores it in PostgreSQL, queues jobs, and sends the AI `market_context` plus `paper_context`. The AI response must include the decision and the current `market` plus latest 30 `candles` so the simulator can apply the decision and evaluate outcomes. The checked-in n8n export is a template; changing it does not update the workflow already active in your n8n instance. Set the webhook URL/token in EasyPanel, then redeploy.

Compose creates the `postgres_data` named volume. It survives container replacement, but it is not a backup; configure and periodically verify off-server PostgreSQL backups. Do not delete the volume when replacing the Compose service.

## Integrations and current scope

- The API persists decisions, a USDT paper wallet, simulated trades, and forward outcome labels in PostgreSQL. It enforces a long-only risk layer, position/exposure limits, fees, slippage, and a drawdown stop. See [`backend/README.md`](backend/README.md).
- The backend collector reads Freqtrade, stores candle history in PostgreSQL, and sends queued context to n8n for the AI decision. The panel can select the bot whitelist or previously downloaded market pairs. Freqtrade and n8n credentials stay in EasyPanel secrets, never in Git or frontend config.
- Freqtrade is accessed by the backend through read-only API endpoints. Trades in this app are simulated; no exchange orders or Freqtrade wallet synchronization occur. The Automation panel controls the PostgreSQL queue and hourly schedule. AI can choose BUY, SELL, or HOLD; the backend only enforces paper risk limits and accounting.
- Market/candle API endpoints return persisted Freqtrade history. Paper prices are refreshed during collection jobs, and stop/take levels are checked against stored candles between AI decisions.

## Local Compose

Copy `.env.example` to `.env`, replace `POSTGRES_PASSWORD` with a URL-safe random value, then run `docker compose up --build`. Visit `http://localhost`. Keep `.env` local; only `.env.example` belongs in Git.
