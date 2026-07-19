# Agent Runtime Roadmap

This document tracks the staged implementation of browser automation, isolated code execution, tool permissions, scalable persistence, observability, and validation.

## Delivery order

1. Browser Agent with Playwright-compatible command schema, explicit approval gates, screenshots, navigation, downloads, and audit events.
2. Isolated execution sandbox with allowlisted operations, timeouts, resource limits, ephemeral workspaces, and no ambient network access.
3. Tool registry with per-plan, per-user, and per-agent permissions.
4. PostgreSQL and object storage adapters introduced behind interfaces, followed by a reversible migration from SQLite/local files.
5. Tracing, usage metering, retry policy, cost attribution, and quality evaluation.
6. Unit, integration, end-to-end, security, and recovery tests.

## Safety invariants

- No model-generated shell command is executed directly.
- External side effects require approval of the exact payload.
- Browser sessions are tenant-scoped and secrets are never emitted to task logs.
- Tool permissions are deny-by-default.
- Storage and database migrations remain reversible until production verification is complete.
- Capabilities not configured or not available are reported explicitly rather than simulated.
