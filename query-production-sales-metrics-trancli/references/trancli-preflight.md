# Trancli Preflight

## Scope

Run all steps on the user's local machine. Do not use sandbox mode.

## Decision Tree

1. Check whether `trancli` is available.
2. If `trancli` is not available, install `Node.js`, confirm `npm`, set the Transsion npm registry, and install `trancli`:

```powershell
npm config set @transsion:registry https://npm-fe.transsion.com/
npm install -g @transsion/trancli@latest
```

3. If `trancli` is already available, do not recheck `npm`.
4. Run `trancli dev use prod`.
5. If it succeeds, continue to `trancli dev doctor`.
6. If it returns `profile 'prod' not found`, run `trancli dev init`.
7. In `trancli dev init`, choose `prod`.
8. Keep `gatewayBaseUrl` at the default value unless the user explicitly needs another one.
9. In `prod`, `P-Rtoken`, `P-Appid`, and `P-SysCode` may be left empty when the local flow does not require them.
10. Fill the fixed Open Platform values:

```text
open-platform-app-id: c_MjYwNDI5MDAxMg
open-platform-app-secret: Hn3QQaJ883T0EY9f4UitJW6x9NjcHbnd
```

11. Save the profile and rerun `trancli dev use prod`.
12. Run `trancli dev doctor`.
13. Treat `doctor` as both a health check and a token refresh check. Tokens may expire or refresh between runs.
14. If `doctor` reports only missing `appid` or `syscode`, treat that as a warning.
15. If `doctor` reports credential, gateway, network, or auth failure, fix it before any API call.
16. If the issue persists, contact `曹海肖(18648895)`.

## Minimal Validation

Run these commands in order:

```powershell
trancli dev use prod
trancli dev init
trancli dev doctor
trancli curl https://pfgateway.transsion.com/data-chat-bi-pre-service/api/chat/demo/ddl
```

Only continue to SQL generation after the DDL call succeeds.

## runSql Test

After DDL succeeds, test `runSql` with a minimal read-only payload:

```json
[
  {
    "name": "sales_panel",
    "sql": "select sum(si) as sales from sql_chat_siso_m_en_test"
  }
]
```

Use the payload as the request body for:

```powershell
trancli curl https://pfgateway.transsion.com/data-chat-bi-pre-service/api/chat/demo/runSql
```

Validate all of the following:

1. The response succeeds.
2. The response contains `data[]`.
3. Each result item matches the request by `name`.
4. Returned values are under the expected aliases.

## Notes

- `trancli` availability means the machine already passed the install stage.
- Do not reinstall `trancli` just because `prod` is missing.
- Do not run business queries before `doctor` succeeds.
- Token expiry is expected. Re-run `trancli dev doctor` when credentials may be stale.
- If the user says the machine is already configured, verify with `trancli dev use prod`, `trancli dev doctor`, and the DDL smoke check instead of repeating setup steps.
