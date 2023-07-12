import { envVar } from "@eng-automation/js";
import { ApplicationFunction, run } from "probot";

import { botInitialize } from "./bot-initialize";

if (process.env.PRIVATE_KEY_BASE64 && !process.env.PRIVATE_KEY) {
  process.env.PRIVATE_KEY = Buffer.from(envVar("PRIVATE_KEY_BASE64"), "base64").toString();
}

// Aligning environment between Probot and @eng-automation/integrations
process.env.GITHUB_APP_ID = process.env.APP_ID;
process.env.GITHUB_AUTH_TYPE = "app";
process.env.GITHUB_PRIVATE_KEY = process.env.PRIVATE_KEY;

/* Probot types do not accept async function type,
   but it seems that the actual code handles it properly. */
void run(botInitialize as ApplicationFunction);
