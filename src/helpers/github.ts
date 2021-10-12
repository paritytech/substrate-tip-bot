export function postComment(context, body) {
  const issueComment = context.issue({
    body: body,
  });

  return context.octokit.issues.createComment(issueComment);
}
