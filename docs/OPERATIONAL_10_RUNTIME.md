# Operational ten-agent runtime

This release converts the previous capability contracts into a gated operational execution layer.

The ten workstreams are:

1. Persistent browser sessions with recovery
2. Repository analysis and validated code changes
3. Persistent semantic-memory writes and retrieval
4. Approval-gated adaptive improvement
5. Strategic planning with checkpoints
6. Tool discovery through the controlled registry
7. Live observability snapshots
8. Distributed task placement with idempotency
9. Continuous regression evaluation
10. Release-readiness gates covering tests, security and rollback

`OperationalTenRuntime` requires all ten handlers before the unified runtime delegates execution to it. Missing production dependencies fail explicitly with `OPERATIONAL_DEPENDENCY_MISSING`; incomplete runtime wiring fails before task execution with `OPERATIONAL_RUNTIME_NOT_READY`.

Each track records deterministic completion state, duration and optional checkpoints. A release is complete only when all ten tracks complete; failed and blocked tracks remain visible in the final summary.
