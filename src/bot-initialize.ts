import { envVar } from "@eng-automation/js";
import { sr25519CreateDerive } from "@polkadot-labs/hdkd";
import { entropyToMiniSecret, mnemonicToEntropy, parseSuri, ss58Address } from "@polkadot-labs/hdkd-helpers";
import { createClient } from "matrix-js-sdk";
import assert from "node:assert";
import * as process from "node:process";
import { PolkadotSigner } from "polkadot-api";
import { getPolkadotSigner } from "polkadot-api/signer";
import { ApplicationFunction, Context, Probot } from "probot";

import { updateAllBalances } from "./balance";
import { handleIssueCommentCreated } from "./bot-handle-comment";
import { addMetricsRoute } from "./metrics";
import { Polkassembly } from "./polkassembly/polkassembly";
import { State } from "./types";

type AsyncApplicationFunction = (
  ...params: Parameters<ApplicationFunction>
) => Promise<ReturnType<ApplicationFunction>>;

export const generateSigner = (accountSeed: string): PolkadotSigner => {
  const suri = parseSuri(accountSeed);

  assert(suri.phrase, "Invalid account seed");
  assert(typeof suri.paths === "string", "Invalid account seed - paths should be a string");

  const entropy = mnemonicToEntropy(suri.phrase);
  const miniSecret = entropyToMiniSecret(entropy);
  const hdkdKeyPair = sr25519CreateDerive(miniSecret)(suri.paths);

  return getPolkadotSigner(hdkdKeyPair.publicKey, "Sr25519", (input) => hdkdKeyPair.sign(input));
};

export const botInitialize: AsyncApplicationFunction = async (bot: Probot, { getRouter }) => {
  bot.log.info("Loading tip bot...");
  const router = getRouter?.("/tip-bot");
  if (router) {
    addMetricsRoute(router);
  } else {
    bot.log.warn("No router received from the probot library, metrics were not added.");
  }

  const botTipAccount = generateSigner(envVar("ACCOUNT_SEED"));
  const state: State = {
    bot,
    allowedGitHubOrg: envVar("APPROVERS_GH_ORG"),
    allowedGitHubTeam: envVar("APPROVERS_GH_TEAM"),
    botTipAccount,
    polkassembly: (() => {
      if (!process.env.POLKASSEMBLY_ENDPOINT) {
        // convenient for local development, and tests
        bot.log.warn("POLKASSEMBLY_ENDPOINT is not set; polkassembly integration is disabled");
        return undefined;
      }
      return new Polkassembly(
        envVar("POLKASSEMBLY_ENDPOINT"),
        { type: "polkadot", keyringPair: botTipAccount },
        bot.log,
      );
    })(),
    matrix: (() => {
      if (!process.env.MATRIX_ACCESS_TOKEN) {
        // convenient for local development, and tests
        bot.log.warn("MATRIX_ACCESS_TOKEN is not set; matrix notifications are disabled");
        return undefined;
      }
      return {
        client: createClient({
          accessToken: envVar("MATRIX_ACCESS_TOKEN"),
          baseUrl: envVar("MATRIX_SERVER_URL"),
          localTimeoutMs: 10000,
        }),
        roomId: envVar("MATRIX_ROOM_ID"),
      };
    })(),
  };

  bot.log.info("Tip bot was loaded!");

  bot.on("issue_comment.created", async (context: Context<"issue_comment.created">) => {
    await handleIssueCommentCreated(state, context.payload);
  });

  try {
    bot.log.info("Loading bot balances across all networks...");
    const address = ss58Address(botTipAccount.publicKey);
    await updateAllBalances(address, bot.log);
    bot.log.info("Updated bot balances across all networks!");
  } catch (e) {
    bot.log.error(e.message);
  }
};
