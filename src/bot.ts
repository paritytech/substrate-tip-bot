import { HandlerFunction } from "@octokit/webhooks/dist-types/types"
import { ApiPromise, Keyring, WsProvider } from "@polkadot/api"
import { cryptoWaitReady } from "@polkadot/util-crypto"
import assert from "assert"
import { displayError, envVar } from "opstooling-js"
import { Probot, run } from "probot"

import { State } from "./types"

/* TODO add some kind of timeout then return an error
   TODO Unit tests */
const tipUser = async (
  { seedOfTipperAccount, bot }: State,
  {
    contributor,
    pullRequestNumber,
    pullRequestRepo,
    tipSize,
  }: {
    contributor: {
      githubUsername: string
      account: {
        address: string
        network: "localtest" | "kusama" | "polkadot"
      }
    }
    pullRequestNumber: number
    pullRequestRepo: string
    tipSize: string
  },
) => {
  await cryptoWaitReady()
  const keyring = new Keyring({ type: "sr25519" })

  const { provider, botTipAccount } = (() => {
    switch (contributor.account.network) {
      case "localtest": {
        return {
          provider: new WsProvider("ws://localhost:9944"),
          botTipAccount: keyring.addFromUri("//Alice", {
            name: "Alice default",
          }),
        }
      }
      case "polkadot": {
        return {
          provider: new WsProvider("wss://rpc.polkadot.io/"),
          botTipAccount: keyring.addFromUri(seedOfTipperAccount),
        }
      }
      case "kusama": {
        return {
          provider: new WsProvider("wss://kusama-rpc.polkadot.io/"),
          botTipAccount: keyring.addFromUri(seedOfTipperAccount),
        }
      }
      default: {
        const exhaustivenessCheck: never = contributor.account.network
        throw new Error(
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
          `Network is not handled properly in tipUser: ${exhaustivenessCheck}`,
        )
      }
    }
  })()

  const api = await ApiPromise.create({ provider })

  // Get general information about the node we are connected to
  const [chain, nodeName, nodeVersion] = await Promise.all([
    api.rpc.system.chain(),
    api.rpc.system.name(),
    api.rpc.system.version(),
  ])
  bot.log(
    `You are connected to chain ${chain.toString()} using ${nodeName.toString()} v${nodeVersion.toString()}`,
  )

  const reason = `TO: ${contributor.githubUsername} FOR: ${pullRequestRepo}#${pullRequestNumber} (${tipSize})`
  /* TODO before submitting, check tip does not already exist via a storage query.
     TODO potentially prevent duplicates by also checking for reasons with the other sizes. */
  const unsub = await api.tx.tips
    .reportAwesome(reason, botTipAccount)
    .signAndSend(botTipAccount, (result) => {
      bot.log(`Current status is ${result.status.toString()}`)
      if (result.status.isInBlock) {
        bot.log(
          `Tip included at blockHash ${result.status.asInBlock.toString()}`,
        )
      } else if (result.status.isFinalized) {
        bot.log(
          `Tip finalized at blockHash ${result.status.asFinalized.toString()}`,
        )
        unsub()
      }
    })

  return true
}

const onIssueComment = async (
  state: State,
  context: Parameters<HandlerFunction<"issue_comment.created", unknown>>[0],
  tipRequester: string,
) => {
  const { allowedTipRequesters, bot } = state

  const commentText = context.payload.comment.body
  const pullRequestBody = context.payload.issue.body
  const pullRequestUrl = context.payload.issue.html_url
  const contributor = context.payload.issue.user.login
  const pullRequestNumber = context.payload.issue.number
  const pullRequestRepo = context.payload.repository.name

  const [botMention, tipSizeInput] = commentText.split(" ") as (
    | string
    | undefined
  )[]

  // The bot only triggers on creation of a new comment on a pull request.
  if (
    !Object.prototype.hasOwnProperty.call(
      context.payload.issue,
      "pull_request",
    ) ||
    context.payload.action !== "created" ||
    !botMention?.startsWith("/tip")
  ) {
    return
  }

  if (tipRequester === contributor) {
    return "Contributor and tipper cannot be the same person!"
  }

  if (!allowedTipRequesters.includes(tipRequester)) {
    return `You are not allowed to request a tip. Only ${allowedTipRequesters.join(
      ", ",
    )} are allowed.`
  }

  const contributorAccount = (() => {
    const matches = pullRequestBody.match(
      // match "polkadot address: <ADDRESS>"
      /(polkadot|kusama|localtest)\s*address:\s*([a-z0-9]+)/i,
    )
    if (!matches || matches.length != 3) {
      throw new Error(
        `Contributor did not properly post their Polkadot or Kusama address. \n\n Make sure the pull request description has: "{network} address: {address}".`,
      )
    }

    const [matched, networkInput, address] = matches
    assert(networkInput, `networkInput could not be parsed from "${matched}"`)
    assert(address, `address could not be parsed from "${matched}"`)

    const validNetworks = {
      polkadot: "polkadot",
      kusama: "kusama",
      localtest: "localtest",
    } as const

    const validNetwork =
      networkInput in validNetworks
        ? validNetworks[networkInput as keyof typeof validNetworks]
        : undefined
    if (!validNetwork) {
      throw new Error(
        `Invalid network: "${networkInput}". Please select one of: ${Object.keys(
          validNetworks,
        ).join(", ")}.`,
      )
    }

    return { network: validNetwork, address }
  })()

  const tipSize = (() => {
    const validTipSizes = {
      small: "small",
      medium: "medium",
      large: "large",
    } as const

    const validTipSize =
      tipSizeInput && tipSizeInput in validTipSizes
        ? validTipSizes[tipSizeInput as keyof typeof validTipSizes]
        : undefined
    if (!validTipSize) {
      throw new Error(
        `Invalid tip size. Please specify one of ${Object.keys(
          validTipSizes,
        ).join(", ")}.`,
      )
    }

    return validTipSize
  })()

  bot.log(
    `Valid command!\n${tipRequester} wants to tip ${contributor} (${contributorAccount.address} on ${contributorAccount.network}) a ${tipSize} tip for pull request ${pullRequestUrl}.`,
  )

  const result = await tipUser(state, {
    contributor: { githubUsername: contributor, account: contributorAccount },
    pullRequestNumber,
    pullRequestRepo,
    tipSize,
  })

  const tipUrl = (() => {
    switch (contributorAccount.network) {
      case "polkadot": {
        return "https://polkadot.js.org/apps/?rpc=wss%3A%2F%2Frpc.polkadot.io#/treasury/tips"
      }
      case "kusama": {
        return "https://polkadot.js.org/apps/?rpc=wss%3A%2F%2Fkusama-rpc.polkadot.io#/treasury/tips"
      }
      default: {
        return "https://polkadot.js.org/apps/#/treasury/tips"
      }
    }
  })()

  // TODO actually check for problems with submitting the tip. Maybe even query storage to ensure the tip is there.
  return result
    ? `A ${tipSize} tip was successfully submitted for ${contributor} (${contributorAccount.address} on ${contributorAccount.network}). \n\n ${tipUrl}`
    : "Could not submit tip :( Notify someone at Parity."
}

const main = (bot: Probot) => {
  const allowedTipRequesters = JSON.parse(envVar("ALLOWED_USERS")) as unknown[]
  if (!Array.isArray(allowedTipRequesters)) {
    throw new Error("$ALLOWED_USERS needs to be an array")
  }

  const seedOfTipperAccount = envVar("ACCOUNT_SEED")

  const state = { allowedTipRequesters, seedOfTipperAccount, bot }
  bot.log.info("State", state)

  bot.log.info("Tip bot was loaded!")

  bot.on("issue_comment", (context) => {
    const tipRequester = context.payload.comment.user.login

    const onIssueCommentResult = async (result: string | Error | undefined) => {
      if (result === undefined) {
        return
      }
      await context.octokit.issues.createComment({
        owner: context.payload.repository.owner.login,
        repo: context.payload.repository.name,
        issue_number: context.payload.issue.number,
        body: `@${tipRequester} ${
          result instanceof Error ? `ERROR: ${displayError(result)}` : result
        }`,
      })
    }

    void onIssueComment(state, context, tipRequester)
      .then(onIssueCommentResult)
      .catch(onIssueCommentResult)
  })
}

void run(main)
