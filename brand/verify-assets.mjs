import fs from 'node:fs';
import crypto from 'node:crypto';
const root=new URL('./',import.meta.url);
const read=p=>fs.readFileSync(new URL(p,root));
const manifest=JSON.parse(read('approved/logo-manifest.json'));
const original=read('explorations/round-01/3-symbol-onyx.svg').toString().match(/<path d="([^"]+)"/)[1];
if(original!==manifest.symbolPath)throw Error('Approved geometry differs from original route 03');
for(const [name,sha] of Object.entries(manifest.files)){
 const bytes=read('approved/logos/'+name),s=bytes.toString();
 if(crypto.createHash('sha256').update(bytes).digest('hex')!==sha)throw Error(`Changed approved logo: ${name}`);
 if(!s.includes(`d="${original}"`))throw Error(`Incorrect mark: ${name}`);
 if(/<text\b|<image\b|@font-face|href=/.test(s))throw Error(`Logo is not self-contained vector: ${name}`);
}
// Frontend builds serve copies rather than the package files, so the bytes that
// actually ship are checked against the same manifest. Files the application does
// not use (for example the avatar exports) are not required to be present.
const servedRoot=new URL('../link-gift-send/public/brand/',root);
const served=[];
if(fs.existsSync(servedRoot)){
 for(const [name,sha] of Object.entries(manifest.files)){
  const file=new URL(name,servedRoot);
  if(!fs.existsSync(file))continue;
  const bytes=fs.readFileSync(file);
  if(crypto.createHash('sha256').update(bytes).digest('hex')!==sha)throw Error(`Served logo differs from the manifest: ${name}`);
  served.push(name);
 }
}
console.log(`PASS: ${Object.keys(manifest.files).length} canonical SVGs match hashes, original geometry, and contain no font/image dependencies.${served.length?` ${served.length} served copies also match the manifest.`:' No served copies present to check.'}`);
