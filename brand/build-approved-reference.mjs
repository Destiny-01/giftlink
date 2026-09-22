import fs from 'node:fs';
const root=new URL('./',import.meta.url);
const read=p=>fs.readFileSync(new URL(p,root),'utf8');
const write=(p,v)=>fs.writeFileSync(new URL(p,root),v);
let html=read('explorations/round-02/index.html').replaceAll('../../assets/fonts/','../assets/fonts/');
const pair=(name,cls='',style='')=>`<span class="asset-pair ${cls}" style="${style}"><img class="asset-ink" src="logos/nomine-${name}-ink.svg" alt="Nomine"><img class="asset-ivory" src="logos/nomine-${name}-ivory.svg" alt="Nomine"></span>`;
html=html.replace(/<span class="logo"><svg[\s\S]*?<\/svg><span>Nomine<\/span><\/span>/g,pair('lockup','','height:40px'));
html=html.replace(/<svg([^>]*)>[\s\S]*?<\/svg>/g,(_,attrs)=>{const cl=attrs.match(/class="([^"]+)"/)?.[1]||'';const size=attrs.match(/width="(\d+)"/)?.[1]||'40';return pair('symbol',cl,cl?'':`width:${size}px;height:${size}px`);});
html=html.replace('</style>',`.asset-pair{display:inline-block;position:relative;vertical-align:middle;flex:none}.asset-pair img{display:block;width:100%;height:100%;object-fit:contain}.asset-pair .asset-ivory{display:none}.dark .asset-pair .asset-ink,.plaque .asset-pair .asset-ink,.cover:not(.gift) .asset-pair .asset-ink{display:none}.dark .asset-pair .asset-ivory,.plaque .asset-pair .asset-ivory,.cover:not(.gift) .asset-pair .asset-ivory{display:block}.cover .watermark{opacity:.14}.plaque .big{display:block}.sizes .asset-pair{line-height:0}</style>`);
for(const [a,b] of [
 ['Nomine / Claim Register refined','Nomine / Approved identity 1.0'],
 ['BRAND REVIEW 02 · Claim Register selected','NOMINE · APPROVED IDENTITY 1.0'],
 ['Palette and mark refinement · For review','Original Claim Register · Canonical assets'],
 ['Selected direction. A new visual expression for Nomine.','Original approved mark. Approved palette and typography.'],
 ['A precise identity with warmth and space. Claim Register, refined for the people behind every entitlement.','A precise identity with warmth and space. The original Claim Register, for the people behind every entitlement.'],
 ['proposed deep violet','deep violet'],
 ['Three bands.<br>One clearer N.','The original mark.<br>Precisely preserved.'],
 ['The diagonal is now explicit. The mark retains the register’s three horizontal bands while reading more clearly as Nomine’s initial.','The original rectangular blocks are unchanged. Every logo here uses the canonical SVG exports.'],
 ['The live-type wordmark is still subject to final optical adjustment.','The master wordmark is outlined in the supplied SVGs and renders without installed fonts.'],
 ['Claim Register is selected. These refinements are presented for review; production remains unchanged. Proposed colour additions do not replace the approved foundation until accepted.','Approved: original Claim Register mark, with this palette and application aesthetic. Use the canonical assets unchanged. Product compositions are visual references, not shipped screens.'],
 ['href="claim-register-ink.svg"','href="logos/nomine-symbol-ink.svg"'],['href="review-notes.md"','href="GUIDELINES.md"'],['Design notes ↗','Brand guidelines ↗'],['Nomine / Identity 02','Nomine / Identity 1.0']])html=html.replaceAll(a,b);
write('approved/index.html',html);
const tokens=JSON.parse(read('explorations/round-02/tokens.json'));tokens.status='approved';tokens.version='1.0.0';
write('approved/tokens.json',JSON.stringify(tokens,null,2)+'\n');
write('approved/contrast.md',read('explorations/round-02/contrast.md').replace('Round 02 colour contrast','Approved palette colour contrast'));
console.log('Approved visual reference generated using canonical SVG files.');
