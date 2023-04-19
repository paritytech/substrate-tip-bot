/*
These are semi-automatic tests that will send out
different sizes of tips - both gov1 (treasury) and opengov,
but do not have meaningful assertions.

They rely on manually inspecting the produced tips in the browser UI.
The URLs are printed in the output.

These tests do not cover the part with GitHub interaction,
they execute the tipping functions directly.
 */

import "@polkadot/api-augment";
import { ApiPromise, Keyring } from "@polkadot/api";
import { createTestKeyring } from "@polkadot/keyring";
import { HttpProvider } from "@polkadot/rpc-provider";
import { BN } from "@polkadot/util";
import { cryptoWaitReady, randomAsU8a } from "@polkadot/util-crypto";
import assert from "assert";

import { tipUser } from "./tip";
import { State, TipRequest } from "./types";

const randomAddress = () => createTestKeyring().addFromSeed(randomAsU8a(32)).address;

const logMock: any = console.log.bind(console); // eslint-disable-line @typescript-eslint/no-explicit-any
logMock.error = console.error.bind(console);

const tipperAccount = "14E5nqKAp3oAJcmzgZhUD2RcptBeUBScxKHgJKU4HPNcKVf3"; // Bob

const getTipRequest = (tip: TipRequest["tip"]): TipRequest => {
  return {
    tip,
    contributor: { githubUsername: "test", account: { address: randomAddress(), network: "localkusama" } },
    pullRequestRepo: "test",
    pullRequestNumber: 1,
  };
};

const govTypes = ["treasury", "opengov"] as const;
const tipSizes: TipRequest["tip"]["size"][] = ["small", "medium", "large", new BN("7"), new BN("30")];

describe("tip", () => {
  let state: State;

  const polkadotApi = new ApiPromise({
    provider: new HttpProvider("http://localhost:9933"),
    types: { Address: "AccountId", LookupSource: "AccountId" },
  });

  const getUserBalance = async (userAddress: string) => {
    const { data } = await polkadotApi.query.system.account(userAddress);
    return data.free.toBn();
  };

  beforeAll(async () => {
    await cryptoWaitReady();
    const keyring = new Keyring({ type: "sr25519" });
    await polkadotApi.isReady;
    assert((await getUserBalance(tipperAccount)).gtn(0));
    state = {
      allowedGitHubOrg: "test",
      allowedGitHubTeam: "test",
      botTipAccount: keyring.addFromUri("//Bob"),
      bot: { log: logMock } as any, // eslint-disable-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
    };
  });

  for (const govType of govTypes) {
    describe(govType, () => {
      for (const tipSize of tipSizes) {
        test(`tips a user (${tipSize.toString()})`, async () => {
          const tipRequest = getTipRequest({ type: govType, size: tipSize });

          const result = await tipUser(state, tipRequest);

          expect(result.success).toBeTruthy();
          const tipUrl = result.success ? result.tipUrl : undefined;
          expect(tipUrl).toBeDefined();
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          console.log(`Assert the results manually: ${tipUrl!.toString()}`);
        });
      }

      test(`huge tip in ${govType}`, async () => {
        const tipRequest = getTipRequest({ type: govType, size: new BN("999") });

        const result = await tipUser(state, tipRequest);

        if (govType === "treasury") {
          /* Currently we don't impose hard constraints on the tip value,
             as there are no 'tracks' with maximum values like in opengov.
             The values in treasure tips have no direct programmatic effect,
             they are just a textual suggestions for the tippers. */
          expect(result.success).toBeTruthy();
        } else {
          expect(result.success).toBeFalsy();
          const errorMessage = result.success === false ? result.errorMessage : undefined;
          expect(errorMessage).toEqual(
            "The requested tip value of '999 KSM' exceeds the BigTipper track maximum of '33.33 KSM'.",
          );
        }
      });
    });
  }
});
