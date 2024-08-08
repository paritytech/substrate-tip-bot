/*
These are integration tests that will send out
different sizes of opengov tips.

These tests do not cover the part with GitHub interaction,
they execute the tipping functions directly.
*/

import { localrococo, localwestend } from "@polkadot-api/descriptors";
import { DEV_PHRASE } from "@polkadot-labs/hdkd-helpers";
import assert from "assert";
import fs from "fs/promises";
import path from "path";
import { createClient, PolkadotClient, TypedApi } from "polkadot-api";
import { WebSocketProvider } from "polkadot-api/ws-provider/node";
import { filter, firstValueFrom } from "rxjs";
import { Readable } from "stream";
import { GenericContainer, StartedTestContainer, Wait } from "testcontainers";

import { generateSigner } from "./bot-initialize";
import { papiConfig } from "./chain-config";
import { logMock, randomAddress } from "./testUtil";
import { tipUser } from "./tip";
import { State, TipRequest } from "./types";

const tipperAccount = "14E5nqKAp3oAJcmzgZhUD2RcptBeUBScxKHgJKU4HPNcKVf3"; // Bob

const getTipRequest = (tip: TipRequest["tip"], network: "localrococo" | "localwestend"): TipRequest => {
  return {
    tip,
    contributor: { githubUsername: "test", account: { address: randomAddress(), network } },
    pullRequestRepo: "test",
    pullRequestNumber: 1,
  };
};

const containterLogsDir = path.join(process.cwd(), "integration_tests", "containter_logs");
const start = Date.now();

// Taking all output to integration_tests/containter_logs/*.container.log
function logConsumer(name: string): (stream: Readable) => Promise<void> {
  return async (stream: Readable) => {
    const logsfile = await fs.open(path.join(containterLogsDir, `${name}.log`), "w");
    stream.on("data", (line) => logsfile.write(`[${Date.now() - start}ms] ${line}`));
    stream.on("err", (line) => logsfile.write(`[${Date.now() - start}ms] ${line}`));
    stream.on("end", async () => {
      await logsfile.write("Stream closed\n");
      await logsfile.close();
    });
  };
}

const POLKADOT_VERSION = "v1.15.0";
const networks = ["localrococo", "localwestend"] as const;
const tipSizes: TipRequest["tip"]["size"][] = ["small", "medium", "large", 1n, 3n];
const commonDockerArgs =
  "--tmp --alice --execution Native --rpc-port 9945 --rpc-external --no-prometheus --no-telemetry --rpc-cors all --unsafe-force-node-key-generation";

describe("tip", () => {
  let state: State;
  let rococoContainer: StartedTestContainer;
  let rococoClient: PolkadotClient;
  let rococoApi: TypedApi<typeof localrococo>;
  let westendContainer: StartedTestContainer;
  let westendClient: PolkadotClient;
  let westendApi: TypedApi<typeof localwestend>;

  const getUserBalance = async (api: TypedApi<typeof localrococo | typeof localwestend>, userAddress: string) => {
    const { data } = await api.query.System.Account.getValue(userAddress, { at: "best" });
    return data.free;
  };

  beforeAll(async () => {
    await fs.mkdir(containterLogsDir, { recursive: true });

    [rococoContainer, westendContainer] = await Promise.all([
      new GenericContainer(`parity/polkadot:${POLKADOT_VERSION}`)
        .withExposedPorts({ container: 9945, host: 9902 }) // Corresponds to chain-config.ts
        .withWaitStrategy(Wait.forListeningPorts())
        .withCommand(("--chain rococo-dev " + commonDockerArgs).split(" "))
        .withLogConsumer(logConsumer("rococo"))
        .withWaitStrategy(Wait.forLogMessage("Concluded mandatory round"))
        .start(),
      new GenericContainer(`parity/polkadot:${POLKADOT_VERSION}`)
        .withExposedPorts({ container: 9945, host: 9903 }) // Corresponds to chain-config.ts
        .withWaitStrategy(Wait.forListeningPorts())
        .withCommand(("--chain westend-dev " + commonDockerArgs).split(" "))
        .withLogConsumer(logConsumer("westend"))
        .withWaitStrategy(Wait.forLogMessage("Concluded mandatory round"))
        .start(),
    ]);

    rococoClient = createClient(WebSocketProvider(papiConfig.entries.localrococo.wsUrl));
    rococoApi = rococoClient.getTypedApi(localrococo);

    westendClient = createClient(WebSocketProvider(papiConfig.entries.localwestend.wsUrl));
    westendApi = westendClient.getTypedApi(localwestend);

    // ensure that the connection works
    await Promise.all([rococoApi.query.System.Number.getValue(), westendApi.query.System.Number.getValue()]);

    assert(Number(await getUserBalance(rococoApi, tipperAccount)) > 0);
    assert(Number(await getUserBalance(westendApi, tipperAccount)) > 0);
    state = {
      allowedGitHubOrg: "test",
      allowedGitHubTeam: "test",
      botTipAccount: generateSigner(`${DEV_PHRASE}//Bob`),
      bot: { log: logMock } as any, // eslint-disable-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
    };
  });

  afterAll(async () => {
    rococoClient.destroy();
    westendClient.destroy();
    await rococoContainer.stop();
    await westendContainer.stop();
  });

  describe.each([networks])("%s", (network: "localrococo" | "localwestend") => {
    test.each(tipSizes)("tips a user (%s)", async (tipSize) => {
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

      // This returns undefined for a bit, so using subscription to wait for the data
      const referendum = await firstValueFrom(
        api.query.Referenda.ReferendumInfoFor.watchValue(nextFreeReferendumId).pipe(
          filter((value) => value !== undefined),
        ),
      );
      expect(referendum?.type).toEqual("Ongoing");
    });

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
  });
});
