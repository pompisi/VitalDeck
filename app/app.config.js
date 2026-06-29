// Dynamic Expo config. Spreads app.json and injects the default backend URL from a
// LOCAL, gitignored env var (VITALDECK_API_URL in app/.env) so the real Pi address
// is never committed to the public repo. It rides into builds + OTA updates via
// `extra.apiUrl` (read in app/lib/settings.ts) and is overridden at runtime by the
// in-app SET tab.
module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...(config.extra || {}),
    apiUrl: process.env.VITALDECK_API_URL || '',
  },
});
