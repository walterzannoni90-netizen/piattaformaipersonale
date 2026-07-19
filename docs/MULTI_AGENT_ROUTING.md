# Multi-agent orchestration and intelligent tool routing

This layer coordinates four explicit roles: planner, executor, critic, and verifier.

The planner produces or revises the plan. The executor proposes tool tasks. The intelligent router ranks authorized tools using capability coverage, reliability, latency, cost, execution history, and risk. The critic challenges the output, while the verifier decides whether completion criteria were met. Failed reviews trigger a bounded replanning loop.

## Safety properties

- Only tools visible to the current plan and agent role are ranked.
- Required capabilities must meet the configured minimum coverage.
- Higher-risk tools receive a routing penalty.
- Every tool execution still passes through `VerifiedToolRuntime` authorization and output verification.
- Multi-agent runs have a finite round limit.
- Start, completion, and failure events can be journaled to durable memory.

## Remaining integration

The service is deliberately transport-independent. A later integration can connect it to the existing workspace task runtime, semantic memory, observability, and user approval UI without changing its core contract.
