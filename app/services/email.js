/**
 * Email Service (Gmail / SMTP)
 */
const nodemailer = require('nodemailer');
const { getDatabase } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const secretVault = require('./secretVault');
const safeWeb = require('./safeWeb');

class EmailService {
  constructor() {
    this.transporter = null;
  }

  async getTransporter(userId, suppliedConfig = null) {
    const db = getDatabase();
    const config = db.prepare('SELECT * FROM api_keys WHERE user_id = ? AND service = "email" AND is_active = 1').get(userId);
    let creds = suppliedConfig;
    if (!creds && config) {
      try { creds = JSON.parse(secretVault.open(config.key_value)); } catch { return null; }
    }
    if (!creds && process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      creds = { host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, user: process.env.SMTP_USER, pass: process.env.SMTP_PASS };
    }
    if (!creds?.host || !creds?.user || !creds?.pass) return null;
    const port = Number(creds.port || 587);
    if (![465, 587].includes(port)) throw new Error('Porta SMTP non consentita');
    const resolved = await safeWeb.resolvePublicHost(creds.host);
    const transporter = nodemailer.createTransport({
      host: resolved.address,
      port,
      secure: port === 465,
      requireTLS: port === 587,
      connectionTimeout: 12_000,
      greetingTimeout: 12_000,
      socketTimeout: 20_000,
      auth: { user: creds.user, pass: creds.pass },
      tls: { servername: resolved.hostname, rejectUnauthorized: true }
    });
    return { transporter, from: creds.from || creds.user };
  }

  async verifyCredentials(creds) {
    const configured = await this.getTransporter('__verification__', creds);
    if (!configured) throw new Error('Configurazione SMTP incompleta');
    await configured.transporter.verify();
    return true;
  }

  async sendPlatformEmail(to, subject, html) {
    const creds = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS ? {
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT || 587,
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      from: process.env.SMTP_FROM || process.env.SMTP_USER
    } : null;
    if (!creds) return { success: false, error: 'SMTP di piattaforma non configurato' };
    try {
      const configured = await this.getTransporter('__platform__', creds);
      const info = await configured.transporter.sendMail({
        from: `"WES Autonomous Intelligence" <${configured.from}>`,
        to,
        subject,
        html
      });
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('Platform email error:', error.message);
      return { success: false, error: error.message };
    }
  }

  async sendEmail(userId, to, subject, html, from) {
    try {
      const configured = await this.getTransporter(userId);
      if (!configured) {
        return { success: false, error: 'Email SMTP non configurata' };
      }

      const info = await configured.transporter.sendMail({
        from: from || `"WES AI Automation" <${configured.from}>`,
        to,
        subject,
        html
      });

      // Log the email
      const db = getDatabase();
      db.prepare(`
        INSERT INTO logs (id, user_id, level, action, details)
        VALUES (?, ?, 'info', 'email_sent', ?)
      `).run(uuidv4(), userId, JSON.stringify({ to, subject, messageId: info.messageId }));

      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('Email error:', error);
      return { success: false, error: error.message };
    }
  }

  async sendWelcomeEmail(userId, to, companyName) {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #6C63FF;">Benvenuto in ${companyName}!</h1>
        <p>Grazie per averci contattato. Riceverai nostre notizie a breve.</p>
        <p>Il team di ${companyName}</p>
      </div>
    `;
    return this.sendEmail(userId, to, 'Benvenuto!', html);
  }

  async sendWeeklyReport(userId, to, stats) {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #6C63FF;">Report Settimanale</h1>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd;">Lead ricevuti</td>
            <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">${stats.leads || 0}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd;">Conversazioni attive</td>
            <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">${stats.conversations || 0}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd;">Appuntamenti</td>
            <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">${stats.appointments || 0}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd;">Follow-up inviati</td>
            <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">${stats.followups || 0}</td>
          </tr>
        </table>
      </div>
    `;
    return this.sendEmail(userId, to, 'Report Settimanale WES AI', html);
  }
}

module.exports = new EmailService();
