# WES — checklist di lancio

Questa checklist è un gate operativo: non contrassegnare una voce senza evidenza verificabile.

## Identità, offerta e contratti

- [ ] Ragione sociale, sede, P. IVA, email privacy e contatti sono definitivi.
- [ ] Privacy, cookie e termini sono stati validati sul trattamento reale.
- [ ] Piano, setup, rinnovo, recesso, imposte e servizi terzi sono nel contratto commerciale.
- [ ] Sono definiti ruoli privacy, DPA, subfornitori e trasferimenti internazionali.
- [ ] È chiarito chi sostiene i consumi OpenRouter, Tavily, Meta, SMTP e Stripe.

## Infrastruttura

- [ ] `APP_URL` usa il dominio HTTPS definitivo.
- [ ] JWT e chiave di cifratura sono casuali, diversi e conservati nel secret manager.
- [ ] Il primo amministratore è stato creato con `npm run create-admin` e le variabili monouso sono state rimosse.
- [ ] Il disco persistente contiene sia database sia workspace.
- [ ] Il servizio usa una sola istanza finché resta su SQLite.
- [ ] Backup automatici e retention sono configurati fuori dall’applicazione.
- [ ] È stata eseguita e documentata una prova di ripristino.
- [ ] Alert su errori, spazio disco, latenza e disponibilità sono attivi.

## Email, AI e canali

- [ ] SMTP di piattaforma invia correttamente il reset password.
- [ ] SPF, DKIM e DMARC del dominio mittente sono verificati.
- [ ] OpenRouter e Tavily funzionano con chiavi limitate e budget controllato.
- [ ] Agent Team è stato provato con i roster 2/4/6, quorum incompleto, Tavily assente e budget massimo per task.
- [ ] WES Skills è stato provato su creazione, aggiornamento concorrente, archivio, blueprint, import/export e limiti di piano.
- [ ] `ALLOW_PUBLIC_REGISTRATION` viene attivata solo dopo aver verificato onboarding, condizioni e controllo dei costi.
- [ ] Webhook Meta usa token privato e firma valida.
- [ ] Webhook Stripe rifiuta firme assenti o errate.
- [ ] Stripe sandbox ha superato eventi duplicati, ritardati, pagamento fallito, rinnovo e cancellazione.
- [ ] Ogni account di prova vede esclusivamente i propri dati e file.

## Qualità e sicurezza

- [ ] CI, build, test e audit dipendenze sono verdi sul commit di rilascio.
- [ ] Upload contraffatti, file grandi, SSRF e traversal sono stati ritestati.
- [ ] Stop, retry, riavvio processo e task pianificati sono stati provati.
- [ ] Cancellazione durante Agent Team e carico concorrente tra più tenant sono stati provati sull’infrastruttura definitiva.
- [ ] Snapshot e isolamento Skills sono stati provati tra tenant; pacchetti alterati e versioni in conflitto vengono rifiutati.
- [ ] Approvazioni e invii esterni sono verificati con account sandbox.
- [ ] Rate limit e log non contengono segreti o contenuti sensibili non necessari.
- [ ] È definito un canale privato per le vulnerabilità.

## Esperienza cliente

- [ ] Registrazione, login, logout e recupero password funzionano da mobile e desktop.
- [ ] Il reset password invalida una sessione aperta su un secondo dispositivo.
- [ ] Empty state e messaggi di configurazione sono comprensibili.
- [ ] Skills Studio, selettore task e Skills ereditate dal progetto sono stati verificati su telefono e desktop.
- [ ] Prezzi e landing non dichiarano capacità o risultati non dimostrabili.
- [ ] Onboarding spiega limiti AI e necessità di verifica umana.
- [ ] Esportazione e cancellazione dati hanno una procedura operativa documentata.
