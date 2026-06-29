# Desktop Client Interface Contracts

The application is a pure client consuming the backend OpenAPI contract. It also defines its own contract with the local operating system environment.

## 1. Backend OpenAPI Integration Contract
- **Specification Source**: Backend auto-generated OpenAPI contract at `/openapi.json`.
- **Sync mechanism**: Statically typed definitions generated using `openapi-typescript` at build time.
- **Header contract**: Every API request must carry the JWT token:
  ```http
  Authorization: Bearer <jwt-token>
  Accept-Language: ar
  ```

## 2. Configuration file Contract (config.json)
The application expects a file named `config.json` in the same directory as the executable in production, or in the project root in development.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "DesktopAppConfig",
  "type": "object",
  "properties": {
    "apiUrl": {
      "type": "string",
      "description": "Base URL of the backend API server",
      "format": "uri"
    }
  },
  "required": ["apiUrl"],
  "additionalProperties": false
}
```
