# Six production integration gates

The production runtime now has one fail-closed integration boundary for the six remaining operational areas.

## Required services

1. `agents`: coordinated agent runtime with `health()` and `execute()`.
2. `browser`: real browser driver/runtime with `health()` and `execute()`.
3. `models`: configured model provider with `health()`, `complete()` and `embed()`.
4. `persistence`: durable checkpoint/state service with `health()`, `load()` and `save()`.
5. `sandboxRepository`: isolated command and repository service with `health()`, `execute()`, `read()`, `write()` and `test()`.
6. `endToEnd`: production verification service with `health()` and `run()`.

`ProductionIntegrationHub` refuses to execute when any area is absent or unhealthy. It loads the last checkpoint, injects the real services into the agent execution context, persists success or failure, and requires an end-to-end verification result with `passed: true` before marking a run complete.

## Deployment contract

The application must instantiate the hub with environment-specific implementations. Credentials stay outside source control. A deployment is not production-ready until `hub.health()` returns six ready checks and a representative task passes the end-to-end verifier.

## Safety properties

- Fail-closed startup and execution.
- No silent fallback from the production hub to mock adapters.
- Persisted failure codes for operational diagnosis.
- End-to-end verification is mandatory after agent execution.
- Telemetry records start, completion and failure lifecycle events.
