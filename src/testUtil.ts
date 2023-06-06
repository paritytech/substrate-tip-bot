import { createTestKeyring } from "@polkadot/keyring";
import { randomAsU8a } from "@polkadot/util-crypto";

export const randomAddress = () => createTestKeyring().addFromSeed(randomAsU8a(32)).address;

export const logMock: any = console.log.bind(console); // eslint-disable-line @typescript-eslint/no-explicit-any
logMock.error = console.error.bind(console);
