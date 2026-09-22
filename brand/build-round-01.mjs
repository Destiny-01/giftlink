import fs from 'node:fs';
import path from 'node:path';
const out='brand/explorations/round-01';
fs.mkdirSync(out,{recursive:true});
const ink='#0B0B0D', paper='#F3F0E9', violet='#665CF6', muted='#6B6B72';
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;');
const text=(x,y,s,size=18,color=ink,extra='')=>`<text x="${x}" y="${y}" fill="${color}" font-size="${size}" ${extra}>${esc(s)}</text>`;
const rect=(x,y,w,h,c)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`;
const line=(x,y,x2,y2,c='#D0CDC6')=>`<path d="M${x} ${y}H${x2}" transform="translate(0 ${y2-y})" stroke="${c}"/>`;
const marks=[
 `<path d="M14 49V15L50 49V15" fill="none" stroke="currentColor" stroke-width="8" stroke-linejoin="round"/><circle cx="14" cy="49" r="6" fill="currentColor"/><circle cx="50" cy="15" r="6" fill="currentColor"/>`,
 `<path d="M18 9H8V55H18M46 9H56V55H46" fill="none" stroke="currentColor" stroke-width="5"/><path d="M23 45V19L41 45V19" fill="none" stroke="currentColor" stroke-width="5"/>`,
 `<path d="M8 9H20V21H8ZM8 26H20V38H8ZM8 43H20V55H8ZM44 9H56V21H44ZM44 26H56V38H44ZM44 43H56V55H44ZM20 9H29V21H20ZM27 26H37V38H27ZM35 43H44V55H35Z" fill="currentColor"/>`
];
const mark=(i,x,y,size=64,c=ink)=>`<g transform="translate(${x} ${y}) scale(${size/64})" color="${c}">${marks[i]}</g>`;
const svg=(w,h,body,title)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${title}"><title>${title}</title><g font-family="Instrument Sans, Arial, sans-serif">${body}</g></svg>`;
const write=(name,body)=>fs.writeFileSync(path.join(out,name),body);
const names=['Resolved Path','Named Space','Claim Register'];
const descriptions=[['Value moves with intent.','A continuous N resolves issuer and destination.','Best balance of protocol precision and human ease.'],['A place for what is yours.','Address brackets hold a named entitlement.','Quiet and welcoming; risks looking like code syntax.'],['Every Claim, accounted for.','Ledger bands assemble into a structured N.','Strong for issuers; more institutional for claimants.']];
for(let i=0;i<3;i++){
 for(const [mode,c,bg] of [['onyx',ink,null],['ivory',paper,ink]])write(`${i+1}-symbol-${mode}.svg`,svg(64,64,(bg?rect(0,0,64,64,bg):'')+mark(i,0,0,64,c),`Nomine ${names[i]} exploratory symbol`));
 write(`${i+1}-lockup.svg`,svg(440,96,mark(i,8,16,64)+text(92,68,'Nomine',60,ink,'font-weight="500" letter-spacing="-2"'),`Nomine ${names[i]} exploratory live-type lockup`));
 let b=rect(0,0,1440,1020,paper)+text(56,48,`NOMINE / IDENTITY EXPLORATION 0${i+1}`,14)+text(1384,48,'21 SEPT 2026 · NOT APPROVED',13,muted,'text-anchor="end"')+line(56,72,1384,72);
 b+=text(56,130,names[i],42)+text(56,168,descriptions[i][2],18,muted);
 b+=rect(56,205,820,380,ink)+mark(i,100,245,64,paper)+text(184,296,'Nomine',54,paper,'letter-spacing="-2"');
 if(i===0)b+=text(100,426,'Value,',80,paper)+text(100,513,'addressed.',80,paper)+`<path d="M635 515V330L807 515V270" fill="none" stroke="${paper}" stroke-width="15"/><circle cx="807" cy="270" r="13" fill="${violet}"/>`;
 if(i===1)b+=`<path d="M139 350H112V529H139M785 350H812V529H785" fill="none" stroke="${paper}" stroke-width="2"/>`+text(170,426,'Value, addressed.',64,paper)+text(172,488,'An economic inbox.',24,paper);
 if(i===2)b+=line(100,345,832,345,'#666')+text(100,412,'Value, addressed.',64,paper)+line(100,446,832,446,'#666')+text(100,495,'01  FUND',18,paper)+text(352,495,'02  QUALIFY',18,paper)+text(650,495,'03  SETTLE',18,paper);
 b+=rect(904,205,480,380,'#E7E3DC')+mark(i,1062,237,160)+text(944,449,'THE CORE IDEA',13,muted)+text(944,488,descriptions[i][0],25)+text(944,531,'Symbol / one colour / no wordmark',16,muted);
 b+=text(56,633,'NOMINE INBOX / APPLICATION STUDY',13,muted);
 if(i===1)b+=`<path d="M78 662H56V943H78M854 662H876V943H854" fill="none" stroke="${ink}" stroke-width="2"/>`;
 b+=text(88,700,i===2?'Your Claim register.':i===1?'Addressed to you.':'What’s yours should find you.',34)+text(88,741,'Available  01     Completed  02     Expired  00',16,muted)+line(88,763,844,763);
 b+=text(88,802,'DevRel Collective',21)+text(88,833,'Funded · Eligibility verified by DevRel Collective',15,muted)+text(88,869,'Available until 24 Sept 2026, 18:00 UTC',15,muted)+text(844,805,'250 USDC',25,ink,'text-anchor="end" font-family="IBM Plex Mono, monospace"');
 b+=rect(650,865,194,48,violet)+text(747,895,'Check eligibility',16,'#FFFFFF','text-anchor="middle"');
 b+=text(944,666,'DESIGN GRAMMAR',13,muted)+text(944,706,['Open fields. One decisive path.','Framed spaces. Quiet centres.','Aligned bands. Visible records.'][i],22)+text(944,754,'Onyx / warm ivory / signal violet',17)+rect(944,780,118,45,ink)+rect(1074,780,118,45,'#E7E3DC')+rect(1204,780,118,45,violet)+text(944,870,'Instrument Sans + IBM Plex Mono',17)+text(944,902,'Live type with system fallbacks in this round.',14,muted);
 b+=text(56,987,'Exploratory identity and illustrative product data. No production application changes.',13,muted);
 write(`${i+1}-board.svg`,svg(1440,1020,b,`Nomine route ${i+1}: ${names[i]}`));
}
let tests=rect(0,0,1200,620,paper)+text(48,60,'Resolved Path / optical review',34)+text(48,100,'Proposed minimum: 24px. 16px remains a refinement test. All samples are one colour.',18,muted);
for(let j=0;j<2;j++){
 tests+=rect(40,140+j*220,1120,200,j?ink:'#E7E3DC');
 [16,24,32,48,96].forEach((s,k)=>{tests+=mark(0,90+k*205,175+j*220,s,j?paper:ink)+text(90+k*205,308+j*220,`${s}px`,16,j?paper:ink);});
}
write('mark-tests.svg',svg(1200,620,tests,'Resolved Path light dark and small-size tests'));
const cards=[
 ['Landing page','Value, addressed.','Nomine makes funded value addressable and claimable.','Explore the Claim lifecycle','Built on Arc'],
 ['Nomine Inbox','What’s yours should find you.','Available 01 / Completed 02 / Expired 00','250 USDC · DevRel Collective','Check eligibility'],
 ['Nomine Studio','A clear account of every Claim.','Funded 10,000 / Settled 2,500 USDC','Remaining 7,500 / Reclaimed 0 USDC','100 allocations · 25 completed'],
 ['Developer documentation','Make value claimable.','Capital → Gate → Availability → Settlement → Recovery','Current release: direct USDC settlement on Arc','Conceptual lifecycle · not an API contract'],
 ['Claim page','250 USDC','Issuer: DevRel Collective · Funding confirmed','Eligibility verifier: DevRel Collective','Expires 24 Sept 2026, 18:00 UTC'],
 ['Transaction receipt','Completed.','250 USDC settled · Network: Arc','21 Sept 2026, 12:04 UTC','Transaction: illustrative reference only'],
 ['Social banner / avatar','Value, addressed.','Nomine / The Claim Layer and economic inbox','Monochrome symbol avatar','No public handle assigned'],
 ['Pitch deck cover','Value, addressed.','The Claim Layer with an economic inbox.','Nomine · September 2026','Current proof: USDC Claims on Arc'],
 ['GiftLink endorsement','GiftLink','by Nomine','Send value before you know the wallet.','Built on Arc · USDC']
];
let app=rect(0,0,1440,1710,paper)+text(48,64,'One identity. Different responsibilities.',44)+text(48,106,'Resolved Path / application studies / illustrative data / not shipped UI',18,muted);
cards.forEach((c,k)=>{const x=48+k%3*456,y=150+Math.floor(k/3)*510,dark=[0,6,7].includes(k),fg=dark?paper:ink,bg=dark?ink:'#E7E3DC';app+=rect(x,y,432,476,bg)+text(x+24,y+35,c[0].toUpperCase(),12,dark?'#B9B6B0':muted)+mark(0,x+24,y+62,32,fg)+text(x+67,y+88,'Nomine',24,fg);let title=c[1];if(title.length>28){const p=title.lastIndexOf(' ',24);app+=text(x+24,y+161,title.slice(0,p),31,fg)+text(x+24,y+201,title.slice(p+1),31,fg);}else app+=text(x+24,y+174,title,k===4?48:36,fg);c.slice(2).forEach((t,z)=>{const words=t.split(' ');let rows=[''];for(const w of words){if((rows.at(-1)+w).length>43)rows.push('');rows[rows.length-1]+=w+' ';}rows.forEach((r,n)=>app+=text(x+24,y+256+z*64+n*21,r.trim(),15,fg));});if(k===4)app+=text(x+24,y+446,'Unused capital returns to the issuer.',14,fg);});
write('applications.svg',svg(1440,1710,app,'Nomine nine application studies'));
function lum(hex){const rgb=hex.match(/[a-f0-9]{2}/gi).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;}
let report='# Colour contrast calculations\n\nWCAG relative luminance calculation; visual review is separate.\n\n| Pair | Ratio | Normal text AA |\n| --- | --- | --- |\n';
for(const [a,b] of [[ink,paper],[muted,paper],[muted,ink],[violet,paper],['#FFFFFF',violet],[ink,violet],['#B9B6B0',ink]]){const ratio=(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);report+=`| ${a} / ${b} | ${ratio.toFixed(2)}:1 | ${ratio>=4.5?'Pass':'Fail'} |\n`;}
write('contrast.md',report);
write('index.html',`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nomine — identity review 01</title><style>*{box-sizing:border-box}body{margin:0;background:${paper};color:${ink};font:16px/1.6 'Instrument Sans',Arial,sans-serif}header,main,footer{max-width:1440px;margin:auto;padding:32px}header{padding-top:56px}small{letter-spacing:.12em;text-transform:uppercase}h1{font-size:clamp(40px,6vw,80px);line-height:1.05;font-weight:500;letter-spacing:-.045em;margin:24px 0}p{max-width:780px}nav{display:flex;gap:12px;flex-wrap:wrap;padding:20px 0}a{color:inherit;text-underline-offset:4px}nav a{padding:10px 18px;border:1px solid #6B6B72;text-decoration:none}a:focus-visible{outline:3px solid ${violet};outline-offset:4px}section{scroll-margin-top:24px;margin:0 0 72px}img{display:block;width:100%;height:auto;border:1px solid #D0CDC6}h2{font-weight:500;font-size:32px}aside{border-left:4px solid ${violet};padding:4px 24px;margin:28px 0}footer{border-top:1px solid #D0CDC6}@media print{nav{display:none}section{break-before:page}header,main{padding:0}}</style><header><small>Nomine / Brand review 01 / Exploration</small><h1>Value, addressed.</h1><p>Three identities for one foundation: funded value, a declared destination, and rules that remain clear through settlement or recovery.</p><aside><strong>Recommendation: 01 — Resolved Path.</strong><br>Its connected N expresses the product's central idea and works across people-facing and protocol surfaces. Route choice remains yours; none is approved.</aside><nav>${names.map((n,i)=>`<a href="#route${i}">0${i+1} ${n}</a>`).join('')}<a href="#applications">Applications</a><a href="#tests">Mark tests</a></nav><p>Editable SVG studies. Typography currently uses system fallbacks where Instrument Sans and IBM Plex Mono are unavailable; final type and optical refinements follow route review.</p></header><main>${names.map((n,i)=>`<section id="route${i}"><h2>0${i+1} / ${n}</h2><img src="${i+1}-board.svg" alt="${n}: ${descriptions[i].join(' ')}"><p>${descriptions[i][1]} ${descriptions[i][2]} <a href="${i+1}-lockup.svg">Editable lockup</a> · <a href="${i+1}-symbol-onyx.svg">Editable symbol</a></p></section>`).join('')}<section id="applications"><h2>Applications / Resolved Path</h2><img src="applications.svg" alt="Nine exploratory applications: landing, inbox, studio, developer documentation, Claim, receipt, social, pitch and GiftLink endorsement."><p>These are brand composition studies, not complete interface specifications. Product data is illustrative. All nine use the same parent identity; Arc and USDC appear as contextual text.</p></section><section id="tests"><h2>Small sizes and one colour</h2><img src="mark-tests.svg" alt="Resolved Path symbol at 16, 24, 32, 48 and 96 pixels on light and dark backgrounds."><p>The 24px version is the provisional minimum. The 16px drawing needs optical refinement before favicon approval. <a href="contrast.md">Calculated contrast report</a>.</p></section></main><footer><p>Review decision: choose a route to refine, or identify the element that misses the intended character. Approval of a route does not authorize production application replacement.</p><a href="../../strategy-and-voice.md">Strategy and voice</a> · <a href="../../guidelines-draft.md">Draft guidelines</a> · <a href="../../audit.md">Audit and collision screening</a></footer></html>`);
console.log(`Generated three routes, editable marks, nine application studies and contrast report in ${out}`);
