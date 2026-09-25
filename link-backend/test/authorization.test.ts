import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  RECIPIENT_DISCORD,
  RECIPIENT_DISCORD_USER_ID,
  RECIPIENT_EMAIL,
  RECIPIENT_SECOND_WALLET,
  RECIPIENT_TWITTER,
  RECIPIENT_WALLET,
  STRANGER_WALLET,
  makeAuthUser,
  makeAuthUserFromProvider,
  makeDrop,
} from "./setup";

const { assertClaimAuthorized, identifiersMatch, isAddressedToUser } = require("../src/services/recipientAuthorization") as typeof import("../src/services/recipientAuthorization");
const { computeRecipientCommit } = require("../src/utils/drop") as typeof import("../src/utils/drop");

/**
 * Fixtures carry a commitment that genuinely belongs to the stored identifier, because the
 * policy validates that pair before anything else: a fixture with a placeholder commitment
 * would exercise the tamper check instead of the rule under test.
 */
function committedDrop(recipientType: string, recipientIdentifier: string) {
  const drop = makeDrop({
    recipientType,
    recipientIdentifier,
  } as unknown as Parameters<typeof makeDrop>[0]);
  drop.recipientCommit = computeRecipientCommit(
    recipientType as never,
    recipientIdentifier.toLowerCase(),
    drop.id
  );
  return drop;
}

const emailDrop = () => committedDrop("EMAIL", RECIPIENT_EMAIL);
const walletDrop = () => committedDrop("WALLET", RECIPIENT_WALLET.toLowerCase());
const publicDrop = () => committedDrop("PUBLIC", "");
const discordDrop = (identifier: string) => committedDrop("DISCORD", identifier);
const twitterDrop = (identifier: string) => committedDrop("TWITTER", identifier);

describe("recipient authorization policy", () => {
  test("an account is required exactly where the policy needs an identity", () => {
    // Identity-targeted gifts cannot be authorized without a verified identity to check.
    for (const drop of [emailDrop(), discordDrop("alice")]) {
      assert.throws(
        () =>
          assertClaimAuthorized({
            drop,
            authUser: undefined,
            payoutAddress: RECIPIENT_WALLET,
            walletEvidence: "signature",
          }),
        /Sign in as the recipient/,
        `${drop.recipientType} accepted an unauthenticated caller`
      );
    }

    // Wallet-targeted and public gifts are authorized by proof of wallet control, so they
    // keep working without an account (issue #7 preserves those paths).
    assert.doesNotThrow(() =>
      assertClaimAuthorized({
        drop: walletDrop(),
        authUser: undefined,
        payoutAddress: RECIPIENT_WALLET,
        walletEvidence: "signature",
      })
    );
    assert.doesNotThrow(() =>
      assertClaimAuthorized({
        drop: publicDrop(),
        authUser: undefined,
        payoutAddress: RECIPIENT_WALLET,
        walletEvidence: "signature",
      })
    );
  });

  test("without a signature the payout wallet must belong to the account", () => {
    for (const drop of [walletDrop(), publicDrop()]) {
      assert.throws(
        () =>
          assertClaimAuthorized({
            drop,
            authUser: makeAuthUser({
              walletAddresses: [STRANGER_WALLET.toLowerCase()],
            }),
            payoutAddress: RECIPIENT_WALLET.toLowerCase(),
            walletEvidence: "privy-linked",
          }),
        /not linked to your account/,
        `${drop.recipientType} recorded a wallet the account does not control`
      );
    }
  });

  test("the intended email recipient is authorized, and their payout wallet may be any linked wallet", () => {
    const drop = emailDrop();

    const result = assertClaimAuthorized({
      drop,
      authUser: makeAuthUser(),
      payoutAddress: RECIPIENT_WALLET,
      walletEvidence: "privy-linked",
    });
    assert.equal(result.matchedIdentity, RECIPIENT_EMAIL);

    // A second linked wallet must not be refused: the persisted column only holds the first.
    const second = makeAuthUser({
      walletAddresses: [
        RECIPIENT_WALLET.toLowerCase(),
        RECIPIENT_SECOND_WALLET.toLowerCase(),
      ],
      walletAddress: RECIPIENT_WALLET.toLowerCase(),
    });
    assert.doesNotThrow(() =>
      assertClaimAuthorized({
        drop,
        authUser: second,
        payoutAddress: RECIPIENT_SECOND_WALLET,
        walletEvidence: "privy-linked",
      })
    );
  });

  test("a gift addressed by social handle is claimable by the account that owns it", () => {
    // The gift form addresses recipients by handle while the provider reports its own numeric
    // id alongside the handle, so comparing the id alone refused real recipients.
    const account = makeAuthUser();

    for (const drop of [
      twitterDrop(`@${RECIPIENT_TWITTER}`),
      twitterDrop(RECIPIENT_TWITTER),
      discordDrop(RECIPIENT_DISCORD.toLowerCase()),
      discordDrop(RECIPIENT_DISCORD_USER_ID),
    ]) {
      assert.doesNotThrow(
        () =>
          assertClaimAuthorized({
            drop,
            authUser: account,
            payoutAddress: RECIPIENT_WALLET,
            walletEvidence: "privy-linked",
          }),
        `${drop.recipientType} "${drop.recipientIdentifier}" was refused for its owner`
      );
    }
  });

  test("the provider fixture yields the candidates the policy matches against", () => {
    // Pins the fixture to the real extraction. A rename in the provider payload would
    // otherwise produce empty candidates silently: the tests here would still pass while
    // every handle-addressed claim failed closed in production.
    const account = makeAuthUserFromProvider({
      discord: {
        userId: "998877665544332211",
        username: "sameuser",
        discriminator: "9999",
      },
      twitter: { userId: "112233445566778899", username: "samehandle" },
    });

    assert.deepEqual(account.socialIdentifiers.discord, [
      "998877665544332211",
      "sameuser",
      "sameuser#9999",
    ]);
    assert.deepEqual(account.socialIdentifiers.twitter, [
      "112233445566778899",
      "samehandle",
    ]);
    // The persisted columns still take the provider's own id, unchanged.
    assert.equal(account.discordId, "998877665544332211");
  });

  test("provider-derived candidates authorize a discriminator-qualified gift exactly", () => {
    // Candidates built by the real extraction path, not hand-written: the provider reports a
    // numeric id, a bare handle *and* a discriminator-qualified handle for one account.
    const account = makeAuthUserFromProvider({
      discord: {
        userId: "998877665544332211",
        username: "sameuser",
        discriminator: "9999",
      },
    });

    const attempted = (identifier: string) => () =>
      assertClaimAuthorized({
        drop: discordDrop(identifier),
        authUser: account,
        payoutAddress: RECIPIENT_WALLET,
        walletEvidence: "privy-linked",
      });

    // The evidence the provider actually reported is accepted.
    assert.doesNotThrow(attempted("sameuser#9999"), "the exact handle was refused");
    assert.doesNotThrow(attempted("sameuser"), "the bare handle was refused");
    assert.doesNotThrow(
      attempted("998877665544332211"),
      "the provider's own id was refused"
    );

    // The account that shares the base name but not the discriminator is a different account
    // and must be refused. A bare-username fallback used to authorize it.
    assert.throws(
      attempted("sameuser#1234"),
      /addressed to a different recipient/,
      "a discriminator-qualified gift authorized the wrong account"
    );
  });

  test("a discriminator the provider cannot establish fails closed", () => {
    // The sender addressed a legacy `username#1234`, but this account reports no discriminator
    // at all, so there is no evidence to match on. It is refused rather than merged onto the
    // base name.
    const account = makeAuthUserFromProvider({
      discord: { userId: "998877665544332211", username: "sameuser" },
    });

    assert.throws(
      () =>
        assertClaimAuthorized({
          drop: discordDrop("sameuser#1234"),
          authUser: account,
          payoutAddress: RECIPIENT_WALLET,
          walletEvidence: "privy-linked",
        }),
      /addressed to a different recipient/
    );

    // The bare form, which is what the provider does report, still works.
    assert.doesNotThrow(() =>
      assertClaimAuthorized({
        drop: discordDrop("sameuser"),
        authUser: account,
        payoutAddress: RECIPIENT_WALLET,
        walletEvidence: "privy-linked",
      })
    );
  });

  test("matching is exact and never merges by base name", () => {
    assert.equal(identifiersMatch("@Alice", "alice"), true);
    assert.equal(identifiersMatch("alice#1234", "alice#1234"), true);
    assert.equal(
      identifiersMatch("alice#1234", "alice#9999"),
      false,
      "two discriminated accounts were treated as one"
    );
    assert.equal(
      identifiersMatch("alice#1234", "alice"),
      false,
      "a bare handle satisfied a discriminated target"
    );
    assert.equal(identifiersMatch("alice", "bob"), false);
  });

  test("an unrelated handle is still refused", () => {
    assert.throws(
      () =>
        assertClaimAuthorized({
          drop: twitterDrop("@someoneelse"),
          authUser: makeAuthUser(),
          payoutAddress: RECIPIENT_WALLET,
          walletEvidence: "privy-linked",
        }),
      /addressed to a different recipient/
    );
  });

  test("an unrelated authenticated identity cannot claim a targeted gift", () => {
    const drop = emailDrop();

    assert.throws(
      () =>
        assertClaimAuthorized({
          drop,
          authUser: makeAuthUser({
            email: "someone-else@example.test",
            walletAddresses: [STRANGER_WALLET.toLowerCase()],
          }),
          payoutAddress: STRANGER_WALLET,
          walletEvidence: "signature",
        }),
      /addressed to a different recipient/
    );
  });

  test("a matching identity still cannot be paid to a wallet it does not control", () => {
    assert.throws(
      () =>
        assertClaimAuthorized({
          drop: emailDrop(),
          authUser: makeAuthUser(),
          payoutAddress: STRANGER_WALLET,
          walletEvidence: "signature",
        }),
      /not linked to your account/
    );
  });

  test("a tampered stored commitment is refused even when the identity matches", () => {
    const drop = emailDrop();
    drop.recipientCommit = "0x" + "ab".repeat(32);

    assert.throws(
      () =>
        assertClaimAuthorized({
          drop,
          authUser: makeAuthUser(),
          payoutAddress: RECIPIENT_WALLET,
          walletEvidence: "privy-linked",
        }),
      /addressed to a different recipient/
    );
  });

  test("case differences in a stored handle do not change the decision", () => {
    const drop = committedDrop("DISCORD", "fixturerecipient");

    // The provider reports the handle with different casing.
    assert.doesNotThrow(() =>
      assertClaimAuthorized({
        drop,
        authUser: makeAuthUser({ discordId: "FixtureRecipient" }),
        payoutAddress: RECIPIENT_WALLET,
        walletEvidence: "privy-linked",
      })
    );
  });

  test("wallet-targeted gifts still pay the address the sender chose", () => {
    const drop = walletDrop();

    // The signature evidence is what proves control of that address on the relay path.
    assert.doesNotThrow(() =>
      assertClaimAuthorized({
        drop,
        authUser: makeAuthUser({
          walletAddresses: [STRANGER_WALLET.toLowerCase()],
        }),
        payoutAddress: RECIPIENT_WALLET,
        walletEvidence: "signature",
      })
    );

    // A different payout address is still refused.
    assert.throws(
      () =>
        assertClaimAuthorized({
          drop,
          authUser: makeAuthUser(),
          payoutAddress: STRANGER_WALLET,
          walletEvidence: "signature",
        }),
      /addressed to a different recipient/
    );

    // Without a signature, the target wallet must be linked to the account.
    assert.throws(
      () =>
        assertClaimAuthorized({
          drop,
          authUser: makeAuthUser({
            walletAddresses: [STRANGER_WALLET.toLowerCase()],
          }),
          payoutAddress: RECIPIENT_WALLET,
          walletEvidence: "privy-linked",
        }),
      /not linked to your account/
    );
  });

  test("public gifts keep first-claim-wins for any authenticated caller", () => {
    const drop = publicDrop();

    assert.doesNotThrow(() =>
      assertClaimAuthorized({
        drop,
        authUser: makeAuthUser({
          walletAddresses: [STRANGER_WALLET.toLowerCase()],
          email: null,
          discordId: null,
        }),
        payoutAddress: STRANGER_WALLET,
        walletEvidence: "signature",
      })
    );
  });

  test("a denial never reveals the intended recipient's identifier", () => {
    const drop = emailDrop();

    try {
      assertClaimAuthorized({
        drop,
        authUser: makeAuthUser({
          email: "someone-else@example.test",
          walletAddresses: [STRANGER_WALLET.toLowerCase()],
        }),
        payoutAddress: STRANGER_WALLET,
        walletEvidence: "signature",
      });
      assert.fail("expected the policy to refuse");
    } catch (error) {
      const message = (error as Error).message;
      assert.ok(
        !message.includes(RECIPIENT_EMAIL),
        `denial message leaked the recipient identifier: ${message}`
      );
    }
  });

  test("the display helper matches the enforcement path", () => {
    const drop = emailDrop();

    assert.equal(isAddressedToUser(drop, makeAuthUser()), true);
    assert.equal(
      isAddressedToUser(
        drop,
        makeAuthUser({ email: "someone-else@example.test" })
      ),
      false
    );
    assert.equal(isAddressedToUser(drop, undefined), false);
    assert.equal(isAddressedToUser(publicDrop(), undefined), true);
  });
});
