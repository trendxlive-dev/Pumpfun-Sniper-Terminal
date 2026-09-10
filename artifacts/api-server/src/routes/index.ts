import { Router, type IRouter } from "express";
import healthRouter from "./health";
import sniperRouter from "./sniper";

const router: IRouter = Router();

router.use(healthRouter);
router.use(sniperRouter);

export default router;
