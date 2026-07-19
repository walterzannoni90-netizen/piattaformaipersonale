# Mandatory 70-agent program

This release defines exactly 70 mandatory operational agents across ten domains. Each domain owns seven explicit roles.

- Browser: navigation, session, forms, downloads, recovery, vision, compliance
- Code: analysis, editing, testing, review, refactor, dependency, release
- Memory: episodic, semantic, vector, graph, retention, retrieval, consolidation
- Planning: decomposition, strategy, scheduling, replanning, constraints, verification, optimization
- Tools: discovery, routing, permissions, sandbox, registry, health, fallback
- Data: ingestion, validation, transformation, quality, lineage, privacy, export
- Operations: telemetry, alerts, cost, capacity, checkpoint, recovery, dashboard
- Security: identity, secrets, policy, audit, threat, isolation, approval
- Evaluation: benchmark, regression, grounding, safety, latency, quality, acceptance
- Product: requirements, UX, documentation, localization, billing, support, readiness

The runtime cannot start unless all 70 handlers are registered. A missing dependency produces `MANDATORY_70_NOT_READY`. Runtime failures are isolated per agent, checkpointed and included in exact completion accounting.

The catalogue establishes enforceable ownership and orchestration contracts. Production capability adapters still require real browser, code execution, persistence, security, observability and deployment infrastructure; registering placeholder handlers is not considered production readiness.
