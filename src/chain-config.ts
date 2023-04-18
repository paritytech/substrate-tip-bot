import { ChainConfig, TipRequest } from "./types";

type Constants = Omit<ChainConfig, "providerEndpoint" | "tipUrl">;
const kusamaConstants: Constants = {
  decimals: 12,

  /**
   * Source of the calculation:
   * https://github.com/paritytech/polkadot/blob/e164da65873f11bf8c583e81f6d82c21b005cfe4/runtime/kusama/src/governance/origins.rs#L172
   * https://github.com/paritytech/polkadot/blob/e164da65873f11bf8c583e81f6d82c21b005cfe4/runtime/kusama/constants/src/lib.rs#L29
   */
  smallTipperMaximum: 8.33,

  /**
   * Source of the calculation:
   * https://github.com/paritytech/polkadot/blob/e164da65873f11bf8c583e81f6d82c21b005cfe4/runtime/kusama/src/governance/origins.rs#L173
   * https://github.com/paritytech/polkadot/blob/e164da65873f11bf8c583e81f6d82c21b005cfe4/runtime/kusama/constants/src/lib.rs#L31
   */
  bigTipperMaximum: 33.33,

  /**
   * These are arbitrary values.
   * We can change them, and/or allow the user to input values by hand.
   */
  namedTips: { small: 2, medium: 5, large: 8 },
};

const polkadotConstants: Constants = {
  decimals: 10,

  /**
   * Source of the calculation:
   * https://github.com/paritytech/polkadot/blob/e164da65873f11bf8c583e81f6d82c21b005cfe4/runtime/polkadot/src/governance/origins.rs#L143
   * https://github.com/paritytech/polkadot/blob/e164da65873f11bf8c583e81f6d82c21b005cfe4/runtime/polkadot/constants/src/lib.rs#L31
   */
  smallTipperMaximum: 250,

  /**
   * Source of the calculation:
   * https://github.com/paritytech/polkadot/blob/e164da65873f11bf8c583e81f6d82c21b005cfe4/runtime/polkadot/src/governance/origins.rs#L144
   * https://github.com/paritytech/polkadot/blob/e164da65873f11bf8c583e81f6d82c21b005cfe4/runtime/polkadot/constants/src/lib.rs#L32
   */
  bigTipperMaximum: 1000,

  /**
   * These are arbitrary values.
   * We can change them, and/or allow the user to input values by hand.
   */
  namedTips: { small: 20, medium: 80, large: 150 },
};

export function getChainConfig(tipRequest: TipRequest): ChainConfig {
  const {
    contributor,
    tip: { type },
  } = tipRequest;
  const tipUrlPath = type === "opengov" ? "referenda" : "treasury/tips";

  switch (contributor.account.network) {
    case "localkusama": {
      return {
        providerEndpoint: "ws://127.0.0.1:9944",
        tipUrl: `https://polkadot.js.org/apps/?rpc=ws%3A%2F%2F127.0.0.1%3A9944#/${tipUrlPath}`,
        ...kusamaConstants,
      };
    }
    case "localpolkadot": {
      return {
        providerEndpoint: "ws://127.0.0.1:9944",
        tipUrl: `https://polkadot.js.org/apps/?rpc=ws%3A%2F%2F127.0.0.1%3A9944#/${tipUrlPath}`,
        ...polkadotConstants,
      };
    }
    case "polkadot": {
      return {
        providerEndpoint: "wss://rpc.polkadot.io",
        tipUrl: "https://polkadot.js.org/apps/?rpc=wss%3A%2F%2Frpc.polkadot.io#/${tipUrlPath}",
        ...polkadotConstants,
      };
    }
    case "kusama": {
      return {
        providerEndpoint: `wss://${contributor.account.network}-rpc.polkadot.io`,
        tipUrl: `https://polkadot.js.org/apps/?rpc=wss%3A%2F%${contributor.account.network}-rpc.polkadot.io#/${tipUrlPath}`,
        ...kusamaConstants,
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
