import express from "express";
import { CourierControllers } from "./courier.controller";
import { checkAuth } from "../../middlewares/checkAuth";
import { Role } from "../user/user.interface";
import { validateRequest } from "../../middlewares/validateRequest";
import {
  createCourierZodSchema,
  trackCourierZodSchema,
} from "./courier.validation";
import { PathaoProvider } from "./providers/pathao.provider";

const router = express.Router();

router.post(
  "/create",
  checkAuth(Role.ADMIN, Role.MANAGER, Role.TELESALES),
  validateRequest(createCourierZodSchema),
  CourierControllers.createCourier,
);

router.get("/pathao/cities", async (req, res) => {
  const result = await PathaoProvider.getCities();
  res.json(result);
});

router.get(
  "/track/:trackingCode",
  checkAuth(...Object.values(Role)),
  validateRequest(trackCourierZodSchema),
  CourierControllers.trackCourier,
);

router.get(
  "/",
  checkAuth(Role.ADMIN, Role.MANAGER, Role.TELESALES, Role.MODERATOR),
  CourierControllers.getAllCouriers,
);

router.get(
  "/:id",
  checkAuth(...Object.values(Role)),
  CourierControllers.getSingleCourier,
);

router.get(
  "/order/:orderId",
  checkAuth(...Object.values(Role)),
  CourierControllers.getCourierByOrderId,
);

export const courierRoutes = router;
