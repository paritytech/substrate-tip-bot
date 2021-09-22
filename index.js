/**
 * This is the main entrypoint to your Probot app
 * @param {import('probot').Probot} app
 */
module.exports = (app) => {
  // Your code here
  app.log.info("Yay, the app was loaded!");

  app.on("issue_comment", async (context) => {
    let commentText = context.payload.comment.body
    if (
      !context.payload.issue.hasOwnProperty("pull_request") ||
      context.payload.action !== "created" ||
      !commentText.startsWith("/tip")
    ) {
      return
    }

    const repo = context.payload.repository.name
    const owner = context.payload.repository.owner.login
    const pull_number = context.payload.issue.number

    // text payload should be: "/tip {network} {small/medium/large/extra large}"
    let textParts = commentText.split(" ");

    if (textParts.length !== 3) {
      postComment(context, `Invalid command! \n payload should be: /tip { network } { small / medium / large / extra large}`);
    }

    postComment(context, `Valid command: 1) ${textParts[0]}, 2) ${textParts[1]}, 3) ${textParts[2]}`);
  });

  // For more information on building apps:
  // https://probot.github.io/docs/

  // To get your app running against GitHub, see:
  // https://probot.github.io/docs/development/
};

function postComment(context, body) {
  const issueComment = context.issue({
    body: body,
  });
  return context.octokit.issues.createComment(issueComment);
}
