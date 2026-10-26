// One service, isolated subscriptions per app. Do not use wildcard origins.
const host = 'xb3hc3233xdwtuxk4m6un8xymmy.sharepoint.com';
const app = (id, domain, sitePath, extras = []) => ({
  id, baseUrl: `https://${domain}/`, site: `${host}:${sitePath}`,
  origins: [`https://${domain}`, 'https://astmacary.github.io', ...extras]
});
export const apps = {
  'rci-productions': app('rci-productions', 'productions.therampchurch.com', '/sites/RCIProductions', ['https://rci-productions.netlify.app']),
  'rci-security': app('rci-security', 'security.therampchurch.com', '/sites/RCISecurity', ['https://rci-security.netlify.app']),
  'rci-ushers': app('rci-ushers', 'ushers.therampchurch.com', '/sites/RCIUsherDept.-UsherSchedule'),
  'rci-worship-arts': app('rci-worship-arts', 'worship.therampchurch.com', '/sites/RCIMusicDept')
};
