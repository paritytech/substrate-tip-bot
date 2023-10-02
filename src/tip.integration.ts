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
const commonDockerArgs =
  "--tmp --alice --execution Native --ws-port 9945 --ws-external --rpc-external --no-prometheus --no-telemetry --rpc-cors all";

describe("tip", () => {
  let state: State;
  let kusamaContainer: StartedTestContainer;
  let kusamaApi: ApiPromise;
  let polkadotContainer: StartedTestContainer;
  let polkadotApi: ApiPromise;

  beforeAll(async () => {
    kusamaContainer = await new GenericContainer("parity/polkadot:v0.9.42")
      .withExposedPorts({ container: 9945, host: 9901 }) // Corresponds to chain-config.ts
      .withWaitStrategy(Wait.forListeningPorts())
      .withCommand(("--chain kusama-dev --force-kusama " + commonDockerArgs).split(" "))
      .start();
    kusamaApi = new ApiPromise({
      provider: new WsProvider(getChainConfig("localkusama").providerEndpoint),
      types: { Address: "AccountId", LookupSource: "AccountId" },
    });
    polkadotContainer = await new GenericContainer("parity/polkadot:v0.9.42")
      .withExposedPorts({ container: 9945, host: 9900 }) // Corresponds to chain-config.ts
      .withWaitStrategy(Wait.forListeningPorts())
      .withCommand(("--chain dev " + commonDockerArgs).split(" "))
      .start();
    polkadotApi = new ApiPromise({
      provider: new WsProvider(getChainConfig("localpolkadot").providerEndpoint),
      types: { Address: "AccountId", LookupSource: "AccountId" },
    });
  });

  afterAll(async () => {
    await kusamaApi.disconnect();
    await polkadotApi.disconnect();
    await kusamaContainer.stop();
    await polkadotContainer.stop();
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
      throw new Error(
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

          const api = network === "localkusama" ? kusamaApi : polkadotApi;
          const nextFreeReferendumId = new BN(await api.query.referenda.referendumCount());
          const result = await tipUser(state, tipRequest);

          expect(result.success).toBeTruthy();
          const tipUrl = result.success ? result.tipUrl : undefined;
          expect(tipUrl).toBeDefined();

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
          network === "localpolkadot"
            ? "The requested tip value of '1001 DOT' exceeds the BigTipper track maximum of '1000 DOT'."
            : "The requested tip value of '1001 KSM' exceeds the BigTipper track maximum of '33.33 KSM'.";
        expect(errorMessage).toEqual(expectedError);
      });

      test(`getReferendumId in ${network}`, async () => {
        const api = network === "localkusama" ? kusamaApi : polkadotApi;
        const tipRequest = getTipRequest({ size: new BN("1") }, network);
        const encodeProposalResult = encodeProposal(api, tipRequest);
        if ("success" in encodeProposalResult) {
          throw new Error("Encoding the proposal failed.");
        }
        const { encodedProposal } = encodeProposalResult;
        const nextFreeReferendumId = new BN(await api.query.referenda.referendumCount());

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
