import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  makeAuthUser,
  makeDrop,
  RECIPIENT_EMAIL,
  RECIPIENT_SECOND_WALLET,
  RECIPIENT_WALLET,
  STRANGER_WALLET,
} from "./setup";

const { assertClaimAuthorized, isAddressedToUser } = require("../src/services/recipientAuthorization") as typeof import("../src/services/recipientAuthorization");
const { computeRecipientCommit } = require("../src/utils/drop") as typeof import("../src/utils/drop");
const { RecipientType } = require("@prisma/client") as typeof import("@prisma/client");

/** A drop whose stored commitment really belongs to the synthetic recipient. */
function emailDrop() {
  const drop = makeDrop({
    recipientType: "EMAIL",
    recipientIdentifier: RECIPIENT_EMAIL,
  });
  drop.recipientCommit = computeRecipientCommit(
    RecipientType.EMAIL,
    RECIPIENT_EMAIL,
    drop.id
  );
  return drop;
}

function walletDrop() {
  return makeDrop({
    recipientType: "WALLET",
    recipientIdentifier: RECIPIENT_WALLET.toLowerCase(),
  });
}

function publicDrop() {
  return makeDrop({
    recipientType: "PUBLIC",
    recipientIdentifier: "",
  });
}

describe("recipient authorization policy", () => {
  test("an unauthenticated caller is refused on every recipient type", () => {
    for (const drop of [emailDrop(), walletDrop(), publicDrop()]) {
      assert.throws(
        () =>
          assertClaimAuthorized({
            drop,
            authUser: undefined,
            payoutAddress: RECIPIENT_WALLET,
            walletEvidence: "signature",
          }),
        /Authentication is required/,
        `${drop.recipientType} accepted an unauthenticated caller`
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
      walletAddresses: [RECIPIENT_WALLET.toLowerCase(), RECIPIENT_SECOND_WALLET.toLowerCase()],
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
    const drop = makeDrop({
      recipientType: "DISCORD",
      recipientIdentifier: "fixturerecipient",
    });
    drop.recipientCommit = computeRecipientCommit(
      RecipientType.DISCORD,
      "fixturerecipient",
      drop.id
    );

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
        authUser: makeAuthUser({ walletAddresses: [STRANGER_WALLET.toLowerCase()] }),
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
