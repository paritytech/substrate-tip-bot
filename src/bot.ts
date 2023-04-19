import { IssueCommentCreatedEvent } from "@octokit/webhooks-types";
import { Keyring } from "@polkadot/api";
import { BN } from "@polkadot/util";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import { github } from "opstooling-integrations";
import { displayError, envVar } from "opstooling-js";
import { ApplicationFunction, Probot, run } from "probot";

import { tipUser } from "./tip";
import { ContributorAccount, State, TipRequest, TipSize } from "./types";
import { formatTipSize, getTipSize, parseContributorAccount } from "./util";

const onIssueComment = async (
  state: State,
  event: IssueCommentCreatedEvent,
  tipRequester: string,
  octokitInstance: github.GitHubInstance,
): Promise<string | Error | undefined> => {
  const { allowedGitHubOrg, allowedGitHubTeam, bot } = state;

  const commentText = event.comment.body;
  const pullRequestBody = event.issue.body;
  const pullRequestUrl = event.issue.html_url;
  const contributorLogin = event.issue.user.login;
  const pullRequestNumber = event.issue.number;
  const pullRequestRepo = event.repository.name;

  const [botMention, tipSizeInput] = commentText.split(" ") as (string | undefined)[];

  // The bot only triggers on creation of a new comment on a pull request.
  if (!event.issue.pull_request || event.action !== "created" || !botMention?.startsWith("/tip")) {
    return;
  }

  if (tipRequester === contributorLogin) {
    return "Contributor and tipper cannot be the same person!";
  }

  if (
    !(await github.isGithubTeamMember(
      { org: allowedGitHubOrg, team: allowedGitHubTeam, username: tipRequester },
      { octokitInstance },
    ))
  ) {
    return `You are not allowed to request a tip. Only members of ${allowedGitHubOrg}/${allowedGitHubTeam} are allowed.`;
  }

  let contributorAccount: ContributorAccount;
  try {
    contributorAccount = parseContributorAccount(pullRequestBody);
  } catch (error) {
    return error.message;
  }

  let tipSize: TipSize | BN;
  try {
    tipSize = getTipSize(tipSizeInput);
  } catch (error) {
    return error.message;
  }

  const tipRequest: TipRequest = {
    contributor: { githubUsername: contributorLogin, account: contributorAccount },
    pullRequestNumber,
    pullRequestRepo,
    tip: { size: tipSize, type: botMention === "/testtip2" ? "opengov" : "treasury" },
  };

  bot.log(
    `Valid command!\n${tipRequester} wants to tip ${contributorLogin} (${contributorAccount.address} on ${
      contributorAccount.network
    }) a ${formatTipSize(tipRequest)} tip for pull request ${pullRequestUrl}.`,
  );

  const tipResult = await tipUser(state, tipRequest);

  // TODO actually check for problems with submitting the tip. Maybe even query storage to ensure the tip is there.
  return tipResult.success
    ? `A ${formatTipSize(tipRequest)} tip was successfully submitted for ${contributorLogin} (${
        contributorAccount.address
      } on ${contributorAccount.network}). \n\n ${
        tipResult.tipUrl
      } ![tip](https://c.tenor.com/GdyQm7LX3h4AAAAi/mlady-fedora.gif)`
    : tipResult.errorMessage ?? "Could not submit tip :( Notify someone at Parity.";
};

const main = async (bot: Probot) => {
  bot.log.info("Loading tip bot...");

  await cryptoWaitReady();
  const keyring = new Keyring({ type: "sr25519" });
  const state: State = {
    bot,
    allowedGitHubOrg: envVar("APPROVERS_GH_ORG"),
    allowedGitHubTeam: envVar("APPROVERS_GH_TEAM"),
    botTipAccount: keyring.addFromUri(envVar("ACCOUNT_SEED")),
  };

  bot.log.info("Tip bot was loaded!");

  bot.on("issue_comment.created", async (context) => {
    const tipRequester = context.payload.comment.user.login;
    const installationId = (
      await github.getRepoInstallation({
        owner: context.payload.repository.owner.login,
        repo: context.payload.repository.name,
      })
    ).data.id;

    const octokitInstance = await github.getInstance({
      authType: "installation",
      appId: envVar("GITHUB_APP_ID"),
      installationId: String(installationId),
      privateKey: envVar("GITHUB_PRIVATE_KEY"),
    });

    const respondOnResult = async (result: string | Error | undefined) => {
      if (result === undefined) {
        return;
      }

      await github.createComment(
        {
          owner: context.payload.repository.owner.login,
          repo: context.payload.repository.name,
          issue_number: context.payload.issue.number,
          body: `@${tipRequester} ${result instanceof Error ? `ERROR: ${displayError(result)}` : result}`,
        },
        { octokitInstance },
      );
    };

    void onIssueComment(state, context.payload, tipRequester, octokitInstance).then(respondOnResult, respondOnResult);
  });
};

if (process.env.PRIVATE_KEY_BASE64 && !process.env.PRIVATE_KEY) {
  process.env.PRIVATE_KEY = Buffer.from(envVar("PRIVATE_KEY_BASE64"), "base64").toString();
}

// Aligning environment between Probot and opstooling-integrations
process.env.GITHUB_APP_ID = process.env.APP_ID;
process.env.GITHUB_AUTH_TYPE = "app";
process.env.GITHUB_PRIVATE_KEY = process.env.PRIVATE_KEY;

/* Probot types do not accept async function type,
   but it seems that the actual code handles it properly. */
void run(main as ApplicationFunction);
