import type { Router } from "express";
import promClient from "prom-client";

import { TipRequest, TipResult } from "./types";

const prefix = "tip_bot_";

promClient.register.setDefaultLabels({ team: "opstooling" });
promClient.collectDefaultMetrics({ prefix });

export const tipCounter = new promClient.Counter({
  name: `${prefix}tips_handled_total`,
  help: "Amount of all tips successfully proposed on-chain.",
  labelNames: ["network", "governance", "result"] as const,
});

export const recordTip = (opts: { tipRequest: TipRequest; tipResult: TipResult }): void => {
  const { tipRequest, tipResult } = opts;
  tipCounter.inc({
    network: tipRequest.contributor.account.network,
    governance: tipRequest.tip.type,
    result: tipResult.success ? "ok" : "fail",
  });
};

export const balanceGauge = new promClient.Gauge({
  name: `${prefix}balance`,
  help: "Balance of the tip bot account",
  labelNames: ["network"] as const,
});

export const addMetricsRoute = (router: Router): void => {
  router.get("/metrics", (req, res) => {
    promClient.register
      .metrics()
      .then((metrics) => {
        res.status(200);
        res.type("text/plain");
        res.send(metrics);
      })
      .catch((error) => {
        res.status(500);
        res.send(error.message);
      });
  });

  router.get("/health", (req, res) => {
    res.send("OK");
  });
};
