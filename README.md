# AI Trading Lab — Market Analysis

Static dashboard + Fastify API + PostgreSQL, packaged for a Docker Compose deployment on EasyPanel. The frontend design is unchanged; Nginx serves it and proxies `/api/*` and `/health` to the API on the private Compose network. PostgreSQL is private and uses a named persistent volume.

## Deploy on EasyPanel

1. Create a **Compose** service using this Git repository, branch `main`, build path `/`, and Compose file `docker-compose.yml`.
2. In the service environment, set `POSTGRES_PASSWORD` to a long random alphanumeric secret. Keep the generated value; changing it after the database is initialized requires a PostgreSQL password rotation, not just changing this variable. `POSTGRES_DB` and `POSTGRES_USER` default to `ai_trading_lab`.
3. Deploy, then add the public HTTPS domain to the `frontend` service on internal port `80`. Do not expose PostgreSQL or the API directly. No `ports` mapping is needed; EasyPanel routes the domain to the frontend container.
4. Check the `frontend`, `api`, and `postgres` container health in EasyPanel. `GET /health` checks PostgreSQL connectivity.
5. Import and configure the n8n workflow using [`n8n/README.md`](n8n/README.md). Set `N8N_ANALYZE_WEBHOOK_URL` and the matching `N8N_WEBHOOK_TOKEN` in EasyPanel, then redeploy.

Compose creates the `postgres_data` named volume. It survives container replacement, but it is not a backup; configure and periodically verify off-server PostgreSQL backups. Do not delete the volume when replacing the Compose service.

## Integrations and current scope

- The API persists AI decisions in PostgreSQL and exposes dashboard, decisions, trades, health, and analysis endpoints. See [`backend/README.md`](backend/README.md).
- The analysis endpoint calls n8n synchronously; n8n in turn calls Freqtrade candle data and the configured AI provider. Credentials belong in n8n's credential store and EasyPanel's secret environment editor, never in Git or frontend config.
- Freqtrade is read-only in the supplied analysis workflow. The dashboard/API are DRY_RUN; this setup does not execute exchange orders or sync Freqtrade balances/trades.
- Market overview and candle endpoints remain unimplemented (HTTP 501). `market` and `balance` dashboard fields remain null until a provider/sync flow is added.

## Local Compose

Copy `.env.example` to `.env`, replace `POSTGRES_PASSWORD` with a URL-safe random value, then run `docker compose up --build`. Visit `http://localhost`. Keep `.env` local; only `.env.example` belongs in Git.
