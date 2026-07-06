import REGISTRY from './open-sse/providers/registry/index.js';

const t3chat = REGISTRY.find(r => r.id === 't3chat');
console.log('T3Chat Registry Entry:');
console.log('  ID:', t3chat?.id);
console.log('  Features:', t3chat?.features);
console.log('  Has usage feature:', t3chat?.features?.usage);

const usageSupported = REGISTRY
  .filter(r => r.features?.usage)
  .map(r => r.id);

console.log('\nUSAGE_SUPPORTED_PROVIDERS:', usageSupported);
console.log('T3Chat included:', usageSupported.includes('t3chat'));
