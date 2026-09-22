"""Build the frozen Nomine logo package. Requires fonttools 4.65.0 for outlines.
Run only when intentionally maintaining brand masters; frontend builds use exports.
"""
from pathlib import Path
import re, json, hashlib, sys, tempfile
sys.path.insert(0, str(Path(tempfile.gettempdir()) / 'nomine-fonttools'))
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen

root=Path(__file__).resolve().parent
out=root/'approved'; logos=out/'logos'; logos.mkdir(parents=True,exist_ok=True)
original=(root/'explorations/round-01/3-symbol-onyx.svg').read_text(encoding='utf-8')
d=re.search(r'<path d="([^"]+)"',original).group(1)
symbol=f'<path d="{d}"/>'
font=instantiateVariableFont(TTFont(root/'assets/fonts/InstrumentSans.ttf'),{'wght':550,'wdth':100},inplace=False)
glyphs=font.getGlyphSet(); cmap=font.getBestCmap(); upm=font['head'].unitsPerEm
scale=48/upm; cursor=0; paths=[]
for ch in 'Nomine':
    glyph=glyphs[cmap[ord(ch)]]; pen=SVGPathPen(glyphs); glyph.draw(pen)
    paths.append(f'<path transform="translate({cursor:.5f} 0)" d="{pen.getCommands()}"/>')
    cursor+=glyph.width-1.82/scale
width=80+cursor*scale+8
word=f'<g transform="translate(80 49) scale({scale} {-scale})">'+''.join(paths)+'</g>'
for mode,color in [('ink','#0B0B0D'),('ivory','#F3F0E9')]:
    for name,w,h,body in [('symbol',64,64,symbol),('lockup',round(width,3),64,symbol+word)]:
        (logos/f'nomine-{name}-{mode}.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" fill="{color}" role="img" aria-label="Nomine"><title>Nomine — approved Claim Register</title>{body}</svg>\n',encoding='utf-8')
    (logos/f'nomine-avatar-{mode}.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 96 96" role="img" aria-label="Nomine"><rect width="96" height="96" fill="{"#F3F0E9" if mode=="ink" else "#0B0B0D"}"/><g transform="translate(16 16)" fill="{color}">{symbol}</g></svg>\n',encoding='utf-8')
(logos/'nomine-favicon.svg').write_text((logos/'nomine-symbol-ink.svg').read_text().replace('<title>', '<style>@media(prefers-color-scheme:dark){svg{fill:#F3F0E9}}</style><title>'),encoding='utf-8')
manifest={'version':'1.0.0','approvedSymbolSource':'round-01 route 03 Claim Register; original coordinates unchanged','rejected':'round-02 sliced diagonal N','symbolPath':d,'files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(logos.glob('*.svg'))}}
(out/'logo-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
print(f'Created {len(manifest["files"])} vector assets; all wordmark glyphs outlined.')
