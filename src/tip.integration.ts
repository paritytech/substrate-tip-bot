/*
These are integration tests that will send out
different sizes of opengov tips.
*/

import { findFreePorts, until } from "@eng-automation/js";
import { fixtures, githubWebhooks, mockServer } from "@eng-automation/testing";
import { rococo, westend } from "@polkadot-api/descriptors";
import { DEV_PHRASE } from "@polkadot-labs/hdkd-helpers";
import assert from "assert";
import fs from "fs/promises";
import path from "path";
import { Binary, createClient, PolkadotClient, TypedApi } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider/node";
import { filter, firstValueFrom } from "rxjs";
import { Readable } from "stream";
import { GenericContainer, Network, StartedTestContainer, TestContainers, Wait } from "testcontainers";

import { randomAddress } from "./testUtil";

const tipperAccount = "14E5nqKAp3oAJcmzgZhUD2RcptBeUBScxKHgJKU4HPNcKVf3"; // Bob

const containterLogsDir = path.join(process.cwd(), "integration_tests", "containter_logs");
const testCaCertPath = path.join(process.cwd(), "integration_tests", "test-ca.pem");
const start = Date.now();

// Taking all output to integration_tests/containter_logs/*.container.log
// Disabling timestamps for probot logs, which can be read in pretty format using `pino-pretty`
function logConsumer(name: string, addTs: boolean = true): (stream: Readable) => Promise<void> {
  return async (stream: Readable) => {
    const logsfile = await fs.open(path.join(containterLogsDir, `${name}.log`), "w");
    stream.on("data", (line) => logsfile.write(addTs ? `[${Date.now() - start}ms] ${line}` : line));
    stream.on("err", (line) => logsfile.write(addTs ? `[${Date.now() - start}ms] ${line}` : line));
    stream.on("end", async () => {
      await logsfile.write("Stream closed\n");
      await logsfile.close();
    });
  };
}

const POLKADOT_VERSION = "v1.15.2";
const networks = ["rococo", "westend"] as const;
const tipSizes = ["small", "medium", "large", "1", "3"];
const commonDockerArgs =
  "--tmp --alice --execution Native --rpc-port 9945 --rpc-external --no-prometheus --no-telemetry --rpc-cors all --unsafe-force-node-key-generation";
const probotPort = 3000; // default value; not configured in the app

export const jsonResponseHeaders = { "content-type": "application/json" };

const tipBotOrgToken = "ghs_989898989898989898989898989898dfdfdfd";
const paritytechStgOrgToken = "ghs_12345678912345678123456723456abababa";

describe("tip", () => {
  let appContainer: StartedTestContainer;
  let rococoContainer: StartedTestContainer;
  let rococoClient: PolkadotClient;
  let rococoApi: TypedApi<typeof rococo>;
  let westendContainer: StartedTestContainer;
  let westendClient: PolkadotClient;
  let westendApi: TypedApi<typeof westend>;
  let gitHub: mockServer.MockServer;
  let appPort: number;

  const getUserBalance = async (api: TypedApi<typeof rococo | typeof westend>, userAddress: string) => {
    const { data } = await api.query.System.Account.getValue(userAddress, { at: "best" });
    return data.free;
  };

  const expectTipperMembership = async () => {
    await gitHub
      .forGet("/orgs/tip-bot-org/teams/tip-bot-approvers/memberships/tipper")
      .withHeaders({ Authorization: `token ${tipBotOrgToken}` })
      .thenReply(
        200,
        JSON.stringify(
          fixtures.github.getOrgMembershipPayload({
            login: "tipper",
            org: "tip-bot-approvers",
          }),
        ),
        jsonResponseHeaders,
      );
  };

  const expectNoTipperMembership = async () => {
    await gitHub
      .forGet("/orgs/tip-bot-org/teams/tip-bot-approvers/memberships/tipper")
      .withHeaders({ Authorization: `token ${tipBotOrgToken}` })
      .thenReply(
        404,
        JSON.stringify({
          message: "Not Found",
          documentation_url: "https://docs.github.com/rest/teams/members#get-team-membership-for-a-user",
          status: "404",
        }),
        jsonResponseHeaders,
      );
  };

  beforeAll(async () => {
    await fs.mkdir(containterLogsDir, { recursive: true });

    const [gitHubPort] = await findFreePorts(1);

    const containerNetwork = await new Network().start();

    await TestContainers.exposeHostPorts(gitHubPort);

    [rococoContainer, westendContainer, gitHub] = await Promise.all([
      new GenericContainer(`parity/polkadot:${POLKADOT_VERSION}`)
        .withWaitStrategy(Wait.forListeningPorts())
        .withCommand(("--chain rococo-dev " + commonDockerArgs).split(" "))
        .withLogConsumer(logConsumer("rococo"))
        .withWaitStrategy(Wait.forLogMessage("Concluded mandatory round"))
        .withNetwork(containerNetwork)
        .withNetworkAliases("localrococo")
        .withExposedPorts(9945)
        .withPlatform("linux/amd64")
        .start(),
      new GenericContainer(`parity/polkadot:${POLKADOT_VERSION}`)
        .withWaitStrategy(Wait.forListeningPorts())
        .withCommand(("--chain westend-dev " + commonDockerArgs).split(" "))
        .withLogConsumer(logConsumer("westend"))
        .withWaitStrategy(Wait.forLogMessage("Concluded mandatory round"))
        .withNetwork(containerNetwork)
        .withNetworkAliases("localwestend")
        .withExposedPorts(9945)
        .withPlatform("linux/amd64")
        .start(),
      mockServer.startMockServer({ name: "GitHub", port: gitHubPort, testCaCertPath }),
    ]);

    appContainer = await new GenericContainer(`substrate-tip-bot`)
      .withExposedPorts(probotPort) // default port of Probot
      .withWaitStrategy(Wait.forListeningPorts())
      .withLogConsumer(logConsumer("application", false))
      .withEnvironment({
        ACCOUNT_SEED: `${DEV_PHRASE}//Bob`,
        APP_ID: "123",
        // Same private key that's used in command-bot. Not being used anywhere except testing.
        PRIVATE_KEY_BASE64:
          "LS0tLS1CRUdJTiBSU0EgUFJJVkFURSBLRVktLS0tLQpNSUlFcEFJQkFBS0NBUUVBdGovK1RIV2J4\n" +
          "cEdOQ3JxVVBjaUhyQlhkOWM5NGszMjVVU0RFWW4wNzRSYnZpYTM1CklGbGREY0ZmcWFMOTlZeXpI\n" +
          "Q0FabFJDalNULzE1c3ZyV1pkVFFvMDM3OXRtWTVwcWUzLzFZSk40eGJhNnR5SEoKUnhQREl6ZGVj\n" +
          "emFIYWdjeS95Vm5aeHE4ZHRkanJUa3F2TzJTVXRNdUJLS0tVU3EzZ0YzaFdGQnJremhZcjIragph\n" +
          "L3lHTis4aE5mZ3Npb0t2K3pZanA1dkVjMFVwSXQ2eVdtZCtHc2NkMzhDZ3UwR2Qvb292OXBnQVZ0\n" +
          "TE5BNForCnlPY1JQdXZ5bzU2Y3oraitmaEpOak5IaXpBL3lNTzk0MDM5U1gxeGNCcjJkNWRHK21q\n" +
          "cUk0aHo2bFEwajRnT0EKRExacDVURGNjMHJlSU16ZTF2MFJSU2cyTEt0QlJBekFKUnhXS3dJREFR\n" +
          "QUJBb0lCQVFDRW04K25SclFRS2Z3YwpZR0paQ2o1ZDRwTmN0cGVmaWcxN2tJSVV2OWNBRXpZOFVk\n" +
          "QkJ6NFE3N0FaMVlsbXpmNnNidmVlZlpUbktwTFdDCk44S0pyK2d2TnA0Szh2TnZhZjRzMnBCcXN5\n" +
          "TmZpWFFXcUlqU0pQa0orTkhLdDFTVXU2UkpycWVzaC9HMTcwZGgKMVlUWmIydld4RDVwdFBNNzEv\n" +
          "OHBjaVh6b3FDRHYzSldLbnZnMERYQitwemUySjdnVDIrQWFienN4cFN3N0hxTApkMXpmWDF0T2Nx\n" +
          "cWV5b25DL1ZRQkIyZXJaNDRlVWdpVDIvSUJpMlJCRU1aaEwwVWlSZkJzaWdxRmczdHFMMHp6ClEy\n" +
          "SkdqUFd0YkM1ZDF5cEk0dHRVbDFpZ1JROSsrblI1cE55K3NGZXExTCs2T1VPVWtadVZwNHhES2dI\n" +
          "MjlkS0cKdFBCQmg1RVJBb0dCQU8yTForRnVmaU5RTnIzWXJrZTcyQ3BtWUFhdnk0MXhBUjJPazFn\n" +
          "TUJDV01sSHhURlIxdgpVaGVPZ01yaGIxanBiTlJhYWwyc3Z4TVg4alRLSlkvcldJWkVLeWROUm9K\n" +
          "QXB2eGZ0UXFDTkZRWFNESy9XWWVsCm9mQXpNK2xCQVBid3BaR1RZZmNjSGVRcUtxQURGb0xqbWg1\n" +
          "L002YkcwMTBwOU1RaStWVERBVysvQW9HQkFNUm8KMFRiTS9wLzNCTE9WTFUyS2NUQVFFV0pwVzlj\n" +
          "bkJjNW1rNzA0cW9SbjhUelJtdnhlVlRXQy9aSGNwNWFYc0s5RApnUFhYenU1bUZPQnhxNXZWNzFa\n" +
          "UkJGa2NmOGw2Wmg2ZFVFTHptSmt4Q2NJaEd3M0hidkxtYitSeHQrcFRDbU9NCklyS2lOZWJxS3Zt\n" +
          "S3kyUzdPMzJIOThvRUVhRHRNbjMydmowS1RMU1ZBb0dBUDJNRHhWUUd0TVdpMWVZTUczZzAKcHB2\n" +
          "SzQvM2xBMGswVXY3SXNxWUNOVUxlSEk3UEE1dkEvQ2c2bGVpeUhiZXNJcjQ5dytGazIyTjRiajND\n" +
          "NkRTVQoycjgyQkxiS0tkZTJ0NEdTZmN0Z3kwK3JKRitMTkhjdVR6cGFqOU9Zdmt4WTRnL0NCSDZz\n" +
          "TzBaRk9ZMlpaRFAzCjNFdDFMUHZCU3dyM0ZaOS9pTzdBWTJFQ2dZRUFnMnNMQ2RyeVNJQ1ZBY0JB\n" +
          "TnRENldVbDNDRjBzMlhJLzNWSWYKYW8zZThvZEdFQWJENkRjS1ZxcldGZUlKdEthOHp4aWcwbDVi\n" +
          "RklMelZ4WlgyQWEyaFEvaWsrbVF5M1A5bm1CdQpVczRCZmdjazIyTWhZZi9laWVLTVhkT0ZWdUhI\n" +
          "WXNKaWVSbzJiTktrZktKVTQ0cXdESmVNd2Z3ays0T2F0RlFFCkNIMjZ3MTBDZ1lCQVRuekJWeUt0\n" +
          "NlgvZHdoNE5OUGxYZjB4TVBrNUpIVStlY290WXNabXNHUmlDV3FhSjFrMm8KVFNQUjE5UHRRVVFh\n" +
          "T1FoSWNSc2IvNzlJUjNEUkdYTzVJY0dmblhPVXV0YW14b2xmYjdaODBvL1k5cWo5QUJSQwpKSUQ3\n" +
          "Qlc3Q3YvVDI2b1Z5TS9YckVlekNWZDRNYml2SGRyWno2UTRqRWk4VURRL2hNeVhpTmc9PQotLS0t\n" +
          "LUVORCBSU0EgUFJJVkFURSBLRVktLS0tLQo=",
        APPROVERS_GH_ORG: "tip-bot-org",
        APPROVERS_GH_TEAM: "tip-bot-approvers",
        WEBHOOK_SECRET: "webhook_secret_value",
        GITHUB_BASE_URL: `https://host.testcontainers.internal:${gitHub.port}`,

        NODE_EXTRA_CA_CERTS: "/test-ca.pem",

        INTEGRATION_TEST: "true",

        // node-fetch seems to be ingoring NODE_EXTRA_CA_CERTS
        // it's being used internally in @octokit/request, which, in turn, is used in @octokit/core,
        // which, in turn, is used in @eng-automation/integration
        // @see https://github.com/paritytech/opstooling-integrations/issues/25
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
      })
      .withWaitStrategy(Wait.forListeningPorts())
      .withNetwork(containerNetwork)
      .withCopyFilesToContainer([
        {
          source: testCaCertPath,
          target: "/test-ca.pem",
        },
      ])
      .start();

    appPort = appContainer.getMappedPort(probotPort);

    rococoClient = createClient(getWsProvider(`ws://localhost:${rococoContainer.getMappedPort(9945)}`));
    rococoApi = rococoClient.getTypedApi(rococo);

    westendClient = createClient(getWsProvider(`ws://localhost:${westendContainer.getMappedPort(9945)}`));
    westendApi = westendClient.getTypedApi(westend);

    // ensure that the connection works
    await Promise.all([rococoApi.query.System.Number.getValue(), westendApi.query.System.Number.getValue()]);

    assert(Number(await getUserBalance(rococoApi, tipperAccount)) > 0);
    assert(Number(await getUserBalance(westendApi, tipperAccount)) > 0);

    const appInstallations = fixtures.github.getAppInstallationsPayload([
      {
        accountLogin: "paritytech-stg",
        accountId: 74720417,
        id: 155,
      },
      {
        accountLogin: "tip-bot-org",
        accountId: 87878787,
        id: 199,
      },
    ]);

    await gitHub
      .forGet("/repos/paritytech-stg/testre/installation")
      .thenReply(200, JSON.stringify(appInstallations[0]), jsonResponseHeaders);

    await gitHub
      .forPost("/repos/paritytech-stg/testre/issues/comments/1234532076/reactions")
      .withHeaders({ Authorization: `token ${paritytechStgOrgToken}` })
      .thenReply(
        200,
        JSON.stringify(
          fixtures.github.getIssueCommentReactionPayload({
            content: "eyes",
          }),
        ),
        jsonResponseHeaders,
      );

    await gitHub
      .forPost("/app/installations/155/access_tokens")
      .thenReply(
        200,
        JSON.stringify(fixtures.github.getAppInstallationTokenPayload(paritytechStgOrgToken)),
        jsonResponseHeaders,
      );

    await gitHub
      .forPost("/app/installations/199/access_tokens")
      .thenReply(
        200,
        JSON.stringify(fixtures.github.getAppInstallationTokenPayload(tipBotOrgToken)),
        jsonResponseHeaders,
      );

    await gitHub
      .forGet("/app/installations")
      .withQuery({ per_page: "100" })
      .thenReply(200, JSON.stringify(appInstallations), jsonResponseHeaders);
  });

  afterAll(async () => {
    rococoClient?.destroy();
    westendClient?.destroy();
    await Promise.all([rococoContainer?.stop(), westendContainer?.stop(), gitHub?.stop(), appContainer?.stop()]);
  });

  describe.each([networks])("%s", (network: "rococo" | "westend") => {
    let contributorAddress: string;
    beforeEach(async () => {
      contributorAddress = randomAddress();
      await gitHub.forGet("/users/contributor").thenReply(
        200,
        JSON.stringify(
          fixtures.github.getUserPayload({
            login: "contributor",
            bio: `${network} address: ${contributorAddress}`,
          }),
        ),
        jsonResponseHeaders,
      );
    });

    test.each(tipSizes)("tips a user (%s)", async (tipSize) => {
      await expectTipperMembership();

      const api = network === "rococo" ? rococoApi : westendApi;
      const nextFreeReferendumId = await api.query.Referenda.ReferendumCount.getValue();

      const successEndpoint = await gitHub
        .forPost("/repos/paritytech-stg/testre/issues/4/comments")
        .withHeaders({ Authorization: `token ${paritytechStgOrgToken}` })
        .thenReply(
          200,
          JSON.stringify(
            fixtures.github.getIssueCommentPayload({
              org: "paritytech-stg",
              repo: "testre",
              comment: {
                author: "substrate-tip-bot",
                body: "",
                id: 4,
              },
            }),
          ),
        );

      await tipUser(appPort, tipSize);

      await until(async () => !(await successEndpoint.isPending()), 500, 100);

      const [request] = await successEndpoint.getSeenRequests();
      const body = (await request.body.getJson()) as { body: string };
      expect(body.body).toContain(`@tipper A referendum for a ${tipSize}`);
      expect(body.body).toContain("was successfully submitted for @contributor");
      expect(body.body).toContain(`Referendum number: **${nextFreeReferendumId}**`);

      const referendum = (await firstValueFrom(
        (
          api.query.Referenda.ReferendumInfoFor.watchValue(
            nextFreeReferendumId,
          ) as unknown as import("rxjs").Observable<{ type: string }>
        ).pipe(filter((v: unknown) => v !== undefined)),
      )) as { type: string };

      expect(referendum.type).toEqual("Ongoing");
    });

    test(`huge tip in ${network}`, async () => {
      await expectTipperMembership();
      const successEndpoint = await gitHub
        .forPost("/repos/paritytech-stg/testre/issues/4/comments")
        .withHeaders({ Authorization: `token ${paritytechStgOrgToken}` })
        .thenReply(
          200,
          JSON.stringify(
            fixtures.github.getIssueCommentPayload({
              org: "paritytech-stg",
              repo: "testre",
              comment: {
                author: "substrate-tip-bot",
                body: "",
                id: 4,
              },
            }),
          ),
        );

      await tipUser(appPort, "1000000");

      await until(async () => !(await successEndpoint.isPending()), 500, 50);
      const [request] = await successEndpoint.getSeenRequests();
      const body = (await request.body.getJson()) as { body: string };
      const currency = network === "rococo" ? "ROC" : "WND";
      expect(body.body).toContain(
        `The requested tip value of '1000000 ${currency}' exceeds the BigTipper track maximum`,
      );
    });

    test(`tip link in ${network}`, async () => {
      await expectNoTipperMembership();
      const successEndpoint = await gitHub
        .forPost("/repos/paritytech-stg/testre/issues/4/comments")
        .withHeaders({ Authorization: `token ${paritytechStgOrgToken}` })
        .thenReply(
          200,
          JSON.stringify(
            fixtures.github.getIssueCommentPayload({
              org: "paritytech-stg",
              repo: "testre",
              comment: {
                author: "substrate-tip-bot",
                body: "",
                id: 4,
              },
            }),
          ),
        );

      await tipUser(appPort, "small");

      await until(async () => !(await successEndpoint.isPending()), 500, 50);

      const [request] = await successEndpoint.getSeenRequests();
      const body = (await request.body.getJson()) as { body: string };
      expect(body.body).toContain(
        "Only members of [tip-bot-org/tip-bot-approvers](https://github.com/orgs/tip-bot-org/teams/tip-bot-approvers) have permission to request the creation of the tip referendum from the bot.",
      );
      expect(body.body).toContain(`https://polkadot.js.org/apps/?rpc=ws://local${network}:9945#/`);

      const extrinsicHex = body.body.match(/decode\/(\w+)/)?.[1];
      expect(extrinsicHex).toBeDefined();

      const api = network === "rococo" ? rococoApi : westendApi;
      const tx = await api.txFromCallData(Binary.fromHex(extrinsicHex!));
      expect(tx.decodedCall.type).toEqual("Referenda");
      expect(tx.decodedCall.value.type).toEqual("submit");
    });
  });
});

async function tipUser(port: number, tip: string) {
  await githubWebhooks.triggerWebhook({
    payload: fixtures.github.getCommentWebhookPayload({
      body: `/tip ${tip}`,
      login: "tipper",
      issueAuthorLogin: "contributor",
      org: "paritytech-stg",
      repo: "testre",
    }),
    githubEventHeader: "issue_comment.created",
    port,
  });
}
