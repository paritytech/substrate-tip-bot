import "@polkadot/api-augment";
import { createTestKeyring } from "@polkadot/keyring";
import { ApiPromise } from "@polkadot/api";
import { HttpProvider } from "@polkadot/rpc-provider";
import { BN } from "@polkadot/util";
import { randomAsU8a } from "@polkadot/util-crypto";
import { until } from "opstooling-js";
import assert from "assert";

const tipperAccount = "14E5nqKAp3oAJcmzgZhUD2RcptBeUBScxKHgJKU4HPNcKVf3" //Bob

const randomAddress = () => createTestKeyring().addFromSeed(randomAsU8a(32)).address;

describe("tip", () => {
  const polkadotApi = new ApiPromise({
    provider: new HttpProvider("http://localhost:9933"),
    types: { Address: "AccountId", LookupSource: "AccountId" },
  });

  const getUserBalance = async (userAddress: string) => {
    console.log('here2')
    const { data } = await polkadotApi.query.system.account(userAddress);
    return data.free.toBn();
  };

  beforeAll(async () => {
    await polkadotApi.isReady;
    console.log('here1')
  })

  test('read initial tipper balance', async () => {
    const balance = await getUserBalance(tipperAccount)
    assert(balance.gtn(0))
  })
});
