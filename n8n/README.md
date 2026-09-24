# AI Trading Lab - Market Analysis

Import `AI Trading Lab - Market Analysis.json` into the existing n8n instance. The export is inactive and contains no credential IDs or secrets; its three authentication selectors are intentionally unassigned. This task workspace has no n8n instance connection, so importing, assigning credentials, activating, and calling the production webhook must be done in your n8n UI.

## Before activating

1. Import the JSON and open the workflow.
2. In **Webhook**, create/select a Header Auth credential. Set its header name to `Authorization` and its value to `Bearer <the same random token configured as N8N_WEBHOOK_TOKEN in the backend>`. Use a long random token; do not commit it.
3. In **Get Freqtrade Candles**, create/select an HTTP Basic Auth credential with the Freqtrade API username/password. The node points at the previously supplied public host. Prefer replacing its host with the EasyPanel private service URL if n8n and Freqtrade share a private network. Keep the Freqtrade API inaccessible from the public internet where possible.
4. In **AI Model**, create/select a Header Auth credential with header name `Authorization` and value `Bearer <OpenAI API key>`. The model defaults to `gpt-4o-mini`; change the model in the node request body if needed.
5. Confirm n8n can reach the Freqtrade host and `api.openai.com`. Save, publish/activate, and copy the **production** Webhook URL into `N8N_ANALYZE_WEBHOOK_URL` on the backend. Set `N8N_WEBHOOK_TOKEN` there to the same token used by the Webhook credential. Restart/redeploy the backend after changing variables.

The backend sends a synchronous request; its HTTP timeout is 120 seconds. Ensure the n8n webhook, any reverse proxy, and model call can complete within that window.

## Workflow behavior

Webhook path: `POST /webhook/ai-trading-lab-market-analysis` (n8n production URL includes `/webhook/`). It only accepts `{ "symbol": "BTC/USDT", "timeframe": "5m", "mode": "DRY_RUN" }`. The workflow requests up to 30 candles using only `GET /api/v1/pair_candles?pair=...&timeframe=...&limit=30`. It does not call start/stop, balance, buy, sell, force-entry, or trade endpoints.

Freqtrade responses in both `columns` + `data` array form and object-row form are normalized. Only date, OHLCV, and the specified indicators are kept. The latest row is used for `current`; the last 30 rows are sent to the model unchanged. Indicators are not recalculated. HOLD remains a valid model decision.

Successful webhook response has exactly these fields (HTTP 200):

```json
{"decision":"HOLD","confidence":0.67,"entry":null,"stop_loss":null,"take_profit":null,"reason":"Insufficient confirmation."}
```

Invalid input returns HTTP 400 with a structured `error`; Freqtrade/model/schema failures return HTTP 502 with a structured `error`. The backend accepts only the exact successful decision shape and records it in PostgreSQL. It does not save error responses.

## Credentials required in n8n

- Header Auth: backend-to-n8n webhook token.
- HTTP Basic Auth: Freqtrade API username and password.
- Header Auth: OpenAI API key.

Credentials stay in n8n's credential store. The workflow JSON contains no credentials or tokens. You attach each credential in your n8n instance after import.
