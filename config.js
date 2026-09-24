// Public runtime settings for the static frontend. Never put credentials here.
// Set apiBaseUrl to the public HTTPS URL of the API to enable real API mode.
window.AI_TRADING_LAB_CONFIG = Object.freeze({
  apiBaseUrl: '',
  mode: 'unconfigured' // 'api' when apiBaseUrl is set; 'mock' for local demo mode
});
