function isRegistrationOpen() {
  const configured = String(process.env.ALLOW_PUBLIC_REGISTRATION || '').toLowerCase();
  if (configured === 'true') return true;
  if (configured === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

module.exports = {
  isRegistrationOpen,
  name: process.env.APP_NAME || 'WES AI Automation',
  url: process.env.APP_URL || 'http://localhost:3000',
  email: process.env.CONTACT_EMAIL || 'info@wesautomation.com',
  phone: process.env.CONTACT_PHONE || '',
  
  // Plan configuration
  plans: {
    starter: {
      name: 'Starter',
      price: 297,
      setupFee: 1000,
      features: [
        '20 task autonomi al giorno',
        '2 task contemporanei',
        'Workspace privato con file',
        'Python per fogli, documenti e dati',
        'Ricerca web con fonti',
        'CRM e agente commerciale',
        'Progetti con memoria',
        'Approvazioni di sicurezza',
        'Supporto email'
      ],
      limits: {
        leads_per_month: 500,
        agents: 1,
        conversations: 1000,
        api_calls: 5000,
        integrations: ['whatsapp', 'email']
      }
    },
    pro: {
      name: 'Pro',
      price: 597,
      setupFee: 2000,
      features: [
        '100 task autonomi al giorno',
        '5 task contemporanei',
        'Tutto dello Starter',
        'Memoria avanzata per progetto',
        'CRM e automazioni complete',
        'WhatsApp Cloud API e SMTP verificati',
        'Output e template personalizzati',
        'Fino a 20 task pianificati',
        'Agenda e conversation center',
        'Supporto prioritario'
      ],
      limits: {
        leads_per_month: 2000,
        agents: 3,
        conversations: 5000,
        api_calls: 20000,
        integrations: ['whatsapp', 'email']
      }
    },
    enterprise: {
      name: 'Enterprise',
      price: 1500,
      setupFee: 5000,
      features: [
        'Fino a 500 task al giorno',
        '10 task contemporanei',
        'Tutto del Pro',
        'Connettori personalizzati su progetto',
        'Branding e distribuzione su progetto',
        'Ambienti e policy dedicate',
        'Responsabile tecnico dedicato',
        'Formazione team',
        'Personalizzazione avanzata',
        'Piano di backup concordato',
        'Canale di supporto dedicato'
      ],
      limits: {
        leads_per_month: -1, // unlimited
        agents: -1,
        conversations: -1,
        api_calls: -1,
        integrations: ['whatsapp', 'email']
      }
    }
  },
  
  // Automation templates
  automationTemplates: [
    {
      id: 'auto-response',
      name: 'Risposta automatica ai lead',
      description: 'Risponde immediatamente ai nuovi lead con un messaggio personalizzato',
      icon: 'reply'
    },
    {
      id: 'qualify-lead',
      name: 'Qualificazione cliente',
      description: 'Pone domande specifiche per qualificare il lead prima del passaggio al commerciale',
      icon: 'filter'
    },
    {
      id: 'save-crm',
      name: 'Salvataggio nel CRM',
      description: 'Conferma e aggiorna lead e conversazioni nel CRM interno WES',
      icon: 'database'
    },
    {
      id: 'auto-appointment',
      name: 'Appuntamento automatico',
      description: 'Registra una richiesta di appuntamento da verificare prima della conferma',
      icon: 'calendar'
    },
    {
      id: 'followup-1day',
      name: 'Follow-up dopo 1 giorno',
      description: 'Invia un messaggio di follow-up 24 ore dopo il primo contatto',
      icon: 'clock'
    },
    {
      id: 'followup-3days',
      name: 'Follow-up dopo 3 giorni',
      description: 'Invia un follow-up più approfondito dopo 3 giorni senza risposta',
      icon: 'clock'
    },
    {
      id: 'notify-sales',
      name: 'Notifica al commerciale',
      description: 'Invia notifica immediata al team vendite per lead qualificati',
      icon: 'bell'
    },
    {
      id: 'weekly-report',
      name: 'Report settimanale',
      description: 'Genera e invia un report settimanale con statistiche e trend',
      icon: 'bar-chart'
    }
  ]
};
