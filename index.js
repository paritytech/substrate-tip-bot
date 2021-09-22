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

    //console.log(context);

    let problemsText = [];

    let addressRegex = /(polkadot|kusama) address:\s?([a-z0-9]+)/i

    let pullRequestBody = context.payload.issue.body;
    let pullRequestUrl = context.payload.issue.html_url;
    let tipper = context.payload.comment.user.login;
    let contributor = context.payload.issue.user.login;

    if (tipper === contributor) {
      // todo undo
      //problemsText.push(`Contributor and tipper cannot be the same person!`)
    }

    let network, address, size;

    let maybeMatch = pullRequestBody.match(addressRegex);
    console.log("maybe match: ", maybeMatch);
    if (maybeMatch.length != 3) {
      problemsText.push(`Contributor did not properly post their Polkadot or Kusama address. Make sure the pull request has: "{network} address: {address}".`);
    } else {
      network = maybeMatch[1].toLowerCase();
      if (network !== "polkadot" && network !== "kusama") {
        problemsText.push(`Invalid network: ${maybeMatch[1]}. Please select "polkadot" or "kusama".`);
      }

      address = maybeMatch[2];
    }

    // text payload should be: "/tip { small / medium / large }"
    let textParts = commentText.split(" ");

    if (textParts.length !== 2) {
      problemsText.push(`Invalid command! \n payload should be: /tip { small / medium / large }.`);
    } else {
      size = textParts[1].toLowerCase();
      if (size == "s") {
        size = "small";
      } else if (size == "m") {
        size = "medium";
      } else if (size == "l") {
        size = "large";
      }

      if (!["small", "medium", "large"].includes(size)) {
        problemsText.push(`Invalid tip size. Please specify one of small, medium, or large.`)
      }
    }

    if (problemsText.length > 0) {
      // there was some error to get to this point, lets list them.
      let comment = "Please fix the following problems before calling the tip bot again:";
      for (problem of problemsText) {
        comment += `\n * ${problem}`
      }
      postComment(context, comment);
    } else {
      //postComment(context, `Valid command! \n ${tipper} wants to tip ${contributor} (${address} on ${network}) a ${size} tip for pull request ${pullRequestUrl}.`);
      let result = await tipUser(address, contributor, network, pullRequestUrl, size);
      if (result) {
        postComment(context, `A ${size} tip was successfully submitted for ${contributor} (${address} on ${network}).`);
      } else {
        postComment(context, `Could not submit tip :( Notify someone at Parity.`);
      }
    }
    return;
  });
};

function postComment(context, body) {
  const issueComment = context.issue({
    body: body,
  });
  return context.octokit.issues.createComment(issueComment);
}

var { ApiPromise, WsProvider, Keyring } = require('@polkadot/api');
var { cryptoWaitReady } = require('@polkadot/util-crypto');

// TODO add some kind of timeout then return an error
async function tipUser(address, contributor, network, pullRequestUrl, size) {
  await cryptoWaitReady();
  const keyring = new Keyring({ type: 'sr25519' });
  // Substrate node we are connected to and listening to remarks
  const provider = new WsProvider('ws://localhost:9944');
  // let provider;
  // if (network == "polkadot") {
  //   provider = new WsProvider('wss://rpc.polkadot.io/');
  // } else if (network == "kusama") {
  //   provider = new WsProvider('wss://kusama-rpc.polkadot.io/');
  // } else {
  //   return;
  // }

  const api = await ApiPromise.create({ provider });

  // Get general information about the node we are connected to
  const [chain, nodeName, nodeVersion] = await Promise.all([
    api.rpc.system.chain(),
    api.rpc.system.name(),
    api.rpc.system.version()
  ]);
  console.log(
    `You are connected to chain ${chain} using ${nodeName} v${nodeVersion}`
  );

  let account = keyring.addFromUri('//Alice', { name: 'Alice default' });

  let reason = `TO ${contributor} (${size}): ${pullRequestUrl}`;
  const unsub = await api.tx.tips.reportAwesome(reason, address)
    .signAndSend(account, (result) => {
      console.log(`Current status is ${result.status}`);
      if (result.status.isInBlock) {
        console.log(`Tip included at blockHash ${result.status.asInBlock}`);
      } else if (result.status.isFinalized) {
        console.log(`Tip finalized at blockHash ${result.status.asFinalized}`);
        unsub();
      }
    });;

  return true;
}
