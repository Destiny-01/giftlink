import fs from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const sharp=require(process.argv[2] || 'sharp');
const embed=(name,x,y,w,h)=>`<image x="${x}" y="${y}" width="${w}" height="${h}" href="data:image/svg+xml;base64,${fs.readFileSync(new URL(`./approved/logos/${name}.svg`,import.meta.url)).toString('base64')}"/>`;
const body='<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="500"><rect width="1200" height="500" fill="#F3F0E9"/><rect x="600" width="600" height="500" fill="#0B0B0D"/>'+embed('nomine-symbol-ink',220,45,160,160)+embed('nomine-symbol-ivory',820,45,160,160)+embed('nomine-lockup-ink',80,290,440,110)+embed('nomine-lockup-ivory',680,290,440,110)+'</svg>';
await sharp(Buffer.from(body)).png().toFile(new URL('./approved/logo-preview.png',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'));
console.log('Rendered canonical SVG proof; PNG is preview only.');
