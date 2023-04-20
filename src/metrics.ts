import type { Router } from "express";
import promClient from "prom-client";

export const tipCounter = new promClient.Counter({
  name: "tip_bot_tips_handled_total",
  help: "Amount of all tips successfully proposed on-chain.",
  labelNames: ["chain", "repo", "pr"] as const,
});

promClient.collectDefaultMetrics({ prefix: "tip_bot_" });

export const addMetrics = (router: Router): void => {
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
};
