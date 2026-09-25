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
  makeDrop,
} from "./setup";

const { assertClaimAuthorized, identifiersMatch, isAddressedToUser } = require("../src/services/recipientAuthorization") as typeof import("../src/services/recipientAuthorization");
const { computeRecipientCommit } = require("../src/utils/drop") as typeof import("../src/utils/drop");
const { RecipientType } = require("@prisma/client") as typeof import("@prisma/client");

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
      discordDrop(`${RECIPIENT_DISCORD}#1234`.toLowerCase()),
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

  test("a discriminator never conflates two accounts sharing a username", () => {
    assert.equal(
      identifiersMatch("alice#1234", "alice#1234", RecipientType.DISCORD),
      true
    );
    assert.equal(
      identifiersMatch("alice#1234", "alice#9999", RecipientType.DISCORD),
      false,
      "two discriminated accounts were treated as one"
    );
    // When only one side carries a discriminator, the base name is all there is to match on.
    assert.equal(
      identifiersMatch("alice#1234", "alice", RecipientType.DISCORD),
      true
    );
    assert.equal(
      identifiersMatch("@Alice", "alice", RecipientType.TWITTER),
      true
    );
    assert.equal(identifiersMatch("alice", "bob", RecipientType.TWITTER), false);
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
