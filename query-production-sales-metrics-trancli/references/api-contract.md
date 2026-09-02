# API Contract

## Endpoints

- DDL: `GET https://pfgateway.transsion.com/data-chat-bi-pre-service/api/chat/demo/ddl`
- Query: `POST https://pfgateway.transsion.com/data-chat-bi-pre-service/api/chat/demo/runSql`

## Call Order

Call DDL first. Generate SQL only after DDL succeeds and confirms the required table and fields.

## DDL Success Checks

Confirm all of the following:

1. The response succeeds.
2. `data.tableList` exists.
3. The target table exists in `tableList`.
4. Every field required by the planned SQL exists in `tableFieldList`.

If any check fails, stop and report that the current live metadata does not support the request.

## runSql Request Format

The request body is an array of query objects:

```json
[
  {
    "name": "sales_panel",
    "sql": "select sum(si) as sales from sql_chat_siso_m_en_test"
  },
  {
    "name": "activation_panel",
    "sql": "select sum(so) as activation from sql_chat_siso_m_en_test"
  }
]
```

Minimal smoke-test example:

```json
[
  {
    "name": "sales_panel",
    "sql": "select sum(si) as sales from sql_chat_siso_m_en_test"
  }
]
```

## runSql Response Format

The success shape is:

```json
{
  "code": "200",
  "data": [
    {
      "name": "sales_panel",
      "data": [
        {
          "sales": 373485759
        }
      ]
    }
  ],
  "message": "Success",
  "success": true
}
```

Match returned results by `name`.

## Constraints

- Read-only SQL only.
- Use only fields confirmed by the live DDL.
- Escape filter values before interpolation.
- Do not assume 2026 data exists unless the user explicitly confirms the scope.
- If the service rejects the request format, stop and report the request-format mismatch.
