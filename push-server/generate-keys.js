import { createECDH } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const key = createECDH('prime256v1'); key.generateKeys();
const output = process.argv[2] || 'vapid.private.json';
writeFileSync(output, JSON.stringify({ VAPID_PUBLIC_KEY: key.getPublicKey().toString('base64url'), VAPID_PRIVATE_KEY: key.getPrivateKey().toString('base64url') }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
console.log('Created private VAPID settings file: ' + output);
