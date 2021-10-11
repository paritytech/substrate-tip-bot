/**
 * This is the main entrypoint to your Probot app
 * @param {import('probot').Probot} app
 */
module.exports = (app) => {
  // Your code here
  app.log.info('Tip bot was loaded!');

  app.on('issue_comment', async (context) => {
    // Get all the relevant contextual information.
    let commentText = context.payload.comment.body;
    let pullRequestBody = context.payload.issue.body;
    let pullRequestUrl = context.payload.issue.html_url;
    let tipper = context.payload.comment.user.login;
    let contributor = context.payload.issue.user.login;
    let pullRequestNumber = context.payload.issue.number;
    let pullRequestRepo = context.payload.repository.name;

    // The bot only triggers on creation of a new comment on a pull request.
    if (
      !Object.prototype.hasOwnProperty.call(
        context.payload.issue,
        'pull_request'
      ) ||
      context.payload.action !== 'created' ||
      !commentText.startsWith('/tip')
    ) {
      return;
    }

    // Any problems along the way will be stored here, and used to return an error if needed.
    let problemsText = [];

    if (tipper === contributor) {
      // todo undo
      //problemsText.push(`Contributor and tipper cannot be the same person!`)
    }

    // TODO check contributor is NOT member of parity org (or better, not a member of the org where the repo lives)
    // if (contributor is in github org) {
    //   problemsText.push(`Contributor can't be a member of Parity!`)
    // }

    // TODO temporarily, only allow whitelisted users access to the bot.
    if (!process.env.ALLOWED_USERS.includes(tipper)) {
      problemsText.push(
        `You are not allowed to access the tip bot. Only ${process.env.ALLOWED_USERS} are allowed.`
      );
    }

    // We will populate this information by processing the pull request and tip comment.
    let network, address, size;

    // match "polkadot address: <ADDRESS>"
    let addressRegex = /(polkadot|kusama|localtest) address:\s?([a-z0-9]+)/i;
    let maybeMatch = pullRequestBody.match(addressRegex);
    if (!maybeMatch || maybeMatch.length != 3) {
      problemsText.push(
        `Contributor did not properly post their Polkadot or Kusama address. Make sure the pull request has: "{network} address: {address}".`
      );
    } else {
      network = maybeMatch[1].toLowerCase();
      if (!['polkadot', 'kusama', 'localtest'].includes(network)) {
        problemsText.push(
          `Invalid network: ${maybeMatch[1]}. Please select "polkadot" or "kusama".`
        );
      }
      address = maybeMatch[2];
    }

    // Tip initiation comment should be: "/tip { small / medium / large }"
    let textParts = commentText.split(' ');
    if (textParts.length !== 2) {
      problemsText.push(
        `Invalid command! Payload should be: "/tip { small / medium / large }".`
      );
    } else {
      // We already match `/tip` at the top of this program, so just check size.
      size = textParts[1].toLowerCase();
      if (size == 's') {
        size = 'small';
      } else if (size == 'm') {
        size = 'medium';
      } else if (size == 'l') {
        size = 'large';
      }
      if (!['small', 'medium', 'large'].includes(size)) {
        problemsText.push(
          `Invalid tip size. Please specify one of small, medium, or large.`
        );
      }
    }

    if (problemsText.length > 0) {
      // there was some error to get to this point, lets list them.
      let comment =
        'Please fix the following problems before calling the tip bot again:';
      for (const problem of problemsText) {
        comment += `\n * ${problem}`;
      }
      postComment(context, comment);
    } else {
      console.log(
        `Valid command! \n ${tipper} wants to tip ${contributor} (${address} on ${network}) a ${size} tip for pull request ${pullRequestUrl}.`
      );
      // Send the transaction to the network.
      let result = await tipUser(
        address,
        contributor,
        network,
        pullRequestNumber,
        pullRequestRepo,
        size
      );
      // TODO actually check for problems with submitting the tip. Maybe even query storage to ensure the tip is there.
      if (result) {
        postComment(
          context,
          `A ${size} tip was successfully submitted for ${contributor} (${address} on ${network}). \n\n https://polkadot.js.org/apps/#/treasury/tips`
        );
      } else {
        postComment(
          context,
          `Could not submit tip :( Notify someone at Parity.`
        );
      }
    }
    return;
  });
};

// Simple helper function to post a comment on github.
function postComment(context, body) {
  const issueComment = context.issue({
    body: body,
  });
  return context.octokit.issues.createComment(issueComment);
}

var { ApiPromise, WsProvider, Keyring } = require('@polkadot/api');
var { cryptoWaitReady } = require('@polkadot/util-crypto');

// TODO add some kind of timeout then return an error
async function tipUser(
  address,
  contributor,
  network,
  pullRequestNumber,
  pullRequestRepo,
  size
) {
  await cryptoWaitReady();
  const keyring = new Keyring({ type: 'sr25519' });

  // Connect to the appropriate network.
  let provider, account;
  if (network == 'localtest') {
    provider = new WsProvider('ws://localhost:9944');
    account = keyring.addFromUri('//Alice', { name: 'Alice default' });
  } else if (network == 'polkadot') {
    provider = new WsProvider('wss://rpc.polkadot.io/');
    account = keyring.addFromUri(process.env.ACCOUNT_SEED);
  } else if (network == 'kusama') {
    provider = new WsProvider('wss://kusama-rpc.polkadot.io/');
    account = keyring.addFromUri(process.env.ACCOUNT_SEED);
  } else {
    return;
  }

  const api = await ApiPromise.create({ provider });

  // Get general information about the node we are connected to
  const [chain, nodeName, nodeVersion] = await Promise.all([
    api.rpc.system.chain(),
    api.rpc.system.name(),
    api.rpc.system.version(),
  ]);
  console.log(
    `You are connected to chain ${chain} using ${nodeName} v${nodeVersion}`
  );

  let reason = `TO: ${contributor} FOR: ${pullRequestRepo}#${pullRequestNumber} (${size})`;
  // TODO before submitting, check tip does not already exist via a storage query.
  // TODO potentially prevent duplicates by also checking for reasons with the other sizes.
  const unsub = await api.tx.tips
    .reportAwesome(reason, address)
    .signAndSend(account, (result) => {
      console.log(`Current status is ${result.status}`);
      if (result.status.isInBlock) {
        console.log(`Tip included at blockHash ${result.status.asInBlock}`);
      } else if (result.status.isFinalized) {
        console.log(`Tip finalized at blockHash ${result.status.asFinalized}`);
        unsub();
      }
    });

  return true;
}
