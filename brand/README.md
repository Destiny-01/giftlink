# Nomine — approved brand package

**New implementation chats: start at [IMPLEMENTATION.md](IMPLEMENTATION.md).** All required visual assets, fonts, tokens, rules and product-context links are in this repository. No previous chat history is required.

## Approval record

- Selected: original Claim Register, round 01 route 03.
- Approved: round-02 colours, typography and overall application aesthetic.
- Explicitly rejected: the modified round-02 diagonal N with horizontal breaks.
- Restored and packaged: 22 September 2026. The original block coordinates are unchanged. Outlined lockups eliminate font substitution.

## Authoritative files

- `approved/GUIDELINES.md`: identity and usage rules.
- `approved/index.html`: corrected visual reference using canonical SVG files.
- `approved/logos/`: exact SVG symbols, outlined lockups, avatars and favicon.
- `approved/logo-manifest.json`: frozen asset hashes and original symbol path.
- `approved/tokens.css` and `approved/tokens.json`: shared approved tokens.
- `assets/fonts/`: local font files and licenses.
- `strategy-and-voice.md`: strategy and copy library, constrained by product docs.

Verify with `node brand/verify-assets.mjs`. Frontend builds consume exports directly. `package-approved.py` requires FontTools 4.65.0 only for intentional brand maintenance; normal implementation needs no font tooling. `build-approved-reference.mjs` regenerates the reference using canonical assets.

`explorations/`, both round generators and `guidelines-draft.md` are superseded historical material, not asset sources. The old round-02 mark is rejected even though its visual treatment was approved.

Production application files have not been modified by this workstream. Use the kickoff prompt in IMPLEMENTATION.md to apply the identity throughout the existing frontend while preserving behaviour and scope.
