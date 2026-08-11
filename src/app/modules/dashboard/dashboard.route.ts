import express from "express";
import { DashboardController } from "./dashboard.controller";
import { checkAuth } from "../../middlewares/checkAuth";
import { Role } from "../user/user.interface";
import { validateRequest } from "../../middlewares/validateRequest";
import { dashboardQuerySchema } from "./dashboard.validation";

const router = express.Router();

router.get(
  "/overview",
  checkAuth(
    Role.ADMIN,
    Role.MANAGER,
    Role.MODERATOR,
    Role.CUSTOMER,
    Role.TELESALES,
    Role.GENERALSTAFF
  ),
//   validateRequest(dashboardQuerySchema),
  DashboardController.getOverview
);

export const dashboardRoutes = router;