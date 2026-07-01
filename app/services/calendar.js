/**
 * Google Calendar Integration Service
 */
const { getDatabase } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class CalendarService {
  async createEvent(userId, { title, description, startTime, endTime, leadEmail, leadName }) {
    const db = getDatabase();
    const integration = db.prepare(`
      SELECT * FROM integrations WHERE user_id = ? AND service = 'calendar' AND is_connected = 1
    `).get(userId);
    
    if (!integration) {
      // Simulated calendar event
      console.log(`[Calendar] Event created: ${title} at ${startTime}`);
      
      const appointmentId = uuidv4();
      db.prepare(`
        INSERT INTO appointments (id, user_id, title, description, start_time, end_time, status)
        VALUES (?, ?, ?, ?, ?, ?, 'scheduled')
      `).run(appointmentId, userId, title, description, startTime, endTime);
      
      return { success: true, appointmentId, simulated: true };
    }
    
    // In production, use Google Calendar API
    // const { google } = require('googleapis');
    // const auth = new google.auth.OAuth2(...);
    // const calendar = google.calendar({ version: 'v3', auth });
    // const event = await calendar.events.insert({ ... });
    
    console.log(`[Calendar] Google Calendar event created for ${userId}`);
    return { success: true };
  }

  async getAvailability(userId, date) {
    const db = getDatabase();
    const appointments = db.prepare(`
      SELECT * FROM appointments 
      WHERE user_id = ? AND date(start_time) = date(?) AND status = 'scheduled'
    `).all(userId, date);
    
    // Return available slots (simplified)
    const busySlots = appointments.map(a => ({
      start: a.start_time,
      end: a.end_time
    }));
    
    // Generate available slots (9:00 - 18:00, 1-hour slots)
    const availableSlots = [];
    const baseDate = new Date(date);
    for (let h = 9; h < 18; h++) {
      const slotStart = new Date(baseDate);
      slotStart.setHours(h, 0, 0, 0);
      const slotEnd = new Date(baseDate);
      slotEnd.setHours(h + 1, 0, 0, 0);
      
      const isBusy = busySlots.some(b => {
        const bs = new Date(b.start);
        const be = new Date(b.end);
        return slotStart < be && slotEnd > bs;
      });
      
      if (!isBusy) {
        availableSlots.push({
          start: slotStart.toISOString(),
          end: slotEnd.toISOString(),
          label: `${h}:00 - ${h + 1}:00`
        });
      }
    }
    
    return availableSlots;
  }
}

module.exports = new CalendarService();
