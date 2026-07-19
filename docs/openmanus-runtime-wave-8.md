# OpenManus runtime wave 8

Questa fase introduce otto capacità operative nel gateway Node.js che precede la delegazione completa dei task del workspace.

## Capacità introdotte

1. **Modalità di rollout** — `disabled`, `shadow`, `canary` e `primary`.
2. **Canary deterministico** — lo stesso task mantiene sempre la stessa decisione di routing.
3. **Health cache** — il motore non viene interrogato inutilmente per ogni passaggio.
4. **Circuit breaker** — dopo errori consecutivi il gateway interrompe temporaneamente le delegazioni.
5. **Fallback selettivo** — il runtime locale viene usato soltanto per errori infrastrutturali recuperabili.
6. **Idempotency key** — ogni delegazione include una chiave SHA-256 stabile per task, utente e prompt.
7. **Progress normalization** — gli stati Python vengono tradotti in un formato uniforme per la UI WES.
8. **Metriche runtime** — invii, completamenti, errori, cancellazioni, fallback e rifiuti del circuito sono conteggiati.

## Variabili di configurazione

| Variabile | Default | Descrizione |
|---|---:|---|
| `OPENMANUS_RUNTIME_MODE` | `disabled` | Modalità di attivazione del gateway |
| `OPENMANUS_CANARY_PERCENT` | `10` | Percentuale di task autonomi instradati in modalità canary |
| `OPENMANUS_CIRCUIT_FAILURES` | `3` | Errori consecutivi prima dell'apertura del circuito |
| `OPENMANUS_CIRCUIT_RESET_MS` | `60000` | Tempo prima del tentativo di riapertura |
| `OPENMANUS_HEALTH_TTL_MS` | `10000` | Durata della cache di health check |

## Regola di sicurezza

Il gateway parte sempre in modalità `disabled`. L'attivazione richiede una scelta esplicita dell'operatore. I task in modalità `team` non vengono inviati dal canary, così il comportamento multi-agente esistente non cambia accidentalmente.

## Stato della roadmap

Questa fase prepara la delegazione selettiva, ma non sostituisce ancora il ciclo principale di `agentOrchestrator`. Il macro-blocco sarà considerato concluso solo quando il gateway sarà collegato al runtime principale, con persistenza degli eventi WES e test di integrazione end-to-end.
