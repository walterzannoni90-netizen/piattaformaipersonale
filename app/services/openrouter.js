/**
 * OpenRouter AI Service
 * Handles communication with OpenRouter API for AI agent responses
 */
const axios = require('axios');

const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';

function getConfig(userSettings = {}) {
  return {
    apiKey: process.env.OPENROUTER_API_KEY || userSettings.openrouterApiKey,
    model: process.env.OPENROUTER_MODEL || userSettings.openrouterModel || 'openai/gpt-4o'
  };
}

async function generateResponse(messages, agent, userSettings = {}) {
  const config = getConfig(userSettings);
  
  if (!config.apiKey) {
    throw new Error('API Key OpenRouter non configurata');
  }
  
  const systemPrompt = buildSystemPrompt(agent);
  
  const payload = {
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages
    ],
    temperature: 0.7,
    max_tokens: 500
  };
  
  try {
    const response = await axios.post(OPENROUTER_API, payload, {
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
        'X-Title': 'WES AI Automation'
      },
      timeout: 15000
    });
    
    return {
      success: true,
      content: response.data.choices[0].message.content,
      model: response.data.model,
      usage: response.data.usage
    };
  } catch (error) {
    console.error('OpenRouter API Error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.error?.message || error.message,
      content: 'Mi dispiace, ho avuto un problema tecnico. Puoi riprovare?'
    };
  }
}

function buildSystemPrompt(agent) {
  const tone = agent.tone || 'professionale';
  const name = agent.name || 'Agente WES';
  const company = agent.company_name || 'la nostra azienda';
  const sector = agent.sector || '';
  const services = agent.services || [];
  const questions = agent.qualification_questions || [];
  
  let prompt = `Sei ${name}, un assistente virtuale per ${company}.`;
  
  if (sector) {
    prompt += ` Operi nel settore: ${sector}.`;
  }
  
  if (services.length > 0) {
    prompt += `\n\nServizi offerti:\n${services.map(s => `- ${s}`).join('\n')}`;
  }
  
  prompt += `\n\nTono di risposta: ${tone}.`;
  prompt += `\n\nRegole:\n- Rispondi in modo ${tone} e cortese`;
  prompt += `\n- Se il lead chiede informazioni specifiche, fornisci dettagli sui servizi`;
  prompt += `\n- Fai domande per qualificare il lead quando opportuno`;
  prompt += `\n- Se il lead è qualificato (interessato, ha lasciato contatti), proponi un appuntamento`;
  prompt += `\n- Non inventare informazioni non verificate`;
  prompt += `\n- Se non sai rispondere, chiedi di contattare il team commerciale`;
  prompt += `\n- Rispondi sempre in ITALIANO`;
  
  if (questions.length > 0) {
    prompt += `\n\nDomande da fare ai lead per qualificarli:\n`;
    questions.forEach((q, i) => {
      prompt += `${i + 1}. ${q.question}${q.required ? ' (richiesto)' : ''}\n`;
    });
  }
  
  return prompt;
}

async function analyzeSentiment(text) {
  const config = getConfig();
  if (!config.apiKey) return 'neutro';
  
  try {
    const response = await axios.post(OPENROUTER_API, {
      model: config.model,
      messages: [
        { role: 'system', content: 'Analizza il sentiment del seguente messaggio. Rispondi solo con: positivo, negativo, neutro' },
        { role: 'user', content: text }
      ],
      temperature: 0,
      max_tokens: 10
    }, {
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    return response.data.choices[0].message.content.toLowerCase().trim();
  } catch (error) {
    return 'neutro';
  }
}

module.exports = { generateResponse, analyzeSentiment, buildSystemPrompt };
