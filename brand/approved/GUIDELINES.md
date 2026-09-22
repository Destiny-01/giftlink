# Nomine — approved identity 1.0

Approved basis: original Claim Register mark (round 01, route 03), with round-02 palette and application aesthetic. The user explicitly rejected the round-02 diagonal sliced N. This package supersedes exploratory visual recommendations.

## Logo

The master is `logos/nomine-symbol-ink.svg`. It preserves the exact original path in a 64×64 viewBox. Use the ivory variant on dark surfaces. The block geometry is intentional: no diagonal edges, softened corners or optical redesigns.

`nomine-lockup-ink.svg` and `nomine-lockup-ivory.svg` pair the original mark with fixed outlined Instrument Sans lettering. They render without installed fonts. Use these for mastheads; do not rebuild the logo with live type. Avatar exports include a background; symbol/lockup exports are transparent. `nomine-favicon.svg` keeps the original geometry and changes colour for dark browser chrome.

Preserve aspect ratio. Clear space: at least one 12-unit block width outside the symbol's visible bounds, or the equivalent around a lockup. Recommended symbol size ≥24 CSS px; 16px is permitted only for constrained favicon use and naturally loses detail. Never redraw it to compensate. Lockup recommended minimum height 32px. No recolouring beyond the ink/ivory variants, no gradients, strokes, skew, rotation, shadows or path edits. Pixel antialiasing can differ across renderers; the vector geometry remains exact.

## Palette

| Token | Value | Role |
| --- | --- | --- |
| Onyx | #0B0B0D | Primary text and dark surfaces |
| Warm ivory | #F3F0E9 | Primary light background and inverse text |
| Limestone | #E5E1D8 | Secondary light surfaces |
| Graphite | #6B6B72 | Secondary text on ivory |
| Signal violet | #665CF6 | Sparse brand accent, not small text on ivory |
| Deep violet | #5546D9 | Primary controls and accent text on ivory |
| Pale violet | #B7AEFF | Accent text/focus on dark surfaces |
| Dark secondary text | #B9B6B0 | Supporting text on onyx |

Use one violet family; neutrals dominate. Suggested light composition 60% ivory / 30% ink / 7% limestone / 3% violet, adaptable to context. Dark marketing layouts and light product layouts are both approved. No teal, gold, rainbow accents, glows or decorative gradients. Error/success states use clear wording and icons; do not invent a multicolour status palette.

Text contrast: onyx/ivory 17.28:1; deep violet/ivory 5.65:1; white/deep violet 6.43:1; graphite/ivory 4.65:1; pale violet/onyx 9.84:1. Graphite on limestone needs separate validation; use primary ink for small surface text. Signal violet on ivory, onyx on signal violet and graphite on onyx fail normal-text AA. Thin divider colours are decorative, not sufficient control boundaries. Use the separate control-border token for essential boundaries.

## Typography and composition

Self-host `brand/assets/fonts/InstrumentSans.ttf` (400–700 variable; normal width) and `IBMPlexMono-Regular.ttf` (400 only). Include their licenses. Instrument Sans: body 400, headings 500, labels/actions 550–600. Plex Mono: amounts, wallet addresses, transaction references and record metadata, with tabular figures. Never substitute a font for outlined logo lettering.

Use generous whitespace, strong hierarchy and fine horizontal rules. 12 columns desktop / 4 mobile; content width about 1200px; gutters 24px desktop and 16px mobile. Spacing: 4/8/12/16/24/32/48/64/96. Controls: 3px radius. No indiscriminate card nesting. Body 16/24; supporting financial text ≥14/20; display 64–108 desktop / 44–64 mobile, adjusted to fit; H1 40–48; H2 28–36. Large display tracking can be tight; financial data must remain easy to scan. Review mockup micro-labels are not permission to shrink critical terms.

Motion: restrained 160–220ms feedback, reduced-motion alternative, no looping glow or premature success. Use ordinary semantic icons for controls; never substitute them for the brand mark. Imagery favours typographic records and actual product information, not coins, chains, gift boxes or futuristic stock effects.

## Architecture and voice

Nomine / NOH-mi-neh / **Value, addressed.** Parent brand for the Claim Layer and economic inbox. Named surfaces: Nomine Inbox, Nomine Studio, Nomine Protocol. Focused gifting application: GiftLink by Nomine. Do not present future verticals or unimplemented surfaces as shipped.

Use precise, calm human language: fund, address, qualify, claim, settle, route, recover, verify. A funded Claim is not proof that the viewer qualifies. “Completed” requires confirmed settlement. Name issuer, eligibility verifier, asset, amount, network, expiry/timezone and recovery rule. Never imply risk-free, instant, trustless off-chain facts or audited security without evidence. Full copy library: `brand/strategy-and-voice.md`; product documents override any example.

Arc and USDC are contextual: “Built on Arc”, “Asset: USDC · Network: Arc”. Nomine leads. Do not imply an official partnership or redraw external brands. GiftLink inherits this system with a warmer personal message and a readable Nomine endorsement.

## Governance

Canonical assets and tokens live here. New chats begin at `brand/IMPLEMENTATION.md`. Explorations are historical, never asset sources. Brand changes require an explicit user decision and a versioned update; routine faithful frontend implementation does not require re-approval of this identity. Keep the manifest check in the handoff. Do not modify canonical assets or their hashes merely to make validation pass.
