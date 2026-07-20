'use strict';

const { BrowserRuntime } = require('./browserRuntime');
const { PlaywrightBrowserDriver } = require('./playwrightBrowserDriver');

// Costruisce il browser runtime di produzione: driver Playwright reale
// (Gate A.4), contesti persistenti isolati per tenant (Gate A.6) e
// salvataggio degli artefatti visivi nel workspace del task (Gate A.5).
function createBrowserRuntime({ saveArtifact = null, driverOptions = {}, sessions, registry } = {}) {
  const driver = new PlaywrightBrowserDriver({ ...driverOptions, saveArtifact });
  return new BrowserRuntime({ driver, sessions, registry });
}

module.exports = { createBrowserRuntime };
