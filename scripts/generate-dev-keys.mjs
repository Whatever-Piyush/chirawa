import { generateKeyPairSync } from 'crypto';

console.log('\n🔑 Generating RSA-2048 key pair for JWT (RS256)...\n');

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding:  { type: 'spki',   format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8',  format: 'pem' },
});

// Collapse PEM newlines to \n literal for .env single-line format
const toEnvValue = (key) => key.replace(/\n/g, '\\n');

console.log('━'.repeat(70));
console.log('Copy these two lines into apps/api/.env\n');
console.log(`JWT_PRIVATE_KEY="${toEnvValue(privateKey)}"`);
console.log('');
console.log(`JWT_PUBLIC_KEY="${toEnvValue(publicKey)}"`);
console.log('━'.repeat(70));
console.log('\n✅ Done! Paste the above into apps/api/.env replacing the REPLACE_ME lines.\n');
