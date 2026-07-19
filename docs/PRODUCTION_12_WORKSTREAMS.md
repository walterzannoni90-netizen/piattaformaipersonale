# Production autonomy release

This release closes the twelve production workstreams through one coordinated integration branch and one final pull request.

## Workstreams

1. Unified runtime integration
2. Browser runtime wiring
3. Terminal runtime wiring
4. Code-editing runtime wiring
5. Persistent semantic memory
6. Execution-driven self-improvement
7. Verified automatic replanning
8. Process-level sandbox controls
9. Durable checkpoint and resume
10. Signed, permission-scoped plugins
11. Live telemetry and health snapshots
12. Cost, latency and token optimization

Each workstream has an isolated owner contract and is integrated through `createProductionAutonomyRuntime`. The unified task runtime can opt into the production runtime while preserving the legacy path as a controlled fallback.

A production task is complete only when every capability track reports completed, no track reports partial, and no track fails. Checkpoints preserve incomplete results for recovery.

Branding and documentation in this release use only the project's own product identity. Third-party license and attribution files, when legally required, must remain intact.
