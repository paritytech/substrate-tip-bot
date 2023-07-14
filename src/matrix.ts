import { IssueCommentCreatedEvent } from "@octokit/webhooks-types";

import { State } from "./types";
import { teamMatrixHandles } from "./util";

export const sendMatrixMessage = async (
  matrix: State["matrix"],
  opts: { text: string; html: string },
): Promise<void> => {
  await matrix?.client.sendMessage(matrix.roomId, {
    body: opts.text,
    format: "org.matrix.custom.html",
    formatted_body: opts.html,
    msgtype: "m.text",
  });
};

export const matrixNotifyOnNewTip = async (matrix: State["matrix"], event: IssueCommentCreatedEvent): Promise<void> => {
  await sendMatrixMessage(matrix, {
    text: `A new tip has been requested: ${event.comment.html_url}`,
    html: `A new tip has been <a href="${event.comment.html_url}">requested</a>.`,
  });
};

export const matrixNotifyOnFailure = async (
  matrix: State["matrix"],
  event: IssueCommentCreatedEvent,
): Promise<void> => {
  await sendMatrixMessage(matrix, {
    text: `${teamMatrixHandles.join(" ")} A tip has failed: ${event.comment.html_url}`,
    html: `${teamMatrixHandles.join(" ")} A tip has <a href="${event.comment.html_url}">failed</a>!`,
  });
};
