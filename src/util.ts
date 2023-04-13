import { Keyring, WsProvider } from "@polkadot/api";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import assert from "assert";

import { Contributor, ContributorAccount, OpenGovTrack, State, TipMetadata, TipNetwork, TipSize } from "./types";

const validTipSizes: { [key: string]: TipSize } = { small: "small", medium: "medium", large: "large" } as const;

export function getTipSize(tipSizeInput: string | undefined): TipSize {
  if (!tipSizeInput || !(tipSizeInput in validTipSizes)) {
    throw new Error(`Invalid tip size. Please specify one of ${Object.keys(validTipSizes).join(", ")}.`);
  }

  return validTipSizes[tipSizeInput];
}

export function tipSizeToOpenGovTrack(tipSize: TipSize): OpenGovTrack {
  if (tipSize === "small") return "SmallTipper";
  if (tipSize === "medium") return "BigTipper"; // Medium tip goes into Small or Big track?
  if (tipSize === "large") return "BigTipper";

  throw new Error(`Invalid tip size. Please specify one of ${Object.keys(validTipSizes).join(", ")}.`);
}

export function parseContributorAccount(pullRequestBody: string | null): ContributorAccount {
  const matches =
    typeof pullRequestBody === "string" &&
    pullRequestBody.match(
      // match "polkadot address: <ADDRESS>"
      /(\S+)\s*address:\s*([a-z0-9]+)/i,
    );

  if (matches === false || matches === null || matches.length != 3) {
    throw new Error(
      `Contributor did not properly post their account address.\n\nMake sure the pull request description has: "{network} address: {address}".`,
    );
  }

  const [matched, networkInput, address] = matches;
  assert(networkInput, `networkInput could not be parsed from "${matched}"`);
  assert(address, `address could not be parsed from "${matched}"`);

  const validNetworks: { [key: string]: TipNetwork } = {
    polkadot: "polkadot",
    kusama: "kusama",
    localtest: "localtest",
  };

  const network =
    networkInput.toLowerCase() in validNetworks
      ? validNetworks[networkInput.toLowerCase() as keyof typeof validNetworks]
      : undefined;
  if (!network) {
    throw new Error(
      `Invalid network: "${networkInput}". Please select one of: ${Object.keys(validNetworks).join(", ")}.`,
    );
  }

  return { network, address };
}

export async function getContributorMetadata(state: State, contributor: Contributor): Promise<TipMetadata> {
  await cryptoWaitReady();
  const { seedOfTipperAccount } = state;
  const keyring = new Keyring({ type: "sr25519" });
  const botTipAccount = keyring.addFromUri(seedOfTipperAccount);

  switch (contributor.account.network) {
    case "localtest": {
      return {
        provider: new WsProvider("ws://127.0.0.1:9944"),
        botTipAccount,
        tipUrl: "https://polkadot.js.org/apps/?rpc=ws%3A%2F%2F127.0.0.1%3A9944#/treasury/tips",
      };
    }
    case "polkadot": {
      return {
        provider: new WsProvider("wss://rpc.polkadot.io"),
        botTipAccount,
        tipUrl: "https://polkadot.js.org/apps/?rpc=wss%3A%2F%2Frpc.polkadot.io#/treasury/tips",
      };
    }
    case "kusama": {
      return {
        provider: new WsProvider(`wss://${contributor.account.network}-rpc.polkadot.io`),
        botTipAccount,
        tipUrl: `https://polkadot.js.org/apps/?rpc=wss%3A%2F%${contributor.account.network}-rpc.polkadot.io#/treasury/tips`,
      };
    }
    default: {
      const exhaustivenessCheck: never = contributor.account.network;
      throw new Error(
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        `Network is not handled properly in tipUser: ${exhaustivenessCheck}`,
      );
    }
  }
}
