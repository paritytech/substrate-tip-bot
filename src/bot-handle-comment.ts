import { github } from "@eng-automation/integrations";
import { GitHubInstance } from "@eng-automation/integrations/dist/github/types";
import { envVar } from "@eng-automation/js";
import { IssueCommentCreatedEvent } from "@octokit/webhooks-types";

import { updateBalance } from "./balance";
import { matrixNotifyOnFailure, matrixNotifyOnNewTip } from "./matrix";
import { recordTip } from "./metrics";
import { tipUser, tipUserLink } from "./tip";
import { updatePolkassemblyPost } from "./tip-opengov";
import { GithubReactionType, State, TipRequest, TipResult } from "./types";
import { formatTipSize, getTipSize, parseContributorAccount } from "./util";

type OnIssueCommentResult =
  | { success: true; message: string }
  | { success: true; message: string; tipRequest: TipRequest; tipResult: Extract<TipResult, { success: true }> }
  | { success: false; errorMessage: string };

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

  // The "Unsafe assignment of an error typed value" error here goes deep into octokit types, that are full of `any`s
  // I wasn't able to get around it
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const octokitInstance: GitHubInstance = await github.getInstance({
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
  let result: OnIssueCommentResult;
  try {
    result = await handleTipRequest(state, event, tipRequester, octokitInstance);
    if (result.success) {
      await githubComment(result.message);
      await githubEmojiReaction("rocket");
    } else {
      await githubComment(result.errorMessage);
      await githubEmojiReaction("confused");
      await matrixNotifyOnFailure(state.matrix, event, { tagMaintainers: false });
    }
  } catch (e) {
    state.bot.log.error(e.message);
    await githubComment(
      `@${tipRequester} Could not submit tip :( The team has been notified. Alternatively open an issue [here](https://github.com/paritytech/substrate-tip-bot/issues/new).`,
    );
    await githubEmojiReaction("confused");
    await matrixNotifyOnFailure(state.matrix, event, { tagMaintainers: true });
    return;
  }

  if (result.success && state.polkassembly && "tipResult" in result && result.tipResult.referendumNumber) {
    try {
      const { url } = await updatePolkassemblyPost({
        polkassembly: state.polkassembly,
        referendumId: result.tipResult.referendumNumber,
        tipRequest: result.tipRequest,
        track: result.tipResult.track,
        log: state.bot.log,
      });
      await githubComment(`The referendum has appeared on [Polkassembly](${url}).`);
    } catch (e) {
      state.bot.log.error("Failed to update the Polkasssembly metadata", {
        referendumId: result.tipResult.referendumNumber,
        tipRequest: JSON.stringify(result.tipRequest),
      });
      state.bot.log.error(e.message);
      await matrixNotifyOnFailure(state.matrix, event, {
        tagMaintainers: true,
        failedItem: "Polkassembly post update",
      });
    }
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

  if (
    !(await github.isGithubTeamMember(
      { org: allowedGitHubOrg, team: allowedGitHubTeam, username: tipRequester },
      { octokitInstance },
    ))
  ) {
    let createReferendumLink: string | undefined = undefined;
    try {
      const tipLink = await tipUserLink(state, tipRequest);
      if (!tipLink.success) {
        throw new Error(tipLink.errorMessage);
      }
      createReferendumLink = tipLink.extrinsicCreationLink;
    } catch (e) {
      bot.log.error("Failed to encode and create a link to tip referendum creation.");
      bot.log.error(e.message);
    }

    let message =
      `Only members of \`${allowedGitHubOrg}/${allowedGitHubTeam}\` ` +
      `have permission to request the creation of the tip referendum from the bot.\n\n`;
    message += `However, you can create the tip referendum yourself using [Polkassembly](https://wiki.polkadot.network/docs/learn-polkadot-opengov-treasury#submit-treasury-proposal-via-polkassembly)`;
    return {
      success: true,
      message: createReferendumLink ? message + ` or [PolkadotJS Apps](${createReferendumLink}).` : message + ".",
    };
  }

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
    const numberInfo =
      tipResult.referendumNumber !== null ? `Referendum number: **${tipResult.referendumNumber}**.` : "";
    return {
      success: true,
      tipRequest,
      tipResult,
      message: `@${tipRequester} A referendum for a ${formatTipSize(
        tipRequest,
      )} tip was successfully submitted for @${contributorLogin} (${contributorAccount.address} on ${
        contributorAccount.network
      }).\n\n${numberInfo}\n![tip](https://c.tenor.com/GdyQm7LX3h4AAAAi/mlady-fedora.gif)`,
    };
  } else {
    return { success: false, errorMessage: tipResult.errorMessage };
  }
};
