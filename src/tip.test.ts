import "@polkadot/api-augment";
import { ApiPromise } from "@polkadot/api";
import { createTestKeyring } from "@polkadot/keyring";
import { HttpProvider } from "@polkadot/rpc-provider";
import { randomAsU8a } from "@polkadot/util-crypto";
import assert from "assert";

import { tipUser } from "./tip";
import { State, TipRequest } from "./types";

const randomAddress = () => createTestKeyring().addFromSeed(randomAsU8a(32)).address;

const state: State = {
  allowedGitHubOrg: "test",
  allowedGitHubTeam: "test",
  seedOfTipperAccount: "//Bob",
  bot: { log: console.log.bind(console) } as any, // eslint-disable-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
};
const tipperAccount = "14E5nqKAp3oAJcmzgZhUD2RcptBeUBScxKHgJKU4HPNcKVf3"; // Bob

const getTipRequest = (tip: TipRequest["tip"]): TipRequest => {
  return {
    tip,
    contributor: { githubUsername: "test", account: { address: randomAddress(), network: "localtest" } },
    pullRequestRepo: "test",
    pullRequestNumber: 1,
  };
};

describe("tip", () => {
  const polkadotApi = new ApiPromise({
    provider: new HttpProvider("http://localhost:9933"),
    types: { Address: "AccountId", LookupSource: "AccountId" },
  });

  const getUserBalance = async (userAddress: string) => {
    console.log("here2");
    const { data } = await polkadotApi.query.system.account(userAddress);
    return data.free.toBn();
  };

  beforeAll(async () => {
    await polkadotApi.isReady;
    assert((await getUserBalance(tipperAccount)).gtn(0));
  });

  for (const govType of ["gov1", "opengov"]) {
    describe(govType, () => {
      for (const tipSize of ["small", "medium", "large"]) {
        test(`tips a user (${tipSize})`, async () => {
          const tipRequest = getTipRequest({ type: "gov1", size: "small" });

          const { success, tipUrl } = await tipUser(state, tipRequest);

          expect(success).toBeTruthy();
          console.log(`Assert the results manually: ${tipUrl}`);
        });
      }
    });
  }
});
