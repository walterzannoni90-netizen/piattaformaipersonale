const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');

const views = path.resolve(__dirname, '../app/views/dashboard');
const globals = {
  currentUser: { company: 'Test', email: 'test@example.com' },
  contactEmail: 'test@example.com', contactPhone: '+39 000',
  contactLocation: 'Roma',
  legal: { name: 'WES Test Srl', address: 'Roma', vat: 'IT000', privacyEmail: 'privacy@example.com', reviewed: false },
  appName: 'WES', appUrl: 'http://localhost:3000', currentPath: '/', registrationOpen: true,
  signupUrl: '/register', signupLabel: 'Prova WES', success: null, error: null
};

test('workspace and task views render safely', async () => {
  const workspace = await ejs.renderFile(path.join(views, 'workspace.ejs'), {
    ...globals, title: 'Workspace', page: 'workspace', counts: { total: 0, running: 0, done: 0 }, projects: [], schedules: [], tasks: []
  });
  assert.match(workspace, /WES Autonomous Intelligence/);

  const task = await ejs.renderFile(path.join(views, 'task.ejs'), {
    ...globals, title: 'Task', page: 'workspace',
    task: { id: 'safe', title: 'Test', prompt: '<script>alert(1)</script>', status: 'running', progress: 25, current_step: 0, project_name: null, error: null, result: null },
    parsedPlan: [{ title: 'Step', description: 'Safe', tool: 'reasoning' }], events: [], artifacts: [], approvals: [], files: []
  });
  assert.doesNotMatch(task, /<script>alert\(1\)<\/script>/);
  assert.match(task, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('operational CRM views render real controls without placeholder alerts', async () => {
  const appointments = await ejs.renderFile(path.join(views, 'appointments.ejs'), {
    ...globals, currentPath: '/dashboard/appuntamenti', title: 'Appuntamenti', page: 'appointments',
    appointments: [], leads: []
  });
  assert.match(appointments, /Nuovo appuntamento/);
  assert.doesNotMatch(appointments, /in arrivo|alert\(/i);
  const conversations = await ejs.renderFile(path.join(views, 'conversations.ejs'), {
    ...globals, currentPath: '/dashboard/conversazioni', title: 'Conversazioni', page: 'conversations',
    conversations: [], selectedConversation: null
  });
  assert.match(conversations, /Conversation center/i);
  assert.doesNotMatch(conversations, /chat simulata/i);
  const leadDetail = await ejs.renderFile(path.join(views, 'lead-detail.ejs'), {
    ...globals, currentPath: '/dashboard/lead/safe', title: 'Lead', page: 'leads',
    lead: { id: 'safe', name: '<script>unsafe</script>', email: 'lead@example.test', phone: '', source: 'manual', status: 'new', score: 0, notes: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    conversations: [], appointments: [], followUps: [], invoices: []
  });
  assert.match(leadDetail, /Scheda lead/);
  assert.doesNotMatch(leadDetail, /<script>unsafe<\/script>/);
});

test('analytics view displays measured distributions instead of fixed estimates', async () => {
  const output = await ejs.renderFile(path.join(views, 'stats.ejs'), {
    ...globals, currentPath: '/dashboard/statistiche', title: 'Statistiche', page: 'stats', usageStats: [],
    totalStats: { totalLeads: { count: 4 }, totalConversations: { count: 0 }, totalAppointments: { count: 0 }, totalFollowUps: { count: 0 }, conversionRate: 25 },
    sourceStats: [{ key: 'whatsapp', count: 3, percentage: 75 }, { key: 'website', count: 1, percentage: 25 }],
    statusStats: [{ key: 'new', count: 2, percentage: 50 }, { key: 'converted', count: 1, percentage: 25 }]
  });
  assert.match(output, /3 · 75%/);
  assert.match(output, /Pipeline corrente, senza stime/);
  assert.doesNotMatch(output, /totalLeads\.count \* 0\./);
});

test('public autonomous product pages render without fabricated case-study markup', async () => {
  const publicViews = path.resolve(__dirname, '../app/views/public');
  const home = await ejs.renderFile(path.join(publicViews, 'home.ejs'), { ...globals, title: 'WES' });
  const services = await ejs.renderFile(path.join(publicViews, 'servizi.ejs'), { ...globals, currentPath: '/servizi', title: 'Servizi' });
  const cases = await ejs.renderFile(path.join(publicViews, 'casi-uso.ejs'), { ...globals, currentPath: '/casi-uso', title: 'Casi' });
  assert.match(home, /Non chiedergli come/);
  assert.match(services, /Analisi dati con Python/);
  assert.match(cases, /Questi sono esempi di flussi supportati/);
  assert.doesNotMatch(cases, /\+340%|testimonial-card|case-study-result/i);
  const closedHome = await ejs.renderFile(path.join(publicViews, 'home.ejs'), {
    ...globals, currentUser: null, title: 'WES', registrationOpen: false, signupUrl: '/prenota-call', signupLabel: 'Richiedi accesso'
  });
  assert.match(closedHome, /href="\/prenota-call"[^>]*>[^<]*<i[^>]*><\/i> Richiedi accesso/);
});

test('commercial, auth and legal pages all render with local frontend assets', async () => {
  const publicViews = path.resolve(__dirname, '../app/views/public');
  const appConfig = require('../app/config/app');
  const pages = [
    ['prezzi.ejs', { currentPath: '/prezzi', plans: appConfig.plans }],
    ['contatti.ejs', { currentPath: '/contatti' }],
    ['prenota-call.ejs', { currentPath: '/prenota-call' }],
    ['login.ejs', { currentPath: '/login', redirect: '', error: null }],
    ['register.ejs', { currentPath: '/register', error: null }],
    ['forgot-password.ejs', { currentPath: '/password-dimenticata', submitted: false, error: null }],
    ['reset-password.ejs', { currentPath: '/reset-password', valid: true, token: 'safe-token', error: null }],
    ['privacy.ejs', { currentPath: '/privacy' }],
    ['cookie.ejs', { currentPath: '/cookie' }],
    ['termini.ejs', { currentPath: '/termini' }]
  ];
  for (const [file, locals] of pages) {
    const output = await ejs.renderFile(path.join(publicViews, file), { ...globals, title: 'WES', ...locals });
    assert.match(output, /\/css\/tailwind\.css/);
    assert.doesNotMatch(output, /cdn\.tailwindcss|cdnjs|fonts\.googleapis|images\.unsplash/i);
  }
});
