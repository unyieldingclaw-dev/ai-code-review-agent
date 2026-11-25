# Logging Standard — Essentials

Core rules for writing logs in any project.

## Rules

1. **Structured format** — use key-value pairs or JSON, not f-string concatenation.
2. **Use log levels** — `DEBUG` (dev details), `INFO` (significant events), `WARN` (unexpected but handled), `ERROR` (failures).
3. **Never log secrets** — no credentials, API keys, tokens, or passwords in logs, ever.
4. **Log the event, not the string** — log what happened and relevant IDs, not a sentence.

## Python

```python
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)

# Good: structured, queryable
logger.info("user_authenticated", extra={"user_id": user_id, "method": "oauth"})

# Bad: f-string, unqueryable, secrets exposed
logger.info(f"User {username} logged in with password {password}")  # Never
```

## TypeScript

```typescript
const log = (level: string, event: string, data?: Record<string, unknown>) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, ...data }));

// Good
log("INFO", "user_authenticated", { userId });

// Bad: logging secrets
log("INFO", "db_connect", { password });  // Never
```

## Log Level Guide

| Level | When to use |
|-------|-------------|
| `DEBUG` | Dev details — gate behind env var in prod |
| `INFO` | Successful significant events |
| `WARN` | Handled edge cases, degraded behavior |
| `ERROR` | Failures that need attention |

## What Never to Log

- Passwords, API keys, tokens, secrets of any kind
- Full request/response bodies from external APIs (may contain embedded secrets)
- Verbose per-row database output in production loops
