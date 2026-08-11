import express from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import { validateRequest } from "../../middlewares/validateRequest";
import { Role } from "../user/user.interface";
import { CourierSettingsControllers } from "./courierSettings.controller";
import {
  createCourierSettingsZodSchema,
  updateCourierSettingsZodSchema,
} from "./courierSettings.validation";

const router = express.Router();

router.post(
  "/create-courier-settings",
    checkAuth(Role.ADMIN, Role.MANAGER, Role.TELESALES, Role.MODERATOR),

  validateRequest(createCourierSettingsZodSchema),
  CourierSettingsControllers.createCourierSettings,
);

router.get(
  "/all-courier-settings",
   checkAuth(Role.ADMIN, Role.MANAGER, Role.TELESALES, Role.MODERATOR),
 
  CourierSettingsControllers.getAllCourierSettings,
);

router.get(
  "/provider/:provider",
    checkAuth(Role.ADMIN, Role.MANAGER, Role.TELESALES, Role.MODERATOR),
  
  CourierSettingsControllers.getCourierSettingsByProvider,
);

router.get(
  "/:id",
    checkAuth(Role.ADMIN, Role.MANAGER, Role.TELESALES, Role.MODERATOR),

  CourierSettingsControllers.getSingleCourierSettings,
);

router.patch(
  "/:id",
    checkAuth(Role.ADMIN, Role.MANAGER, Role.TELESALES, Role.MODERATOR),
  
  validateRequest(updateCourierSettingsZodSchema),
  CourierSettingsControllers.updateCourierSettings,
);

router.patch(
  "/:id/toggle-status",
   checkAuth(Role.ADMIN, Role.MANAGER, Role.TELESALES, Role.MODERATOR),
 
  CourierSettingsControllers.toggleCourierSettingsStatus,
);

router.delete(
  "/:id",
    checkAuth(Role.ADMIN, Role.MANAGER, Role.TELESALES, Role.MODERATOR),
  
  CourierSettingsControllers.deleteCourierSettings,
);

export const courierSettingsRoutes = router;