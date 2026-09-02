---
name: query-production-sales-metrics-trancli
description: Query production sales metrics through Transsion trancli on the user's local non-sandbox machine. Use when the task needs prod trancli setup, DDL verification, live metric and dimension mapping, SQL generation, or runSql execution against `https://pfgateway.transsion.com/data-chat-bi-pre-service/api/chat/demo/ddl` and `https://pfgateway.transsion.com/data-chat-bi-pre-service/api/chat/demo/runSql`.
---

# Query Production Sales Metrics Through Trancli

Use the user's local machine only. Do not use sandbox mode.

## Read Order

1. Read [references/trancli-preflight.md](references/trancli-preflight.md).
2. Read [references/api-contract.md](references/api-contract.md).
3. Read [references/metric-catalog.json](references/metric-catalog.json).
4. Read [references/dimension-catalog.json](references/dimension-catalog.json).
5. Read [references/query-rules.md](references/query-rules.md).

## Workflow

1. Check whether `trancli` is already available.
2. If `trancli` is missing, install `Node.js`, confirm `npm`, set the Transsion npm registry, and install `trancli`.
3. If `trancli` is already available, do not repeat `Node.js`, `npm`, or `trancli` installation.
4. Run `trancli dev use prod`.
5. If `prod` does not exist, run `trancli dev init`, choose `prod`, and fill the fixed Open Platform values from [references/trancli-preflight.md](references/trancli-preflight.md).
6. Run `trancli dev doctor`.
7. Treat `doctor` as the token and health check. If tokens may be stale, rerun `doctor` before any API call.
8. If `doctor` fails, fix the reported auth, gateway, network, or local configuration issue first. If the issue persists, stop and contact `曹海肖(18648895)`.
9. Run the DDL smoke check before any SQL generation.
10. Map the user's metrics, dimensions, filters, and time range only to fields confirmed by live DDL plus the local catalogs.
11. Generate read-only SQL only after DDL succeeds.
12. Send `runSql` requests in the documented `[{name, sql}]` format and validate the response by `name`.

## Rules

- Do not use sandbox mode.
- Do not modify this skill or any file inside this skill directory during normal use.
- Do not proactively explain `trancli` to the user. By default, describe only the data-query capability and what can be retrieved. Explain `trancli`, setup details, or internal workflow only if the user explicitly asks about the principle, installation, or troubleshooting.
- Do not repeat steps the user has already completed.
- `trancli` availability is enough evidence that `npm` does not need to be rechecked.
- In `prod`, `P-Rtoken`, `P-Appid`, and `P-SysCode` may be skipped when the local flow works without them.
- Treat missing `appid` and `syscode` in `trancli dev doctor` as warnings unless the target request explicitly requires them.
- Treat token refresh and expiry as normal behavior.
- Always validate DDL before generating SQL or calling `runSql`.
- Use only fields that exist in the live DDL.
- Use dimensions only for grouping or filtering.
- Generate read-only SQL only.
- If `runSql` returns a request-format error, stop and report the mismatch instead of fabricating results.
- If the user requests dates that may require 2026 data or later, confirm before querying.

## Commands

```powershell
npm config set @transsion:registry https://npm-fe.transsion.com/
npm install -g @transsion/trancli@latest
trancli dev use prod
trancli dev init
trancli dev doctor
trancli curl https://pfgateway.transsion.com/data-chat-bi-pre-service/api/chat/demo/ddl
trancli curl https://pfgateway.transsion.com/data-chat-bi-pre-service/api/chat/demo/runSql
```

Use the last command only with the request body contract from [references/api-contract.md](references/api-contract.md).
