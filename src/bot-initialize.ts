import { envVar } from "@eng-automation/js";
import { Keyring } from "@polkadot/api";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import { createClient } from "matrix-js-sdk";
import { ApplicationFunction, Context, Probot } from "probot";

import { updateAllBalances } from "./balance";
import { handleIssueCommentCreated } from "./bot-handle-comment";
import { addMetricsRoute } from "./metrics";
import { Polkassembly } from "./polkassembly/polkassembly";
import { State } from "./types";

type AsyncApplicationFunction = (
  ...params: Parameters<ApplicationFunction>
) => Promise<ReturnType<ApplicationFunction>>;

export const botInitialize: AsyncApplicationFunction = async (bot: Probot, { getRouter }) => {
  bot.log.info("Loading tip bot...");
  const router = getRouter?.("/tip-bot");
  if (router) {
    addMetricsRoute(router);
  } else {
    bot.log.warn("No router received from the probot library, metrics were not added.");
  }

  await cryptoWaitReady();
  const keyring = new Keyring({ type: "sr25519" });
  const botTipAccount = keyring.addFromUri(envVar("ACCOUNT_SEED"));
  const state: State = {
    bot,
    allowedGitHubOrg: envVar("APPROVERS_GH_ORG"),
    allowedGitHubTeam: envVar("APPROVERS_GH_TEAM"),
    botTipAccount,
    polkassembly: new Polkassembly(
      envVar("POLKASSEMBLY_ENDPOINT"),
      { type: "polkadot", keyringPair: botTipAccount },
      bot.log,
    ),
    matrix: {
      client: createClient({
        accessToken: envVar("MATRIX_ACCESS_TOKEN"),
        baseUrl: envVar("MATRIX_SERVER_URL"),
        localTimeoutMs: 10000,
      }),
      roomId: envVar("MATRIX_ROOM_ID"),
    },
  };

  bot.log.info("Tip bot was loaded!");

  bot.on("issue_comment.created", async (context: Context<"issue_comment.created">) => {
    await handleIssueCommentCreated(state, context.payload);
  });

  try {
    bot.log.info("Loading bot balances across all networks...");
    await updateAllBalances(state.botTipAccount.address, bot.log);
    bot.log.info("Updated bot balances across all networks!");
  } catch (e) {
    bot.log.error(e.message);
  }
};
