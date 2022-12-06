import { displayError, envVar } from "opstooling-js";
import { Probot, run } from "probot";

import { isPullRequest } from "./github";
import { getTipSize, parseContributorAccount, tipUser } from "./tip";
import { IssueCommentCreatedContext, State } from "./types";

const onIssueComment = async (state: State, context: IssueCommentCreatedContext, tipRequester: string) => {
  const { allowedTipRequesters, bot } = state;

  const commentText = context.payload.comment.body;
  const pullRequestBody = context.payload.issue.body;
  const pullRequestUrl = context.payload.issue.html_url;
  const contributorLogin = context.payload.issue.user.login;
  const pullRequestNumber = context.payload.issue.number;
  const pullRequestRepo = context.payload.repository.name;

  const [botMention, tipSizeInput] = commentText.split(" ") as (string | undefined)[];

  // The bot only triggers on creation of a new comment on a pull request.
  if (!isPullRequest(context) || context.payload.action !== "created" || !botMention?.startsWith("/tip")) {
    return;
  }

  if (tipRequester === contributorLogin) {
    return "Contributor and tipper cannot be the same person!";
  }

  if (!allowedTipRequesters.includes(tipRequester)) {
    return `You are not allowed to request a tip. Only ${allowedTipRequesters.join(", ")} are allowed.`;
  }

  const contributorAccount = parseContributorAccount(pullRequestBody);
  const tipSize = getTipSize(tipSizeInput);

  bot.log(
    `Valid command!\n${tipRequester} wants to tip ${contributorLogin} (${contributorAccount.address} on ${contributorAccount.network}) a ${tipSize} tip for pull request ${pullRequestUrl}.`,
  );

  const tipResult = await tipUser(state, {
    contributor: { githubUsername: contributorLogin, account: contributorAccount },
    pullRequestNumber,
    pullRequestRepo,
    tipSize,
  });

  // TODO actually check for problems with submitting the tip. Maybe even query storage to ensure the tip is there.
  return tipResult.success
    ? `A ${tipSize} tip was successfully submitted for ${contributorLogin} (${contributorAccount.address} on ${contributorAccount.network}). \n\n ${tipResult.tipUrl} ![tip](https://c.tenor.com/GdyQm7LX3h4AAAAi/mlady-fedora.gif)`
    : "Could not submit tip :( Notify someone at Parity.";
};

const main = (bot: Probot) => {
  const allowedTipRequesters = JSON.parse(envVar("ALLOWED_USERS")) as unknown[];
  if (!Array.isArray(allowedTipRequesters)) {
    throw new Error("$ALLOWED_USERS needs to be an array");
  }

  const seedOfTipperAccount = envVar("ACCOUNT_SEED");

  const state = { allowedTipRequesters, seedOfTipperAccount, bot };

  bot.log.info("Tip bot was loaded!");

  bot.on("issue_comment", (context) => {
    const tipRequester = context.payload.comment.user.login;

    const respondOnResult = async (result: string | Error | undefined) => {
      if (result === undefined) {
        return;
      }

      await context.octokit.issues.createComment({
        owner: context.payload.repository.owner.login,
        repo: context.payload.repository.name,
        issue_number: context.payload.issue.number,
        body: `@${tipRequester} ${result instanceof Error ? `ERROR: ${displayError(result)}` : result}`,
      });
    };

    void onIssueComment(state, context, tipRequester).then(respondOnResult).catch(respondOnResult);
  });
};

void run(main);
