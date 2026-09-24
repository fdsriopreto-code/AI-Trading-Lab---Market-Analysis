# AI Trading Lab - Market Analysis

Import `AI Trading Lab - Market Analysis.json` into the existing n8n instance. The export is inactive and contains no credential IDs or secrets; its three authentication selectors are intentionally unassigned. This task workspace has no n8n instance connection, so importing, assigning credentials, activating, and calling the production webhook must be done in your n8n UI.

## Before activating

1. Import the JSON and open the workflow.
2. In **Webhook**, create/select a Header Auth credential. Set its header name to `Authorization` and its value to `Bearer <the same random token configured as N8N_WEBHOOK_TOKEN in the backend>`. Use a long random token; do not commit it.
3. In **Get Freqtrade Candles**, create/select an HTTP Basic Auth credential with the Freqtrade API username/password. The node points at the previously supplied public host. Prefer replacing its host with the EasyPanel private service URL if n8n and Freqtrade share a private network. Keep the Freqtrade API inaccessible from the public internet where possible.
4. The included export uses OpenAI and needs a Header Auth credential with `Authorization: Bearer <OpenAI API key>`. If using your Gemini **Message a model** node instead, assign its Google Gemini credential and follow the Portuguese prompt setup below.
5. Confirm n8n can reach Freqtrade and your selected AI provider. Save, publish/activate, and copy the **production** Webhook URL into `N8N_ANALYZE_WEBHOOK_URL` on the backend. Set `N8N_WEBHOOK_TOKEN` there to the same token used by the Webhook credential. Restart/redeploy the backend after changing variables.

The backend sends a synchronous request; its HTTP timeout is 120 seconds. Ensure the n8n webhook, any reverse proxy, and model call can complete within that window.

## Gemini prompt in Portuguese (Brazil)

If using the **Message a model** Gemini node, the backend contract stays the same. Replace the OpenAI-style JSON payload in the node's **Messages → content** with a plain prompt; keep the machine-readable field names and decision values in English, but require the explanation in Brazilian Portuguese. Set **Output Content as JSON** on, **Simplify Output** on, **Temperature** to `0.1`, and put these instructions in **Options → System Message**:

```text
Você é um componente experimental de análise de mercado. Avalie somente os dados recebidos, sem inventar nem recalcular indicadores. Responda exclusivamente com um objeto JSON válido, sem Markdown, contendo exatamente: decision, confidence, entry, stop_loss, take_profit e reason. decision deve ser BUY, SELL ou HOLD; confidence deve ser número entre 0 e 1; entry, stop_loss e take_profit devem ser números ou null. Escreva reason em Português do Brasil. HOLD é uma decisão válida; não force BUY ou SELL. Se os dados não sustentarem uma conclusão clara, use HOLD. Esta análise é experimental, em modo de simulação, e não é recomendação de investimento.
```

Use esta mensagem de usuário no campo **Messages → content**:

```text
={{ 'Analise o contexto de mercado do Freqtrade abaixo e retorne somente o JSON solicitado. ' + JSON.stringify($('Prepare AI Context').first().json.context) }}
```

In the Code node after Gemini, parse `content.parts[0].text` as JSON (not OpenAI's `choices[0].message.content`). Keep the existing **Respond to Webhook** success output exactly `{ "decision": "BUY|SELL|HOLD", "confidence": 0.0, "entry": null, "stop_loss": null, "take_profit": null, "reason": "..." }`; only `reason` is localized. Connect the Gemini error output to the workflow's error response path.

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
