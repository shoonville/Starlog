import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import demoRouter from "./demo";
import skyRouter from "./sky";
import starsRouter from "./stars";
import labelsRouter from "./labels";
import connectionsRouter from "./connections";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(demoRouter);
router.use(skyRouter);
router.use(starsRouter);
router.use(labelsRouter);
router.use(connectionsRouter);

export default router;
