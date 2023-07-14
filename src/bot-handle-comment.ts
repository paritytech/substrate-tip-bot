import { github } from "@eng-automation/integrations";
import { envVar } from "@eng-automation/js";
import { IssueCommentCreatedEvent } from "@octokit/webhooks-types";
import { BN } from "@polkadot/util";

import { updateBalance } from "./balance";
import { matrixNotifyOnFailure, matrixNotifyOnNewTip } from "./matrix";
import { recordTip } from "./metrics";
import { tipUser } from "./tip";
import { ContributorAccount, GithubReactionType, State, TipRequest, TipSize } from "./types";
import { formatTipSize, getTipSize, parseContributorAccount } from "./util";

type OnIssueCommentResult = { success: true; message: string } | { success: false; errorMessage: string | undefined };

export const handleIssueCommentCreated = async (state: State, event: IssueCommentCreatedEvent): Promise<void> => {
  const [botMention] = event.comment.body.split(" ") as (string | undefined)[];

  // The bot only triggers on creation of a new comment on a pull request.
  if (!event.issue.pull_request || event.action !== "created" || !botMention?.startsWith("/tip")) {
    return;
  }

  const tipRequester = event.comment.user.login;
  const installationId = (
    await github.getRepoInstallation({ owner: event.repository.owner.login, repo: event.repository.name })
  ).id;

  const octokitInstance = await github.getInstance({
    authType: "installation",
    appId: envVar("GITHUB_APP_ID"),
    installationId: String(installationId),
    privateKey: envVar("GITHUB_PRIVATE_KEY"),
  });

  const respondParams = {
    owner: event.repository.owner.login,
    repo: event.repository.name,
    issue_number: event.issue.number,
  };

  const githubComment = async (body: string) =>
    await github.createComment({ ...respondParams, body }, { octokitInstance });
  const githubEmojiReaction = async (reaction: GithubReactionType) =>
    await github.createReactionForIssueComment(
      { ...respondParams, comment_id: event.comment.id, content: reaction },
      { octokitInstance },
    );

  const UNKNOWN_ERROR_MSG = `@${tipRequester} Could not submit tip :( The team has been notified. Alternatively open an issue [here](https://github.com/paritytech/substrate-tip-bot/issues/new).`;
  await githubEmojiReaction("eyes");
  await matrixNotifyOnNewTip(state.matrix, event);
  try {
    const result = await handleTipRequest(state, event, tipRequester, octokitInstance);
    if (result.success) {
      await githubComment(result.message);
      await githubEmojiReaction("rocket");
    } else {
      await githubComment(result.errorMessage ?? UNKNOWN_ERROR_MSG);
      await githubEmojiReaction("confused");
      await matrixNotifyOnFailure(state.matrix, event);
    }
  } catch (e) {
    state.bot.log.error(e.message);
    await githubComment(UNKNOWN_ERROR_MSG);
    await githubEmojiReaction("confused");
    await matrixNotifyOnFailure(state.matrix, event);
  }
};

export const handleTipRequest = async (
  state: State,
  event: IssueCommentCreatedEvent,
  tipRequester: string,
  octokitInstance: github.GitHubInstance,
): Promise<OnIssueCommentResult> => {
  const { allowedGitHubOrg, allowedGitHubTeam, bot } = state;

  const [_, tipSizeInput] = event.comment.body.split(" ") as (string | undefined)[];
  const pullRequestBody = event.issue.body;
  const pullRequestUrl = event.issue.html_url;
  const contributorLogin = event.issue.user.login;
  const pullRequestNumber = event.issue.number;
  const pullRequestRepo = event.repository.name;

  if (tipRequester === contributorLogin) {
    return { success: false, errorMessage: `@${tipRequester} Contributor and tipper cannot be the same person!` };
  }

  if (
    !(await github.isGithubTeamMember(
      { org: allowedGitHubOrg, team: allowedGitHubTeam, username: tipRequester },
      { octokitInstance },
    ))
  ) {
    return {
      success: false,
      errorMessage: `@${tipRequester} You are not allowed to request a tip. Only members of ${allowedGitHubOrg}/${allowedGitHubTeam} are allowed.`,
    };
  }

  let contributorAccount: ContributorAccount;
  try {
    const userData = await octokitInstance.rest.users.getByUsername({ username: contributorLogin });
    contributorAccount = parseContributorAccount([pullRequestBody, userData.data.bio]);
  } catch (error: unknown) {
    return { success: false, errorMessage: `@${contributorLogin} ${(error as Error).message}` };
  }

  let tipSize: TipSize | BN;
  try {
    tipSize = getTipSize(tipSizeInput);
  } catch (error: unknown) {
    return { success: false, errorMessage: `@${tipRequester} ${(error as Error).message}` };
  }

  const tipRequest: TipRequest = {
    contributor: { githubUsername: contributorLogin, account: contributorAccount },
    pullRequestNumber,
    pullRequestRepo,
    tip: { size: tipSize },
  };

  bot.log(
    `Valid command!\n${tipRequester} wants to tip ${contributorLogin} (${contributorAccount.address} on ${
      contributorAccount.network
    }) a ${formatTipSize(tipRequest)} tip for pull request ${pullRequestUrl}.`,
  );

  const tipResult = await tipUser(state, tipRequest);

  // The user doesn't need to wait until we update metrics and balances, so launching it separately.
  void (async () => {
    try {
      recordTip({ tipRequest, tipResult });
      await updateBalance({
        network: tipRequest.contributor.account.network,
        tipBotAddress: state.botTipAccount.address,
      });
    } catch (e) {
      bot.log.error(e.message);
    }
  })();

  if (tipResult.success) {
    return {
      success: true,
      message: `@${tipRequester} A ${formatTipSize(
        tipRequest,
      )} tip was successfully submitted for @${contributorLogin} (${contributorAccount.address} on ${
        contributorAccount.network
      }). \n\n ${tipResult.tipUrl} ![tip](https://c.tenor.com/GdyQm7LX3h4AAAAi/mlady-fedora.gif)`,
    };
  } else {
    return { success: false, errorMessage: tipResult.errorMessage };
  }
};
