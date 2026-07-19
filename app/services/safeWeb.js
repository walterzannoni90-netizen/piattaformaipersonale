const axios = require('axios');
const dns = require('dns');
const dnsPromises = dns.promises;
const http = require('http');
const https = require('https');
const net = require('net');

const MAX_WEB_BYTES = Number(process.env.AGENT_MAX_WEB_BYTES || 2 * 1024 * 1024);

function isPrivateIpv4(address) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return true;
  const [a, b, c] = octets;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113);
}

function isPrivateIp(address) {
  if (net.isIP(address) === 4) return isPrivateIpv4(address);
  if (net.isIP(address) !== 6) return true;
  const lower = address.toLowerCase();
  if (lower.startsWith('::ffff:')) return isPrivateIpv4(lower.slice(7));
  const firstHextet = Number.parseInt(lower.split(':')[0], 16);
  const outsideGlobalUnicast = !Number.isInteger(firstHextet) || firstHextet < 0x2000 || firstHextet > 0x3fff;
  return lower === '::' || lower === '::1' || outsideGlobalUnicast || lower.startsWith('fc') || lower.startsWith('fd') ||
    /^fe[89ab]/.test(lower) || lower.startsWith('ff') || lower.startsWith('2001:db8') ||
    lower.startsWith('2001:0000') || lower.startsWith('2002:');
}

async function validatePublicUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(rawUrl); } catch { throw new Error('URL non valido'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Protocollo URL non consentito');
  if (parsed.username || parsed.password) throw new Error('Credenziali nell’URL non consentite');
  if (parsed.port && !['80', '443'].includes(parsed.port)) throw new Error('Porta URL non consentita');
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  await resolvePublicHost(hostname);
  return parsed;
}

async function resolvePublicHost(rawHost) {
  const hostname = String(rawHost || '').toLowerCase().replace(/\.$/, '');
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('Host non consentito');
  }
  const addresses = net.isIP(hostname) ? [{ address: hostname }] : await dnsPromises.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isPrivateIp(entry.address))) throw new Error('Rete privata o riservata non consentita');
  return { hostname, address: addresses[0].address, family: addresses[0].family || net.isIP(addresses[0].address) };
}

function publicLookup(hostname, options, callback) {
  const lookupOptions = typeof options === 'object' ? options : { family: options };
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) return callback(new Error('Rete privata o riservata non consentita'));
    return callback(null, hostname, net.isIP(hostname));
  }
  dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some((entry) => isPrivateIp(entry.address))) {
      return callback(new Error('Rete privata o riservata non consentita'));
    }
    const requestedFamily = Number(lookupOptions.family || 0);
    const candidates = requestedFamily ? addresses.filter((entry) => entry.family === requestedFamily) : addresses;
    if (!candidates.length) return callback(new Error('Nessun indirizzo pubblico compatibile'));
    if (lookupOptions.all) return callback(null, candidates);
    return callback(null, candidates[0].address, candidates[0].family);
  });
}

const httpAgent = new http.Agent({ lookup: publicLookup });
const httpsAgent = new https.Agent({ lookup: publicLookup });

function htmlToText(value) {
  return String(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ').trim();
}

async function fetchPublicPage(rawUrl, redirectCount = 0) {
  const parsed = await validatePublicUrl(rawUrl);
  const response = await axios.get(parsed.toString(), {
    responseType: 'arraybuffer',
    timeout: 15_000,
    maxContentLength: MAX_WEB_BYTES,
    maxBodyLength: MAX_WEB_BYTES,
    maxRedirects: 0,
    proxy: false,
    httpAgent,
    httpsAgent,
    validateStatus: (status) => status >= 200 && status < 400,
    headers: { 'User-Agent': 'WES-Agent/1.0 (+safe-research-fetch)', Accept: 'text/html,text/plain,application/json' }
  });
  if (response.status >= 300) {
    if (redirectCount >= 3 || !response.headers.location) throw new Error('Troppi reindirizzamenti');
    return fetchPublicPage(new URL(response.headers.location, parsed).toString(), redirectCount + 1);
  }
  const type = String(response.headers['content-type'] || '').toLowerCase();
  if (!/(text\/|application\/(json|xml|xhtml))/.test(type)) throw new Error('Contenuto web non testuale');
  const raw = Buffer.from(response.data).toString('utf8').slice(0, MAX_WEB_BYTES);
  return { url: parsed.toString(), contentType: type, text: type.includes('html') ? htmlToText(raw) : raw };
}

async function searchWeb(query, userApiKey) {
  const cleanQuery = String(query || '').trim().slice(0, 500);
  if (!cleanQuery) throw new Error('Query di ricerca mancante');
  const apiKey = userApiKey || process.env.TAVILY_API_KEY;
  if (!apiKey) {
    const error = new Error('Configura TAVILY_API_KEY per abilitare la ricerca web autonoma.');
    error.code = 'WEB_NOT_CONFIGURED';
    throw error;
  }
  const response = await axios.post('https://api.tavily.com/search', {
    api_key: apiKey,
    query: cleanQuery,
    search_depth: 'advanced',
    max_results: 8,
    include_answer: false,
    include_raw_content: false
  }, { timeout: 30_000, maxContentLength: MAX_WEB_BYTES });
  return (response.data.results || []).slice(0, 8).map((result) => {
    let url = '';
    try {
      const parsed = new URL(String(result.url || ''));
      if (['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password) url = parsed.toString();
    } catch {}
    return {
      title: String(result.title || '').slice(0, 300),
      url,
      content: String(result.content || '').slice(0, 4000),
      score: result.score
    };
  }).filter((result) => result.url);
}

module.exports = { validatePublicUrl, resolvePublicHost, fetchPublicPage, searchWeb, isPrivateIp };
