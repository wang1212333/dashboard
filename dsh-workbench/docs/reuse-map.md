# Dashboard Skill Reuse Map

The `t-agent-skill` archive is reused as policy and validation inspiration, not copied as a runtime dependency.

| Archive capability | Destination module | Adaptation |
| --- | --- | --- |
| Multi-source routing | `src/dashboard-policy/source-routing.ts` | Converts source obligations into deterministic routing decisions. |
| Canonical metric contract | `src/dashboard-policy/metric-contract.ts` | Makes every visible KPI declare definition, unit, grain, timeframe, comparison and evidence. |
| Data reconciliation | `src/dashboard-policy/reconciliation.ts` | Fails on unresolved actual-value, unit and grain conflicts. |
| Business confirmation and sufficiency gate | `src/dashboard-policy/governance.ts` | Requires a confirmed brief, 3–4 KPI contracts, evidence contributions, a comparison, diagnostic, and actions before Draft creation. |
| Offline dashboard rules | `src/dashboard-export/validator.ts` | Validates export-only HTML structure, offline operation and identifier leakage. |
| Data MCP conventions | `src/data-connectors/data-mcp.ts` | Defines a host-injected read-only client and bounded-query guard; it does not load local config or handle tokens. |
| Governed metadata lookup | `src/data-connectors/mcp-contracts.ts` | Reserves host-mounted metadata and data MCP namespaces without embedding credentials. |

The live workbench remains an authenticated online application. The offline validator applies only to an explicit export/snapshot feature.
