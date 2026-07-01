/**
 * Email Service (Gmail / SMTP)
 */
const nodemailer = require('nodemailer');
const { getDatabase } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class EmailService {
  constructor() {
    this.transporter = null;
  }

  getTransporter(userId) {
    const db = getDatabase();
    const config = db.prepare('SELECT * FROM api_keys WHERE user_id = ? AND service = "email" AND is_active = 1').get(userId);
    
    if (config) {
      const creds = JSON.parse(config.key_value);
      return nodemailer.createTransport({
        host: creds.host || process.env.SMTP_HOST,
        port: creds.port || process.env.SMTP_PORT,
        secure: false,
        auth: {
          user: creds.user || process.env.SMTP_USER,
          pass: creds.pass || process.env.SMTP_PASS
        }
      });
    }
    
    // Default transporter using env vars
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        secure: false,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });
    }
    
    return null;
  }

  async sendEmail(userId, to, subject, html, from) {
    try {
      const transporter = this.getTransporter(userId);
      if (!transporter) {
        console.log(`[Email] Simulated send to ${to}: ${subject}`);
        return { success: true, messageId: uuidv4(), simulated: true };
      }

      const info = await transporter.sendMail({
        from: from || `"WES AI Automation" <${process.env.SMTP_USER}>`,
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
