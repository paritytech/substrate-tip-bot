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
import { ApiPromise, Keyring, WsProvider } from "@polkadot/api";
import { BN } from "@polkadot/util";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import assert from "assert";

import { getChainConfig } from "./chain-config";
import { logMock, randomAddress } from "./testUtil";
import { tipUser } from "./tip";
import { State, TipRequest } from "./types";

const tipperAccount = "14E5nqKAp3oAJcmzgZhUD2RcptBeUBScxKHgJKU4HPNcKVf3"; // Bob

const getTipRequest = (tip: TipRequest["tip"], network: "localkusama" | "localpolkadot"): TipRequest => {
  return {
    tip,
    contributor: { githubUsername: "test", account: { address: randomAddress(), network } },
    pullRequestRepo: "test",
    pullRequestNumber: 1,
  };
};

const networks = ["localkusama", "localpolkadot"] as const;
const tipSizes: TipRequest["tip"]["size"][] = ["small", "medium", "large", new BN("7"), new BN("30")];

describe("tip", () => {
  let state: State;
  let kusamaApi: ApiPromise;
  let polkadotApi: ApiPromise;

  beforeAll(() => {
    kusamaApi = new ApiPromise({
      provider: new WsProvider(getChainConfig("localkusama").providerEndpoint),
      types: { Address: "AccountId", LookupSource: "AccountId" },
    });

    polkadotApi = new ApiPromise({
      provider: new WsProvider(getChainConfig("localpolkadot").providerEndpoint),
      types: { Address: "AccountId", LookupSource: "AccountId" },
    });
  });

  afterAll(async () => {
    await kusamaApi.disconnect();
    await polkadotApi.disconnect();
  });

  const getUserBalance = async (api: ApiPromise, userAddress: string) => {
    const { data } = await api.query.system.account(userAddress);
    return data.free.toBn();
  };

  beforeAll(async () => {
    await cryptoWaitReady();
    const keyring = new Keyring({ type: "sr25519" });
    try {
      await kusamaApi.isReadyOrError;
      await polkadotApi.isReadyOrError;
    } catch (e) {
      console.log(
        `For these integrations tests, we're expecting local Kusama on ${
          getChainConfig("localkusama").providerEndpoint
        } and local Polkadot on ${getChainConfig("localpolkadot").providerEndpoint}. Please refer to the Readme.`,
      );
    }

    assert((await getUserBalance(kusamaApi, tipperAccount)).gtn(0));
    assert((await getUserBalance(polkadotApi, tipperAccount)).gtn(0));
    state = {
      allowedGitHubOrg: "test",
      allowedGitHubTeam: "test",
      botTipAccount: keyring.addFromUri("//Bob"),
      bot: { log: logMock } as any, // eslint-disable-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
    };
  });

  for (const network of networks) {
    describe(network, () => {
      for (const tipSize of tipSizes) {
        test(`tips a user (${tipSize.toString()})`, async () => {
          const tipRequest = getTipRequest({ size: tipSize }, network);

          const result = await tipUser(state, tipRequest);

          expect(result.success).toBeTruthy();
          const tipUrl = result.success ? result.tipUrl : undefined;
          expect(tipUrl).toBeDefined();
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          console.log(`Assert the results manually: ${tipUrl!.toString()}`);
        });
      }

      test(`huge tip in ${network}`, async () => {
        const tipRequest = getTipRequest({ size: new BN("1001") }, network);

        const result = await tipUser(state, tipRequest);

        expect(result.success).toBeFalsy();
        const errorMessage = !result.success ? result.errorMessage : undefined;
        const expectedError =
          network === "localpolkadot"
            ? "The requested tip value of '1001 DOT' exceeds the BigTipper track maximum of '1000 DOT'."
            : "The requested tip value of '1001 KSM' exceeds the BigTipper track maximum of '33.33 KSM'.";
        expect(errorMessage).toEqual(expectedError);
      });
    });
  }
});
