const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const consent = fs.readFileSync(path.join(__dirname, '..', 'public', 'consent.html'), 'utf8');

for (const required of [
  'id="tab-catalog"',
  'id="tab-checkout"',
  'id="tab-profile"',
  'id="product-modal"',
  'id="consent-personal"',
  'id="consent-policy"',
  'personalDataConsent:true',
  'privacyAccepted:true',
]) assert(html.includes(required), `Missing frontend contract: ${required}`);

assert(html.includes('setInterval(()=>loadMenu'), 'Menu should refresh while the app is open');
assert(consent.includes('ИП Замесову Александру Юрьевичу'), 'Consent must identify the operator');
console.log('frontend contract tests passed');
