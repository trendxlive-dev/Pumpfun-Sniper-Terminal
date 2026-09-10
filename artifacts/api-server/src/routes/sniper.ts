import { Router, type IRouter } from "express";
import {
  ArmSniperEngineBody,
  GetSniperConfigResponse,
  GetSniperMetricsResponse,
  GetSniperStatusResponse,
  ListSniperActivityQueryParams,
  ListSniperActivityResponse,
  ListSniperPositionsResponse,
  ListTokenCandidatesQueryParams,
  ListTokenCandidatesResponse,
  SellSniperPositionBody,
  SellSniperPositionParams,
  SellSniperPositionResponse,
  StopSniperEngineResponse,
  UpdateSniperConfigBody,
  UpdateSniperConfigResponse,
} from "@workspace/api-zod";
import { sniper } from "../lib/sniper";

const router: IRouter = Router();

router.get("/sniper/status", (_req, res) => {
  res.json(GetSniperStatusResponse.parse(sniper.getStatus()));
});

router.get("/sniper/candidates", (req, res) => {
  const filters = ListTokenCandidatesQueryParams.parse({
    ...req.query,
    requireSocials: req.query.requireSocials === "false" ? false : req.query.requireSocials,
  });
  res.json(
    ListTokenCandidatesResponse.parse(
      sniper.getCandidates({
        minMarketCap: filters.minMarketCap,
        maxMarketCap: filters.maxMarketCap,
        requireSocials: filters.requireSocials,
        minSocialScore: filters.minSocialScore,
        limit: filters.limit,
      }),
    ),
  );
});

router.get("/sniper/activity", (req, res) => {
  const { limit } = ListSniperActivityQueryParams.parse(req.query);
  res.json(ListSniperActivityResponse.parse(sniper.getActivities(limit)));
});

router.get("/sniper/positions", (_req, res) => {
  res.json(ListSniperPositionsResponse.parse(sniper.getPositions()));
});

router.get("/sniper/metrics", async (_req, res) => {
  res.json(GetSniperMetricsResponse.parse(await sniper.getMetrics()));
});

router.get("/sniper/config", (_req, res) => {
  res.json(GetSniperConfigResponse.parse(sniper.getConfig()));
});

router.put("/sniper/config", (req, res) => {
  const config = UpdateSniperConfigBody.parse(req.body);
  res.json(UpdateSniperConfigResponse.parse(sniper.updateConfig(config)));
});

router.post("/sniper/engine/start", async (req, res) => {
  try {
    const body = ArmSniperEngineBody.parse(req.body);
    res.json(
      GetSniperStatusResponse.parse(
        await sniper.arm(body.acknowledgeLiveTrading, body.acknowledgeRisk),
      ),
    );
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to arm live engine" });
  }
});

router.post("/sniper/engine/stop", (_req, res) => {
  res.json(StopSniperEngineResponse.parse(sniper.stop()));
});

router.post("/sniper/positions/:positionId/sell", async (req, res) => {
  try {
    const { positionId } = SellSniperPositionParams.parse(req.params);
    const { percentage } = SellSniperPositionBody.parse(req.body);
    res.json(SellSniperPositionResponse.parse(await sniper.sellPosition(positionId, percentage)));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to sell position" });
  }
});

export default router;