import { HandlerFunction } from "@octokit/webhooks/dist-types/types"
import { Probot } from "probot"

export type IssueCommentCreatedContext = Parameters<
  HandlerFunction<"issue_comment.created", unknown>
>[0]

export type State = {
  allowedTipRequesters: unknown[]
  seedOfTipperAccount: string
  bot: Probot
}
