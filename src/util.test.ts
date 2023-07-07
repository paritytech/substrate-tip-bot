import "@polkadot/api-augment";

import { randomAddress } from "./testUtil";
import { parseContributorAccount } from "./util";

describe("Utility functions", () => {
  describe("parseContributorAccount", () => {
    test("Can parse the account", async () => {
      const address = randomAddress();
      const result = parseContributorAccount(`kusama address: ${address}`);
      expect(result.network).toEqual("kusama");
      expect(result.address).toEqual(address);
    });

    test("Throws when cannot parse", async () => {
      const address = randomAddress();
      expect(() => parseContributorAccount(`kusama: ${address}`)).toThrowError("Contributor did not properly post their account address");
    });

    test("Throws on invalid network", async () => {
      const address = randomAddress();
      expect(() => parseContributorAccount(`kussama address: ${address}`)).toThrowError("Invalid network");
    });
  });
});
