/*
These are integration tests that will send out
different sizes of opengov tips.

These tests do not cover the part with GitHub interaction,
they execute the tipping functions directly.
*/

import "@polkadot/api-augment";
import { ApiPromise, Keyring, WsProvider } from "@polkadot/api";
import { BN } from "@polkadot/util";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import assert from "assert";
import { GenericContainer, StartedTestContainer, Wait } from "testcontainers";

import { getChainConfig } from "./chain-config";
import { logMock, randomAddress } from "./testUtil";
import { tipUser } from "./tip";
import { State, TipRequest } from "./types";
import { encodeProposal, getReferendumId } from "./util";

const tipperAccount = "14E5nqKAp3oAJcmzgZhUD2RcptBeUBScxKHgJKU4HPNcKVf3"; // Bob

const getTipRequest = (tip: TipRequest["tip"], network: "localrococo" | "localwestend"): TipRequest => {
  return {
    tip,
    contributor: { githubUsername: "test", account: { address: randomAddress(), network } },
    pullRequestRepo: "test",
    pullRequestNumber: 1,
  };
};

const POLKADOT_VERSION = "v1.7.1";
const networks = ["localrococo", "localwestend"] as const;
const tipSizes: TipRequest["tip"]["size"][] = ["small", "medium", "large", new BN("1"), new BN("3")];
const commonDockerArgs =
  "--tmp --alice --execution Native --rpc-port 9945 --rpc-external --no-prometheus --no-telemetry --rpc-cors all";

describe("tip", () => {
  let state: State;
  let rococoContainer: StartedTestContainer;
  let rococoApi: ApiPromise;
  let westendContainer: StartedTestContainer;
  let westendApi: ApiPromise;

  beforeAll(async () => {
    rococoContainer = await new GenericContainer(`parity/polkadot:${POLKADOT_VERSION}`)
      .withExposedPorts({ container: 9945, host: 9902 }) // Corresponds to chain-config.ts
      .withWaitStrategy(Wait.forListeningPorts())
      .withCommand(("--chain rococo-dev " + commonDockerArgs).split(" "))
      .start();
    rococoApi = new ApiPromise({
      provider: new WsProvider(getChainConfig("localrococo").providerEndpoint),
      types: { Address: "AccountId", LookupSource: "AccountId" },
    });
    westendContainer = await new GenericContainer(`parity/polkadot:${POLKADOT_VERSION}`)
      .withExposedPorts({ container: 9945, host: 9903 }) // Corresponds to chain-config.ts
      .withWaitStrategy(Wait.forListeningPorts())
      .withCommand(("--chain westend-dev " + commonDockerArgs).split(" "))
      .start();
    westendApi = new ApiPromise({
      provider: new WsProvider(getChainConfig("localwestend").providerEndpoint),
      types: { Address: "AccountId", LookupSource: "AccountId" },
    });
  });

  afterAll(async () => {
    await rococoApi.disconnect();
    await westendApi.disconnect();
    await rococoContainer.stop();
    await westendContainer.stop();
  });

  const getUserBalance = async (api: ApiPromise, userAddress: string) => {
    const { data } = await api.query.system.account(userAddress);
    return data.free.toBn();
  };

  beforeAll(async () => {
    await cryptoWaitReady();
    const keyring = new Keyring({ type: "sr25519" });
    try {
      await rococoApi.isReadyOrError;
      await westendApi.isReadyOrError;
    } catch (e) {
      throw new Error(
        `For these integrations tests, we're expecting local Rococo on ${
          getChainConfig("localrococo").providerEndpoint
        } and local Westend on ${getChainConfig("localwestend").providerEndpoint}. Please refer to the Readme.`,
      );
    }

    assert((await getUserBalance(rococoApi, tipperAccount)).gtn(0));
    assert((await getUserBalance(westendApi, tipperAccount)).gtn(0));
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

          const api = network === "localrococo" ? rococoApi : westendApi;
          const nextFreeReferendumId = (await api.query.referenda.referendumCount()).toNumber();
          const result = await tipUser(state, tipRequest);

          expect(result.success).toBeTruthy();
          if (result.success) {
            expect(result.blockHash).toBeDefined();
            expect(result.referendumNumber).toBeDefined();
            expect(result.referendumNumber).toEqual(nextFreeReferendumId);
            expect(result.track).toBeDefined();
            expect(result.value).toBeDefined();
          }

          const referendum = await api.query.referenda.referendumInfoFor(nextFreeReferendumId);
          expect(referendum.isSome).toBeTruthy();
          expect(referendum.value.isOngoing).toBeTruthy();
        });
      }

      test(`huge tip in ${network}`, async () => {
        const tipRequest = getTipRequest({ size: new BN("1001") }, network);

        const result = await tipUser(state, tipRequest);

        expect(result.success).toBeFalsy();
        const errorMessage = !result.success ? result.errorMessage : undefined;
        const expectedError =
          network === "localrococo"
            ? "The requested tip value of '1001 ROC' exceeds the BigTipper track maximum of '3.333 ROC'."
            : "The requested tip value of '1001 WND' exceeds the BigTipper track maximum of '3.333 WND'.";
        expect(errorMessage).toEqual(expectedError);
      });

      test(`getReferendumId in ${network}`, async () => {
        const api = network === "localrococo" ? rococoApi : westendApi;
        const tipRequest = getTipRequest({ size: new BN("1") }, network);
        const encodeProposalResult = encodeProposal(api, tipRequest);
        if ("success" in encodeProposalResult) {
          throw new Error("Encoding the proposal failed.");
        }
        const { encodedProposal } = encodeProposalResult;
        const nextFreeReferendumId = new BN((await api.query.referenda.referendumCount()).toNumber());

        // We surround our tip with two "decoys" to make sure that we find the proper one.
        await tipUser(state, tipRequest); // Will occupy nextFreeReferendumId
        const result = await tipUser(state, tipRequest); // Will occupy nextFreeReferendumId + 1
        await tipUser(state, tipRequest); // Will occupy nextFreeReferendumId + 2

        if (!result.success) {
          throw new Error("Tipping unsuccessful.");
        }

        const apiAtBlock = await api.at(result.blockHash);
        const id = await getReferendumId(apiAtBlock, encodedProposal);

        expect(id).toBeDefined();
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        expect(new BN(id!).eq(nextFreeReferendumId.addn(1))).toBeTruthy();
      });
    });
  }
});
