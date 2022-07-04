import { IssueCommentCreatedContext } from "./types"

export function isPullRequest(context: IssueCommentCreatedContext): boolean {
  return Object.prototype.hasOwnProperty.call(
    context.payload.issue,
    "pull_request",
  )
}
