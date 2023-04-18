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
const tipSizes = ["small", "medium", "large"] as const;

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
        test(`tips a user (${tipSize})`, async () => {
          const tipRequest = getTipRequest({ type: govType, size: tipSize });

          const { success, tipUrl } = await tipUser(state, tipRequest);

          expect(success).toBeTruthy();
          console.log(`Assert the results manually: ${tipUrl}`);
        });
      }
    });
  }
});
