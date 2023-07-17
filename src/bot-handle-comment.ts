import { github } from "@eng-automation/integrations";
import { envVar } from "@eng-automation/js";
import { IssueCommentCreatedEvent } from "@octokit/webhooks-types";

import { updateBalance } from "./balance";
import { matrixNotifyOnFailure, matrixNotifyOnNewTip } from "./matrix";
import { recordTip } from "./metrics";
import { tipUser } from "./tip";
import { GithubReactionType, State, TipRequest } from "./types";
import { formatTipSize, getTipSize, parseContributorAccount } from "./util";

type OnIssueCommentResult = { success: true; message: string } | { success: false; errorMessage: string };

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

  await githubEmojiReaction("eyes");
  await matrixNotifyOnNewTip(state.matrix, event);
  try {
    const result = await handleTipRequest(state, event, tipRequester, octokitInstance);
    if (result.success) {
      await githubComment(result.message);
      await githubEmojiReaction("rocket");
    } else {
      await githubComment(result.errorMessage);
      await githubEmojiReaction("confused");
      await matrixNotifyOnFailure(state.matrix, event);
    }
  } catch (e) {
    state.bot.log.error(e.message);
    await githubComment(
      `@${tipRequester} Could not submit tip :( The team has been notified. Alternatively open an issue [here](https://github.com/paritytech/substrate-tip-bot/issues/new).`,
    );
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

  const userBio = (await octokitInstance.rest.users.getByUsername({ username: contributorLogin })).data.bio;
  const contributorAccount = parseContributorAccount([pullRequestBody, userBio]);
  if ("error" in contributorAccount) {
    // Contributor is tagged because it is up to him to properly prepare his address.
    return { success: false, errorMessage: `@${contributorLogin} ${contributorAccount.error}` };
  }

  const tipSize = getTipSize(tipSizeInput);
  if (typeof tipSize == "object" && "error" in tipSize) {
    return { success: false, errorMessage: `@${tipRequester} ${tipSize.error}` };
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
