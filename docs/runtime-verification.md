# Verified multi-tool runtime

The verified runtime is the execution boundary between autonomous plans and concrete tools.

Each request must pass registry authorization before its handler can run. The runtime then enforces a bounded execution time, prevents duplicate in-flight identifiers, limits serialized output size, and verifies the returned result before exposing it to the planner.

`ResultRecoverySupervisor` evaluates result assertions and chooses a bounded recovery action: retry transient failures, replan invalid outputs, switch to a configured fallback tool, request human intervention, or fail conclusively. Execution events can be appended to durable agent memory for later inspection and recovery.

External side effects remain governed by `ToolRegistry` approval policies. Verification confirms result quality; it does not bypass authorization or human approval requirements.
