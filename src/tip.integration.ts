/*
These are integration tests that will send out
different sizes of opengov tips.

These tests do not cover the part with GitHub interaction,
they execute the tipping functions directly.
*/

import { localrococo, localwestend } from "@polkadot-api/descriptors";
import assert from "assert";
import { createClient, PolkadotClient, TypedApi } from "polkadot-api";
import { WebSocketProvider } from "polkadot-api/ws-provider/node";
import { GenericContainer, StartedTestContainer, Wait } from "testcontainers";

import { generateSigner } from "./bot-initialize";
import { getChainConfig } from "./chain-config";
import { logMock, randomAddress } from "./testUtil";
import { tipUser } from "./tip";
import { State, TipRequest } from "./types";
import { encodeProposal } from "./util";

const tipperAccount = "14E5nqKAp3oAJcmzgZhUD2RcptBeUBScxKHgJKU4HPNcKVf3"; // Bob

const getTipRequest = (tip: TipRequest["tip"], network: "localrococo" | "localwestend"): TipRequest => {
  return {
    tip,
    contributor: { githubUsername: "test", account: { address: randomAddress(), network } },
    pullRequestRepo: "test",
    pullRequestNumber: 1,
  };
};

const POLKADOT_VERSION = "v1.15.0";
const networks = ["localrococo", "localwestend"] as const;
const tipSizes: TipRequest["tip"]["size"][] = ["small", "medium", "large", 1n, 3n];
const commonDockerArgs =
  "--tmp --alice --execution Native --rpc-port 9945 --rpc-external --no-prometheus --no-telemetry --rpc-cors all";

describe("tip", () => {
  let state: State;
  let rococoContainer: StartedTestContainer;
  let rococoClient: PolkadotClient;
  let rococoApi: TypedApi<typeof localrococo>;
  let westendContainer: StartedTestContainer;
  let westendClient: PolkadotClient;
  let westendApi: TypedApi<typeof localwestend>;

  beforeAll(async () => {
    rococoContainer = await new GenericContainer(`parity/polkadot:${POLKADOT_VERSION}`)
      .withExposedPorts({ container: 9945, host: 9902 }) // Corresponds to chain-config.ts
      .withWaitStrategy(Wait.forListeningPorts())
      .withCommand(("--chain rococo-dev " + commonDockerArgs).split(" "))
      .start();
    rococoClient = createClient(WebSocketProvider(getChainConfig("localrococo").providerEndpoint));
    rococoApi = rococoClient.getTypedApi(localrococo);
    await rococoApi.query.System.Number.getValue();

    westendContainer = await new GenericContainer(`parity/polkadot:${POLKADOT_VERSION}`)
      .withExposedPorts({ container: 9945, host: 9903 }) // Corresponds to chain-config.ts
      .withWaitStrategy(Wait.forListeningPorts())
      .withCommand(("--chain westend-dev " + commonDockerArgs).split(" "))
      .start();
    westendClient = createClient(WebSocketProvider(getChainConfig("localwestend").providerEndpoint));
    westendApi = westendClient.getTypedApi(localwestend);
    await westendApi.query.System.Number.getValue();
  });

  afterAll(async () => {
    rococoClient.destroy();
    westendClient.destroy();
    await rococoContainer.stop();
    await westendContainer.stop();
  });

  const getUserBalance = async (api: TypedApi<typeof localrococo | typeof localwestend>, userAddress: string) => {
    const { data } = await api.query.System.Account.getValue(userAddress);
    return data.free;
  };

  beforeAll(async () => {
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
        const tipRequest = getTipRequest({ size: 1001n }, network);

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
        const client = network === "localrococo" ? rococoClient : westendClient;

        const tipRequest = getTipRequest({ size: 1n }, network);
        const encodeProposalResult = await encodeProposal(client, tipRequest);
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
