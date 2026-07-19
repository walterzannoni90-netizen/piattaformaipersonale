# OpenManus Engine

This service is the autonomous Python execution engine used by the WES Node.js product.

It intentionally keeps the web product, users, billing, approvals and persistence in Node.js while delegating general autonomous reasoning and tool execution to OpenManus.

## Source and licence

The engine integrates FoundationAgents/OpenManus, distributed under the MIT licence. The upstream source is installed at image build time and remains replaceable through `OPENMANUS_REPOSITORY` and `OPENMANUS_REF`.

## API

- `GET /health`
- `POST /v1/tasks`
- `GET /v1/tasks/{task_id}`
- `POST /v1/tasks/{task_id}/cancel`

Requests must carry `Authorization: Bearer <OPENMANUS_SERVICE_TOKEN>` when a token is configured.
