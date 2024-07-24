/*
These are integration tests that will send out
different sizes of opengov tips.

These tests do not cover the part with GitHub interaction,
they execute the tipping functions directly.
*/

import "@polkadot/api-augment";
import { Keyring } from "@polkadot/api";
import { BN } from "@polkadot/util";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import { polkadot } from "@polkadot-api/descriptors";
import assert from "assert";
import { createClient, PolkadotClient } from "polkadot-api";
import { WebSocketProvider } from "polkadot-api/ws-provider/node";
import { GenericContainer, StartedTestContainer, Wait } from "testcontainers";

import { getChainConfig } from "./chain-config";
import { logMock, randomAddress } from "./testUtil";
import { API, tipUser } from "./tip";
import { State, TipRequest } from "./types";
import { encodeProposal } from "./util";
import { generateSigner } from "./bot-initialize";

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
  let rococoClient: PolkadotClient;
  let rococoApi: API;
  let westendContainer: StartedTestContainer;
  let westendClient: PolkadotClient;
  let westendApi: API;

  beforeAll(async () => {
    rococoContainer = await new GenericContainer(`parity/polkadot:${POLKADOT_VERSION}`)
      .withExposedPorts({ container: 9945, host: 9902 }) // Corresponds to chain-config.ts
      .withWaitStrategy(Wait.forListeningPorts())
      .withCommand(("--chain rococo-dev " + commonDockerArgs).split(" "))
      .start();
    rococoClient = createClient(WebSocketProvider(getChainConfig("localrococo").providerEndpoint));
    rococoApi = rococoClient.getTypedApi(polkadot);
    westendContainer = await new GenericContainer(`parity/polkadot:${POLKADOT_VERSION}`)
      .withExposedPorts({ container: 9945, host: 9903 }) // Corresponds to chain-config.ts
      .withWaitStrategy(Wait.forListeningPorts())
      .withCommand(("--chain westend-dev " + commonDockerArgs).split(" "))
      .start();
    westendClient = createClient(WebSocketProvider(getChainConfig("localwestend").providerEndpoint));
    westendApi = westendClient.getTypedApi(polkadot);
  });

  afterAll(async () => {
    rococoClient.destroy();
    westendClient.destroy();
    await rococoContainer.stop();
    await westendContainer.stop();
  });

  const getUserBalance = async (api: API, userAddress: string) => {
    const { data } = await api.query.System.Account.getValue(userAddress);
    return data.free;
  };

  beforeAll(async () => {
    await cryptoWaitReady();
    const keyring = new Keyring({ type: "sr25519" });
    try {
      await rococoClient.getFinalizedBlock();
      await westendClient.getFinalizedBlock();
    } catch (e) {
      throw new Error(
        `For these integrations tests, we're expecting local Rococo on ${
          getChainConfig("localrococo").providerEndpoint
        } and local Westend on ${getChainConfig("localwestend").providerEndpoint}. Please refer to the Readme.`,
      );
    }

    assert(Number(await getUserBalance(rococoApi, tipperAccount)) > 0);
    assert(Number(await getUserBalance(westendApi, tipperAccount)) > 0);
    state = {
      allowedGitHubOrg: "test",
      allowedGitHubTeam: "test",
      botTipAccount: generateSigner("//Bob"),
      bot: { log: logMock } as any, // eslint-disable-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
    };
  });

  for (const network of networks) {
    describe(network, () => {
      for (const tipSize of tipSizes) {
        test(`tips a user (${tipSize.toString()})`, async () => {
          const tipRequest = getTipRequest({ size: tipSize }, network);

          const api = network === "localrococo" ? rococoApi : westendApi;
          const nextFreeReferendumId = await api.query.Referenda.ReferendumCount.getValue();
          const result = await tipUser(state, tipRequest);

          expect(result.success).toBeTruthy();
          if (result.success) {
            expect(result.blockHash).toBeDefined();
            expect(result.referendumNumber).toBeDefined();
            expect(result.referendumNumber).toEqual(nextFreeReferendumId);
            expect(result.track).toBeDefined();
            expect(result.value).toBeDefined();
          }

          const referendum = await api.query.Referenda.ReferendumInfoFor.getValue(nextFreeReferendumId);
          expect(referendum?.type).toEqual("Ongoing");
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
        const encodeProposalResult = await encodeProposal(api, tipRequest);
        if ("success" in encodeProposalResult) {
          throw new Error("Encoding the proposal failed.");
        }
        // TODO: Find way to compare
        // const { encodedProposal } = encodeProposalResult;
        const nextFreeReferendumId = await api.query.Referenda.ReferendumCount.getValue();

        // We surround our tip with two "decoys" to make sure that we find the proper one.
        await tipUser(state, tipRequest); // Will occupy nextFreeReferendumId
        const result = await tipUser(state, tipRequest); // Will occupy nextFreeReferendumId + 1
        await tipUser(state, tipRequest); // Will occupy nextFreeReferendumId + 2

        if (!result.success) {
          throw new Error("Tipping unsuccessful.");
        }

        const referendums = await api.event.Referenda.Submitted.pull();
        const referendum = referendums.filter((r) => r.meta.block.hash === result.blockHash);
        if (referendum.length === 0) {
          throw new Error("No referendums found for blockhash");
        }

        const id = referendum[0].payload.index;

        expect(id).toBeDefined();
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        expect(id).toEqual(nextFreeReferendumId + 1);
      });
    });
  }
});
