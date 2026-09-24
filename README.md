# AI Trading Lab — Market Analysis

Static dashboard + Fastify API + PostgreSQL, packaged for EasyPanel. The frontend design is unchanged. The interface supports Português (Brazil) and English, and saves the selected language in the browser. Use the root `Dockerfile` if deploying as a single EasyPanel **App** service with a separate EasyPanel PostgreSQL service; it serves the dashboard and API together on port `3000`. Or use `docker-compose.yml` as a **Compose** service to run the frontend, API, and PostgreSQL together; Nginx proxies `/api/*` and `/health` over the private Compose network.

## Deploy on EasyPanel

### Existing EasyPanel App service + managed PostgreSQL

Use GitHub source, branch `main`, build path `/`, Dockerfile build type, and Dockerfile path `Dockerfile`. Expose the domain on port `3000`. Configure runtime environment variables on the App service: `DATABASE_URL`, `PGSSL`, `FRONTEND_ORIGIN`, `N8N_ANALYZE_WEBHOOK_URL`, `N8N_WEBHOOK_TOKEN`, plus the `PAPER_*` settings listed in `.env.example`. `PAPER_AUTO_ANALYZE` defaults to `false`; enable it only when ready for recurring model/API calls. Use the PostgreSQL service's private host and credentials in `DATABASE_URL`. Redeploy after saving.

### Compose alternative

Create a **Compose** service using this Git repository, branch `main`, build path `/`, and Compose file `docker-compose.yml`. Set `POSTGRES_PASSWORD` to a long random alphanumeric secret. Deploy, then add the public HTTPS domain to the `frontend` service on internal port `80`. Do not expose PostgreSQL or the API directly. No `ports` mapping is needed.

In either option, configure the active n8n workflow using [`n8n/README.md`](n8n/README.md). It must return the current `market` snapshot and `candles` with the AI decision so the paper simulator can create fills and evaluate outcomes. Include the `paper_context` sent by the API in the AI prompt. The checked-in n8n export is a template; changing it does not update the workflow already active in your n8n instance. Set the webhook URL/token in EasyPanel, then redeploy.

Compose creates the `postgres_data` named volume. It survives container replacement, but it is not a backup; configure and periodically verify off-server PostgreSQL backups. Do not delete the volume when replacing the Compose service.

## Integrations and current scope

- The API persists decisions, a USDT paper wallet, simulated trades, and forward outcome labels in PostgreSQL. It enforces a long-only risk layer, position/exposure limits, fees, slippage, and a drawdown stop. See [`backend/README.md`](backend/README.md).
- The analysis endpoint calls n8n synchronously; n8n in turn calls Freqtrade candle data and the configured AI provider. Credentials belong in n8n's credential store and EasyPanel's secret environment editor, never in Git or frontend config.
- Freqtrade is read-only in the supplied analysis workflow. Trades in this app are simulated by the API; no exchange orders or Freqtrade wallet synchronization occur. Manual analysis is available in the dashboard; recurring scans are opt-in with `PAPER_AUTO_ANALYZE=true`.
- Market/candle API endpoints return the most recently received analysis snapshot; they are not a continuous market feed. Paper prices/stops update only when a new scan arrives for that pair.

## Local Compose

Copy `.env.example` to `.env`, replace `POSTGRES_PASSWORD` with a URL-safe random value, then run `docker compose up --build`. Visit `http://localhost`. Keep `.env` local; only `.env.example` belongs in Git.
