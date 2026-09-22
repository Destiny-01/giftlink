# Nomine frontend implementation handoff

**Start here. This handoff requires no prior chat history.**

## Approved identity and precedence

The user approved the **original Claim Register symbol from round 01, route 03**, and the **round-02 colour, typography and overall visual treatment**. The diagonal N with horizontal cuts introduced in round 02 was explicitly rejected. Never use it.

For visual implementation, `brand/approved/GUIDELINES.md`, `brand/approved/tokens.css` and `brand/approved/logos/` are authoritative. `brand/approved/index.html` is the corrected visual reference. Product meaning and scope remain governed by `docs/BRAND.md`, `docs/PRODUCT.md`, `docs/DECISIONS.md` and `docs/build-brief-v1.md`. Explorations and draft documents cannot override the approved package.

## Exact logo use

Import the supplied SVG files. **Do not draw an N, recreate blocks in CSS, use a font glyph, substitute an icon, simplify/round paths, or ask image generation to reproduce it.** The approved geometry is frozen. SVG scales without loss; the lockups have outlined lettering and no font dependency. Do not retype the master wordmark.

```tsx
// Copy the canonical exports unchanged into your frontend's public/brand directory.
<img src="/brand/nomine-lockup-ink.svg" alt="Nomine" height={32} />
// Use nomine-lockup-ivory.svg on dark backgrounds.
// For symbol-only navigation, give the link an accessible name.
<a href="/" aria-label="Nomine home">
  <img src="/brand/nomine-symbol-ink.svg" alt="" width={32} height={32} />
</a>
```

Run `node brand/verify-assets.mjs`. Copied logo bytes must match the SHA-256 entries in `brand/approved/logo-manifest.json`. Do not regenerate masters as part of the app build. The font outlining script is for intentional brand maintenance only.

## Apply throughout the frontend

Build shared semantic theme tokens and reusable brand components first. Map existing Tailwind/shadcn theme variables to the approved tokens; translate hex into the existing HSL convention where needed without changing colours. Self-host the supplied fonts with their OFL licenses. Avoid mixing legacy theme variables with Nomine tokens.

Replace legacy navy/teal/gold, glow effects, decorative gradients, gifting master icons, old font stacks and inconsistent branding across landing, auth, navigation, forms, dashboards, Claim pages, activity, receipts, settings, dialogs, toasts, empty/error/loading states and responsive layouts. Update favicon, page metadata and actual existing public surfaces. Use Nomine for the parent; preserve **GiftLink by Nomine** for the focused gifting application. Do not blindly relabel gifting behaviour as a fully implemented Inbox/Studio/Protocol.

Use the visual reference as a design system, not a literal product specification. Its example amounts, identities and dates must not enter live flows. Complete responsive controls, accessible interactions and actual data integration; static buttons and hidden mobile navigation in a composition study are not implementation patterns.

Preserve functioning flows, wallet integration and security guarantees. Do not silently change custody, authentication or contract behaviour as part of rebranding. Do not invent products or expand current scope. Do not deploy to mainnet or spend real funds.

## Acceptance

- Every existing user-facing route uses the shared identity; no unexplained legacy styling remains.
- Every logo uses the canonical files unchanged, with matching asset hashes. Light/dark variants are selected correctly.
- Fonts load locally. Amounts/addresses use Plex Mono. No synthetic bold for the regular-only mono font.
- Keyboard navigation, visible focus, labelled states, narrow layouts (320px upward), 200% zoom and reduced motion work. Text/controls meet applicable contrast requirements.
- Funding, eligibility and settlement remain separate facts; name the actual issuer/Resolver, expiry/timezone and recovery rule.
- Run appropriate frontend build/checks and inspect representative desktop/mobile screens. Report changes and any remaining product gaps; do not call mocked surfaces shipped features.

## Short kickoff prompt

Implement Nomine across the frontend using `brand/IMPLEMENTATION.md` and `brand/approved/` as the source of truth. Replace the legacy styling throughout, use the canonical SVG logos unchanged, and follow the approved tokens, fonts and visual reference. Preserve working behaviour and current product scope; verify responsive layouts, accessibility and builds. Do the implementation, not another design exploration.
