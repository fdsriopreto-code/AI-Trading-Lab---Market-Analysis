# AI Trading Lab — Market Analysis

Static dashboard + Fastify API + PostgreSQL, packaged for EasyPanel. The frontend design is unchanged. Use the root `Dockerfile` if deploying as a single EasyPanel **App** service with a separate EasyPanel PostgreSQL service; it serves the dashboard and API together on port `3000`. Or use `docker-compose.yml` as a **Compose** service to run the frontend, API, and PostgreSQL together; Nginx proxies `/api/*` and `/health` over the private Compose network.

## Deploy on EasyPanel

### Existing EasyPanel App service + managed PostgreSQL

Use GitHub source, branch `main`, build path `/`, Dockerfile build type, and Dockerfile path `Dockerfile`. Expose the domain on port `3000`. Configure runtime environment variables on the App service: `DATABASE_URL`, `PGSSL`, `FRONTEND_ORIGIN`, `N8N_ANALYZE_WEBHOOK_URL`, and `N8N_WEBHOOK_TOKEN`. Use the PostgreSQL service's private host and credentials in `DATABASE_URL`. Redeploy after saving.

### Compose alternative

Create a **Compose** service using this Git repository, branch `main`, build path `/`, and Compose file `docker-compose.yml`. Set `POSTGRES_PASSWORD` to a long random alphanumeric secret. Deploy, then add the public HTTPS domain to the `frontend` service on internal port `80`. Do not expose PostgreSQL or the API directly. No `ports` mapping is needed.

In either option, import and configure the n8n workflow using [`n8n/README.md`](n8n/README.md). Set `N8N_ANALYZE_WEBHOOK_URL` and the matching `N8N_WEBHOOK_TOKEN` in the backend service, then redeploy.

Compose creates the `postgres_data` named volume. It survives container replacement, but it is not a backup; configure and periodically verify off-server PostgreSQL backups. Do not delete the volume when replacing the Compose service.

## Integrations and current scope

- The API persists AI decisions in PostgreSQL and exposes dashboard, decisions, trades, health, and analysis endpoints. See [`backend/README.md`](backend/README.md).
- The analysis endpoint calls n8n synchronously; n8n in turn calls Freqtrade candle data and the configured AI provider. Credentials belong in n8n's credential store and EasyPanel's secret environment editor, never in Git or frontend config.
- Freqtrade is read-only in the supplied analysis workflow. The dashboard/API are DRY_RUN; this setup does not execute exchange orders or sync Freqtrade balances/trades.
- Market overview and candle endpoints remain unimplemented (HTTP 501). `market` and `balance` dashboard fields remain null until a provider/sync flow is added.

## Local Compose

Copy `.env.example` to `.env`, replace `POSTGRES_PASSWORD` with a URL-safe random value, then run `docker compose up --build`. Visit `http://localhost`. Keep `.env` local; only `.env.example` belongs in Git.
