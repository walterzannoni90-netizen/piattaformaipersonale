# Mandatory seventy-agent production hardening

This release strengthens the mandatory 70-agent runtime with bounded timeouts, retry/backoff, resumable checkpoints, exact accounting and deterministic high-volume verification.

## Guarantees

- Startup is refused unless all 70 handlers are registered.
- Every agent has a bounded execution timeout.
- Transient failures can be retried with bounded attempts and delay.
- Completed checkpointed agents are not executed twice after resume.
- Per-agent failures remain isolated unless fail-fast is explicitly enabled.
- Completion is true only when all 70 agents completed.
- Accounting always totals exactly 70 outcomes.

## Verification

The focused suite covers catalog integrity, full completion, transient retry, timeout handling, checkpoint resume and 1,000 deterministic executions across varying concurrency and failure/block combinations.

## Production boundary

This runtime enforces orchestration guarantees. Production readiness still requires real domain capability adapters, secrets, network access, browser infrastructure, model providers, durable storage and deployment configuration to be available in the target environment.
