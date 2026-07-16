# 🤖 NUMMY

**Smart. Simple. For you.**

NUMMY è una piattaforma completa che permette alle aziende di automatizzare l'intero processo di acquisizione e gestione clienti tramite intelligenza artificiale. Dall'accoglienza del lead alla qualificazione, dalla pianificazione appuntamenti ai follow-up automatici — tutto gestito da agenti AI configurabili.

---

## 📋 Indice

- [Panoramica](#-panoramica)
- [Funzionalità](#-funzionalità)
- [Architettura](#-architettura)
- [Tecnologie](#-tecnologie)
- [Installazione](#-installazione)
- [Configurazione](#-configurazione)
- [Avvio](#-avvio)
- [Struttura del Progetto](#-struttura-del-progetto)
- [Pagine e Route](#-pagine-e-route)
- [API](#-api)
- [Piani e Prezzi](#-piani-e-prezzi)
- [Integrazioni](#-integrazioni)
- [Automazioni](#-automazioni)
- [Sicurezza](#-sicurezza)
- [Licenza](#-licenza)

---

## 🎯 Panoramica

NUMMY risolve un problema comune a molte aziende: **gestire manualmente lead, chat, email, appuntamenti e follow-up** è lento, inefficiente e fa perdere opportunità.

La piattaforma mette un **agente AI** al centro del processo di acquisizione clienti, che:

1. **Accoglie** ogni nuovo lead 24/7 su qualsiasi canale (WhatsApp, sito web, email)
2. **Qualifica** il lead con domande mirate
3. **Salva** automaticamente nel CRM
4. **Propone e fissa** appuntamenti in agenda
5. **Invia follow-up** programmati (1 giorno, 3 giorni)
6. **Notifica** il team commerciale solo per lead qualificati
7. **Genera report** settimanali con statistiche

---

## ✨ Funzionalità

### 🌐 Sito Pubblico
| Pagina | Descrizione |
|--------|-------------|
| **Home** | Hero section, features, stats, CTA |
| **Servizi** | Tutti i servizi di automazione offerti |
| **Casi d'Uso** | Esempi reali per immobiliare, automotive, consulenza |
| **Prezzi** | Piani Starter, Pro, Enterprise con dettagli |
| **Contatti** | Form di contatto con salvataggio lead automatico |
| **Prenota Call** | Booking call con selezione data/ora |
| **Login / Register** | Autenticazione utenti |

### 📊 Dashboard Clienti
| Sezione | Descrizione |
|---------|-------------|
| **Dashboard** | Statistiche in tempo reale, lead recenti, conversazioni |
| **Lead** | Gestione lead con filtro per stato e score |
| **Conversazioni** | Storico chat con lead |
| **Appuntamenti** | Calendario appuntamenti programmati |
| **Follow-up** | Monitoraggio follow-up automatici |
| **Preventivi** | Creazione e gestione preventivi |
| **Automazioni** | Attivazione/disattivazione automazioni |
| **Agente AI** | Configurazione completa dell'agente virtuale |
| **Integrazioni** | Collegamento WhatsApp, Email, Calendar, CRM, Stripe |
| **Statistiche** | Grafici e trend di performance |
| **Impostazioni** | Profilo azienda e configurazioni |

### 🧠 Agente AI Configurabile
- **Nome personalizzato** dell'agente
- **Tono di risposta**: professionale, amichevole, formale, informale, entusiasta
- **Messaggio di benvenuto** personalizzabile
- **Domande di qualificazione** configurabili (con flag "richiesto")
- **Condizioni di trasferimento** al commerciale (score, email, telefono, interesse)
- **Anteprima chat** in tempo reale

### ⚙️ Backend Admin
- Pannello di amministrazione completo
- Gestione utenti e piani
- Log di sistema con filtri e paginazione
- Configurazione piattaforma
- Gestione API keys
- Revenue tracking

---

## 🏗 Architettura

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser (Client)                         │
│         HTML + EJS + Tailwind CSS + JavaScript              │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP
┌──────────────────────────▼──────────────────────────────────┐
│                  Express.js Server                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐ │
│  │  Public  │  │   Auth   │  │Dashboard │  │   Admin    │ │
│  │  Routes  │  │  Routes  │  │  Routes  │  │  Routes    │ │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘ │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐ │
│  │   AI     │  │Automation│  │WhatsApp  │  │   Email    │ │
│  │ Service  │  │  Engine  │  │ Service  │  │  Service   │ │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘ │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐ │
│  │ Calendar │  │  Stripe  │  │Middleware│  │  Database  │ │
│  │ Service  │  │  Service │  │(Auth,JWT)│  │  (SQLite)  │ │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## 🛠 Tecnologie

| Categoria | Tecnologia |
|-----------|-----------|
| **Runtime** | Node.js 22 |
| **Framework** | Express.js 4 |
| **Database** | SQLite (sql.js) |
| **Templating** | EJS |
| **CSS** | Tailwind CSS (CDN) |
| **UI Icons** | Font Awesome 6 |
| **Autenticazione** | JWT + bcryptjs |
| **AI** | OpenRouter API (GPT-4o, Claude, Gemini) |
| **Email** | Nodemailer (SMTP/Gmail) |
| **Pagamenti** | Stripe |
| **WebSocket** | Socket.io (opzionale) |

---

## 📦 Installazione

### Prerequisiti
- [Node.js](https://nodejs.org/) v18 o superiore
- npm (incluso con Node.js)

### Passi

```bash
# 1. Clona il repository
git clone https://github.com/walterzannoni90-netizen/piattaformaipersonale.git
cd piattaformaipersonale

# 2. Installa le dipendenze
npm install

# 3. Configura le variabili d'ambiente
cp .env .env.local
# Modifica .env.local con i tuoi valori

# 4. Avvia il server
npm start
```

---

## ⚙️ Configurazione

### File `.env`

```env
# Server
PORT=3000
NODE_ENV=development

# Database
DB_PATH=./database/nummy.db

# JWT
JWT_SECRET=your-super-secret-key-change-me
JWT_EXPIRES_IN=7d

# OpenRouter AI (obbligatorio per agente funzionante)
OPENROUTER_API_KEY=sk-or-v1-your-key-here
OPENROUTER_MODEL=openai/gpt-4o

# WhatsApp Business API
WHATSAPP_API_KEY=
WHATSAPP_PHONE_ID=

# Email SMTP (Gmail)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tua.email@gmail.com
SMTP_PASS=la-tua-app-password

# Google Calendar OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/integrations/google/callback

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

> **Nota:** Senza `OPENROUTER_API_KEY` l'agente AI non può generare risposte. Puoi ottenere una chiave gratuitamente su [openrouter.ai/keys](https://openrouter.ai/keys).

---

## 🚀 Avvio

```bash
# Ambiente di sviluppo (con hot-reload)
npm run dev

# Produzione
npm start

# Setup database manuale
npm run setup-db
```

Dopo l'avvio, il server sarà disponibile su **http://localhost:3000**

### Demo Accessibile

| Ruolo | Email | Password |
|-------|-------|----------|
| **Admin** | admin@nummy.com | definita da `DEMO_PASSWORD` |
| **Cliente** | demo@azienda.it | definita da `DEMO_PASSWORD` |

Imposta `DEMO_PASSWORD` nel file `.env` prima del setup. Se non è valorizzata, il comando genera una password casuale e la mostra una sola volta nel terminale.

---

## 📁 Struttura del Progetto

```
nummy-platform/
│
├── server.js                    # Entry point principale
├── package.json                 # Dipendenze e script
├── .env                         # Variabili d'ambiente
├── .gitignore                   # File ignorati da git
├── README.md                    # Questa documentazione
│
├── app/
│   ├── config/
│   │   ├── database.js          # Inizializzazione e schema SQLite
│   │   └── app.js               # Configurazione piani e template automazioni
│   │
│   ├── middleware/
│   │   ├── auth.js              # JWT authentication (authenticate, optionalAuth, requireAdmin)
│   │   └── rateLimit.js         # Rate limiting per route pubbliche/API/auth
│   │
│   ├── routes/
│   │   ├── public.js            # Route pubbliche (/, /servizi, /prezzi, etc.)
│   │   ├── auth.js              # Login, registrazione, logout
│   │   ├── dashboard.js         # Dashboard clienti + API interne
│   │   └── admin.js             # Pannello admin + API di amministrazione
│   │
│   ├── services/
│   │   ├── openrouter.js        # Integrazione AI (OpenRouter API)
│   │   ├── automation.js        # Motore automazioni (trigger/action)
│   │   ├── whatsapp.js          # WhatsApp Business API
│   │   ├── email.js             # Servizio email (nodemailer)
│   │   ├── calendar.js          # Google Calendar integration
│   │   └── stripe.js            # Pagamenti e abbonamenti Stripe
│   │
│   ├── views/
│   │   ├── partials/
│   │   │   ├── header.ejs       # Head HTML, meta, CSS
│   │   │   ├── navbar.ejs       # Navbar sito pubblico
│   │   │   ├── dashboard-nav.ejs # Sidebar dashboard
│   │   │   └── footer.ejs       # Footer completo
│   │   │
│   │   ├── public/              # Pagine sito pubblico (10 pagine)
│   │   │   ├── home.ejs
│   │   │   ├── servizi.ejs
│   │   │   ├── casi-uso.ejs
│   │   │   ├── prezzi.ejs
│   │   │   ├── contatti.ejs
│   │   │   ├── prenota-call.ejs
│   │   │   ├── login.ejs
│   │   │   ├── register.ejs
│   │   │   ├── 404.ejs
│   │   │   └── 500.ejs
│   │   │
│   │   ├── dashboard/           # Pagine dashboard (11 pagine)
│   │   │   ├── index.ejs
│   │   │   ├── leads.ejs
│   │   │   ├── conversations.ejs
│   │   │   ├── appointments.ejs
│   │   │   ├── followup.ejs
│   │   │   ├── preventivi.ejs
│   │   │   ├── automations.ejs
│   │   │   ├── agent-config.ejs
│   │   │   ├── integrations.ejs
│   │   │   ├── stats.ejs
│   │   │   └── settings.ejs
│   │   │
│   │   └── admin/               # Pagine admin (6 pagine)
│   │       ├── index.ejs
│   │       ├── users.ejs
│   │       ├── user-detail.ejs
│   │       ├── logs.ejs
│   │       ├── api-keys.ejs
│   │       └── config.ejs
│   │
│   └── public/
│       ├── css/
│       │   └── style.css        # Stili personalizzati
│       └── js/
│           └── main.js          # JavaScript utility lato client
│
└── database/
    ├── setup.js                 # Script setup con dati demo
    └── nummy.db                   # Database SQLite (generato automaticamente)
```

---

## 🧭 Pagine e Route

### Pubbliche (nessuna autenticazione)

| Metodo | Path | Descrizione |
|--------|------|-------------|
| GET | `/` | Homepage |
| GET | `/servizi` | Elenco servizi |
| GET | `/casi-uso` | Casi d'uso reali |
| GET | `/prezzi` | Piani e prezzi |
| GET | `/contatti` | Form contatti |
| POST | `/contatti` | Invio form contatti |
| GET | `/prenota-call` | Prenota call |
| POST | `/prenota-call` | Invia richiesta call |
| GET | `/login` | Pagina login |
| GET | `/register` | Pagina registrazione |
| POST | `/auth/login` | Login (JWT) |
| POST | `/auth/register` | Registrazione nuovo utente |
| POST | `/auth/logout` | Logout |
| GET | `/api/health` | Health check |

### Dashboard (autenticazione richiesta)

| Metodo | Path | Descrizione |
|--------|------|-------------|
| GET | `/dashboard` | Dashboard principale |
| GET | `/dashboard/lead` | Gestione lead |
| GET | `/dashboard/conversazioni` | Conversazioni |
| GET | `/dashboard/appuntamenti` | Appuntamenti |
| GET | `/dashboard/follow-up` | Follow-up |
| GET | `/dashboard/preventivi` | Preventivi |
| GET | `/dashboard/automazioni` | Automazioni |
| GET | `/dashboard/agente` | Configura agente AI |
| GET | `/dashboard/integrazioni` | Integrazioni |
| GET | `/dashboard/statistiche` | Statistiche |
| GET | `/dashboard/impostazioni` | Impostazioni |

### API (autenticazione richiesta via cookie JWT)

| Metodo | Path | Descrizione |
|--------|------|-------------|
| GET | `/api/stats` | Statistiche in tempo reale |
| POST | `/api/agent/save` | Salva configurazione agente |
| POST | `/api/automation/toggle` | Attiva/disattiva automazione |
| POST | `/api/automation/create` | Crea automazione da template |
| POST | `/api/automation/delete` | Elimina automazione |
| POST | `/api/invoice/create` | Crea preventivo |
| POST | `/api/lead/update-status` | Aggiorna stato lead |
| POST | `/api/settings/update` | Aggiorna impostazioni |
| POST | `/api/chat/send` | Invia messaggio all'AI |
| POST | `/api/whatsapp/webhook` | Webhook WhatsApp |

### Admin (ruolo admin richiesto)

| Metodo | Path | Descrizione |
|--------|------|-------------|
| GET | `/admin` | Dashboard admin |
| GET | `/admin/utenti` | Gestione utenti |
| GET | `/admin/utenti/:id` | Dettaglio utente |
| GET | `/admin/logs` | Log di sistema |
| GET | `/admin/api-keys` | API keys |
| GET | `/admin/config` | Configurazione |
| POST | `/api/admin/user/update` | Modifica utente |
| POST | `/api/admin/user/delete` | Elimina utente |
| POST | `/api/admin/logs/clear` | Pulisci log |

---

## 🔌 API

### Health Check
```http
GET /api/health
```
Response:
```json
{
  "status": "ok",
  "timestamp": "2026-07-01T12:00:00.000Z",
  "version": "1.0.0",
  "uptime": 123.45
}
```

### Chat AI
```http
POST /api/chat/send
Content-Type: application/json

{
  "messages": [
    { "role": "user", "content": "Buongiorno, vorrei informazioni" }
  ],
  "agentId": "optional-agent-id"
}
```

### Statistiche
```http
GET /api/stats
Cookie: token=<jwt>
```
Response:
```json
{
  "leads": 42,
  "conversations": 18,
  "appointments": 5,
  "followUps": 12,
  "newLeads": 8,
  "qualifiedLeads": 3
}
```

---

## 💰 Piani e Prezzi

| Caratteristica | Starter | Pro | Enterprise |
|----------------|---------|-----|------------|
| **Prezzo/mese** | 297€ | 597€ | 1.500€ |
| **Setup iniziale** | 1.000€ | 2.000€ | 5.000€ |
| **Lead/mese** | 500 | 2.000 | Illimitati |
| **Agenti AI** | 1 | 3 | Illimitati |
| **Conversazioni** | 1.000 | 5.000 | Illimitate |
| **Risposta WhatsApp** | ✅ | ✅ | ✅ |
| **Qualificazione lead** | ✅ | ✅ | ✅ |
| **Salvataggio CRM** | ✅ | ✅ | ✅ |
| **Follow-up automatici** | ✅ | ✅ | ✅ |
| **Report settimanale** | ✅ | ✅ | ✅ |
| **Google Calendar** | ❌ | ✅ | ✅ |
| **Appuntamento auto** | ❌ | ✅ | ✅ |
| **Webhook** | ❌ | ✅ | ✅ |
| **Notifiche real-time** | ❌ | ✅ | ✅ |
| **Stripe** | ❌ | ❌ | ✅ |
| **n8n/Make** | ❌ | ❌ | ✅ |
| **White label** | ❌ | ❌ | ✅ |
| **Supporto** | Email | Prioritario | 24/7 |

---

## 🔗 Integrazioni

| Servizio | Stato | Descrizione |
|----------|-------|-------------|
| **WhatsApp Business API** | ⚙️ Configurabile | Messaggistica automatica, template, broadcast |
| **Email / Gmail SMTP** | ⚙️ Configurabile | Sequenze email, report, follow-up |
| **Google Calendar** | 🔜 In sviluppo | Sincronizzazione appuntamenti |
| **CRM** | ⚙️ Configurabile | Salvataggio automatico via webhook |
| **Stripe** | ⚙️ Configurabile | Pagamenti ricorrenti, fatturazione |
| **Webhook / API** | ⚙️ Configurabile | Connessione con n8n, Make, Zapier |

---

## ⚡ Automazioni

| Automazione | Trigger | Azioni |
|-------------|---------|--------|
| **Risposta automatica ai lead** | Nuovo lead | Invia messaggio di benvenuto |
| **Qualificazione cliente** | Primo messaggio | Fa domande, calcola score |
| **Salvataggio nel CRM** | Lead qualificato | Salva nel CRM esterno |
| **Appuntamento automatico** | Lead interessato | Propone slot, conferma |
| **Follow-up 1 giorno** | Nessuna risposta 24h | Invia messaggio reminder |
| **Follow-up 3 giorni** | Nessuna risposta 3gg | Invia messaggio approfondito |
| **Notifica commerciale** | Lead qualificato | Notifica team vendite |
| **Report settimanale** | Ogni 7 giorni | Genera stats via email |

---

## 🔒 Sicurezza

- **Autenticazione JWT** con token httpOnly cookie
- **Password hashate** con bcryptjs (10 rounds)
- **Rate limiting** differenziato per route pubbliche, API e auth
- **Helmet** headers di sicurezza
- **CORS** configurato
- **Validazione input** lato server con express-validator
- **SQL injection protetta** tramite prepared statements (sql.js)
- **Sessioni** con secret configurabile
- **Ruoli** admin/client con permessi separati

---

## 🧪 Sviluppo Futuro

- [ ] Integrazione WhatsApp Business API reale
- [ ] Google Calendar OAuth completo
- [ ] Webhook real-time con n8n/Make
- [ ] Dashboard con grafici Chart.js
- [ ] Notifiche email transazionali
- [ ] Autenticazione 2FA
- [ ] API pubblica documentata con Swagger
- [ ] Test unitari e di integrazione
- [ ] Docker containerization
- [ ] CI/CD pipeline
- [ ] Multi-lingua (EN, ES, FR, DE)

---

## 🌐 Deploy su Render (gratuito)

Questo progetto è configurato per il deploy su **Render**:

1. **Crea account** su [Render.com](https://render.com) (gratis)
2. **Collega GitHub**: Dashboard → **New +** → **Blueprint**
3. **Seleziona** il repository `piattaformaipersonale`
4. **Render legge** automaticamente il file `render.yaml`
5. **Imposta manualmente** queste variabili d'ambiente su Render:
   - `OPENROUTER_API_KEY` — Chiave API OpenRouter per AI agent
   - `STRIPE_SECRET_KEY` — Chiave segreta Stripe per pagamenti
   - `WHATSAPP_API_KEY` — API Key WhatsApp Business
   - `GMAIL_USER` e `GMAIL_PASS` — Credenziali Gmail SMTP

**Web Service manuale**:
- **Build Command**: `npm install`
- **Start Command**: `node server.js`
- **Plan**: **Free** ✅

---

## 📄 Licenza

© 2026 NUMMY. Tutti i diritti riservati.

---

<p align="center">
  <strong>NUMMY</strong> — <em>Automazione Intelligente per la Tua Azienda</em><br>
  <a href="mailto:info@nummy.com">info@nummy.com</a> ·
  <a href="https://github.com/walterzannoni90-netizen/piattaformaipersonale">GitHub</a>
</p>
