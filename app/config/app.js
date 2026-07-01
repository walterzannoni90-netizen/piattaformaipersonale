module.exports = {
  name: process.env.APP_NAME || 'WES AI Automation',
  url: process.env.APP_URL || 'http://localhost:3000',
  email: process.env.CONTACT_EMAIL || 'info@wesautomation.com',
  phone: process.env.CONTACT_PHONE || '+39 02 1234 5678',
  
  // Plan configuration
  plans: {
    starter: {
      name: 'Starter',
      price: 297,
      setupFee: 1000,
      features: [
        'Fino a 500 lead/mese',
        '1 agente AI',
        'Risposta automatica WhatsApp',
        'Qualificazione lead',
        'Salvataggio CRM',
        'Follow-up automatici',
        'Report settimanale',
        'Email di base',
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
        'Fino a 2.000 lead/mese',
        '3 agenti AI',
        'Tutto dello Starter',
        'Google Calendar integrato',
        'CRM avanzato',
        'Appuntamento automatico',
        'Integrazione webhook',
        'Notifiche commerciale in tempo reale',
        'Template personalizzati',
        'API access',
        'Supporto prioritario'
      ],
      limits: {
        leads_per_month: 2000,
        agents: 3,
        conversations: 5000,
        api_calls: 20000,
        integrations: ['whatsapp', 'email', 'calendar', 'crm', 'webhook']
      }
    },
    enterprise: {
      name: 'Enterprise',
      price: 1500,
      setupFee: 5000,
      features: [
        'Lead illimitati',
        'Agenti AI illimitati',
        'Tutto del Pro',
        'Integrazione n8n/Make',
        'Stripe integrato',
        'White label',
        'SLA garantito',
        'Account manager dedicato',
        'Formazione team',
        'Personalizzazione avanzata',
        'Backup e disaster recovery',
        'Supporto 24/7'
      ],
      limits: {
        leads_per_month: -1, // unlimited
        agents: -1,
        conversations: -1,
        api_calls: -1,
        integrations: ['whatsapp', 'email', 'calendar', 'crm', 'webhook', 'stripe', 'n8n']
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
      description: 'Salva automaticamente lead e conversazioni nel CRM aziendale',
      icon: 'database'
    },
    {
      id: 'auto-appointment',
      name: 'Appuntamento automatico',
      description: 'Propone e conferma appuntamenti in agenda in base alla disponibilità',
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
