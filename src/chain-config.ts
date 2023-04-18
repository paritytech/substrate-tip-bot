import { WsProvider } from "@polkadot/api";

import { ChainConfig, TipRequest } from "./types";

export function getChainConfig(tipRequest: TipRequest): ChainConfig {
  const {
    contributor,
    tip: { type },
  } = tipRequest;
  const tipUrlPath = type === "opengov" ? "referenda" : "treasury/tips";

  switch (contributor.account.network) {
    case "localtest": {
      return {
        provider: new WsProvider("ws://127.0.0.1:9944"),
        tipUrl: `https://polkadot.js.org/apps/?rpc=ws%3A%2F%2F127.0.0.1%3A9944#/${tipUrlPath}`,
      };
    }
    case "polkadot": {
      return {
        provider: new WsProvider("wss://rpc.polkadot.io"),
        tipUrl: "https://polkadot.js.org/apps/?rpc=wss%3A%2F%2Frpc.polkadot.io#/${tipUrlPath}",
      };
    }
    case "kusama": {
      return {
        provider: new WsProvider(`wss://${contributor.account.network}-rpc.polkadot.io`),
        tipUrl: `https://polkadot.js.org/apps/?rpc=wss%3A%2F%${contributor.account.network}-rpc.polkadot.io#/${tipUrlPath}`,
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
