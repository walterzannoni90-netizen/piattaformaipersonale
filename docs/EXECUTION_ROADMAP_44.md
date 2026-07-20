# WES — Programma esecutivo 44 punti

Questo documento trasforma il backlog di prodotto in gate verificabili. Un punto è completato soltanto quando codice, test, migrazione, documentazione e rollback sono presenti.

## Regole di esecuzione

- Nessuna azione esterna viene ripetuta automaticamente.
- Ogni modifica infrastrutturale deve includere migrazione e rollback.
- Ogni funzione critica deve avere test unitari, integrazione ed E2E.
- Ogni release deve mantenere compatibilità con task persistiti e dati esistenti.
- Le affermazioni comparative richiedono benchmark riproducibili.

## Gate A — Runtime unico e recovery

- [x] 1. Delegare `agentOrchestrator.runTask` a `runtimeCoordinator`.
- [x] 2. Rimuovere il ciclo legacy dopo una fase di compatibilità controllata.
- [x] 3. Migrare task legacy, snapshot, approval e task interrotti in modo idempotente.
- [ ] 4. Collegare Playwright reale al browser runtime.
- [ ] 5. Aggiungere comprensione visuale con verifica prima/dopo.
- [ ] 6. Rendere persistenti e isolate le sessioni browser.
- [ ] 7. Proteggere il browser da prompt injection e contenuti non affidabili.

**Criteri di uscita:** nessun doppio executor, nessuna doppia consegna, recovery testato dopo crash, approvazioni esatte preservate.

## Gate B — Tool e connettori

- [ ] 8. Evolvere `ToolRegistry` con schema input/output, rischio, costo, timeout, retry e compensazione.
- [ ] 9. Completare connettori reali: Gmail, Calendar, Drive, GitHub, Slack, Notion, Microsoft 365, Dropbox, CRM e API HTTP.
- [ ] 10. Implementare flusso GitHub completo: branch, modifiche, test, CI, commit, PR e review.
- [ ] 11. Ampliare analisi file: PDF, DOCX, XLSX, PPTX, immagini, ZIP, grandi dataset e documenti scansionati.

**Criteri di uscita:** token refresh, revoca, timeout, errori normalizzati, audit e test sandbox per ogni connettore.

## Gate C — Qualità dell’agente

- [ ] 12. Planner gerarchico con sotto-obiettivi, dipendenze, budget e criteri di successo.
- [ ] 13. Esecuzione parallela degli step indipendenti con limiti e priorità.
- [ ] 14. Separare esecutore, verificatore e red team.
- [ ] 15. Valutare completezza, fonti, numeri, formato, coerenza e successo reale delle azioni.
- [ ] 16. Auto-correzione controllata con confronto fra tentativi e limiti espliciti.

**Criteri di uscita:** benchmark interni con success rate, costo e interventi umani; nessun retry cieco di effetti esterni.

## Gate D — Memoria

- [ ] 17. Memoria semantica persistente con embeddings, namespace, deduplicazione e scadenza.
- [ ] 18. Memoria delle procedure riuscite e fallite, con provenienza verificabile.
- [ ] 19. Controlli utente per visualizzare, correggere, eliminare, esportare e disattivare la memoria.

**Criteri di uscita:** isolamento tenant, cancellazione verificabile, metriche di precisione del retrieval.

## Gate E — Infrastruttura

- [ ] 20. Migrare da SQLite a PostgreSQL con migrazioni e rollback.
- [ ] 21. Introdurre coda esterna con leasing, heartbeat, retry, priorità e dead-letter queue.
- [ ] 22. Spostare i file su object storage con URL firmati, cifratura, retention e antivirus.
- [ ] 23. Separare API, worker agenti, worker browser, worker Python, scheduler e notifiche.

**Criteri di uscita:** esecuzione multi-istanza, test di failover, backup e ripristino documentati.

## Gate F — Sicurezza

- [ ] 24. Sandbox effimera per Python con CPU, RAM, timeout, filesystem e rete limitati.
- [ ] 25. Gestione segreti con rotazione, revoca, versionamento e audit.
- [ ] 26. Aggiungere 2FA, passkey, gestione sessioni e recovery codes.
- [ ] 27. Verificare isolamento tenant per task, file, browser, memoria, approval, integrazioni e billing.
- [ ] 28. Rendere l’audit trail append-only e correlato a modello, costo, payload, hash e risultato.

**Criteri di uscita:** threat model aggiornato, test automatici e nessuna vulnerabilità critica aperta.

## Gate G — Test e benchmark

- [ ] 29. E2E Playwright completi dell’interfaccia e dei percorsi mobile.
- [ ] 30. Test di crash e recovery durante step, checkpoint, invii e guasti provider.
- [ ] 31. Test sicurezza: SSRF, traversal, XSS, CSRF, injection, replay, webhook e cross-tenant.
- [ ] 32. Load test su task, browser, file, memoria, latenza e costi.
- [ ] 33. Suite benchmark riproducibile per ricerca, coding, browser, file, CRM e recovery.
- [ ] 34. Metriche comparative: successo, tempo, costo, tentativi, qualità, fonti e duplicazioni.

**Criteri di uscita:** report versionato, dataset congelato, risultati ripetibili e limiti dichiarati.

## Gate H — UX e prodotto

- [ ] 35. Timeline chiara con step, motivazioni, costi, fonti, errori e recovery.
- [ ] 36. Editor del piano con budget, priorità e strumenti consentiti.
- [ ] 37. Centro approvazioni con diff del payload, rischio, scadenza e modifica prima del consenso.
- [ ] 38. Esperienza mobile completa con notifiche, approvazioni e stop rapido.

**Criteri di uscita:** usability test, accessibilità, responsive e nessun percorso critico solo desktop.

## Gate I — SaaS e pagamenti

- [ ] 39. Definire piani Starter, Pro, Business ed Enterprise con limiti applicati lato server.
- [ ] 40. Tracciare costi reali per token, web, browser, Python, storage e invii.
- [ ] 41. Completare Stripe: checkout, webhook idempotenti, rinnovi, upgrade, downgrade, rimborsi e fatture.

**Criteri di uscita:** reconciliation, test webhook, protezione replay e margine misurabile per task.

## Gate J — Produzione

- [ ] 42. Osservabilità con error tracking, metriche, tracing, dashboard e alert.
- [ ] 43. Backup e disaster recovery con prove periodiche di ripristino.
- [ ] 44. Deploy professionale e release candidate pubblica con staging, rollback, policy legali, privacy, supporto e status page.

**Criteri di uscita:** runbook operativo, SLO, rollback testato e release candidate approvata.

## Ordine vincolante

1. Gate A prima di ampliare browser o connettori.
2. Gate E e F prima della beta pubblica.
3. Gate G prima di dichiarazioni comparative.
4. Gate I e J soltanto dopo isolamento tenant, audit e recovery verificati.

## Stato iniziale

Il repository possiede già planner deterministico, executor resiliente, checkpoint, recovery, memoria operativa, runtime browser autorizzato, runtime unificato e persistenza durevole. Il primo lavoro esecutivo rimane la delegazione completa di `agentOrchestrator.runTask` al coordinator e la rimozione controllata del loop legacy.