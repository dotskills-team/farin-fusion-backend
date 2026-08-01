import express from "express";
import { OrderControllers, partialUpdateOrder } from "./order.controller";
import { checkAuth } from "../../middlewares/checkAuth";
import { Role } from "../user/user.interface";

const router = express.Router();

router.post(
  "/",
  // checkAuth(
  //   Role.CUSTOMER,
  //   Role.MODERATOR,
  //   Role.MANAGER,
  //   Role.ADMIN,
  //   Role.TELLICELSS,
  // ),
  OrderControllers.createOrder,
);

router.get(
  "/waiting-stock",
  checkAuth(
    Role.CUSTOMER,
    Role.MODERATOR,
    Role.MANAGER,
    Role.ADMIN,
    Role.TELLICELSS,
  ),
  OrderControllers.getAllWaitingStockOrders,
);

router.get(
  "/my-orders",
  checkAuth(
    Role.CUSTOMER,
    Role.MODERATOR,
    Role.MANAGER,
    Role.ADMIN,
    Role.TELLICELSS,
  ),
  OrderControllers.getMyOrders,
);

router.get(
  "/damaged-products",
  checkAuth(Role.ADMIN, Role.MANAGER),
  OrderControllers.getAllDamagedProducts,
);

router.get(
  "/",
  checkAuth(Role.ADMIN, Role.MANAGER, Role.TELLICELSS, Role.MODERATOR),
  OrderControllers.getAllOrders,
);

router.get(
  "/trash",
  checkAuth(Role.ADMIN, Role.MANAGER),
  OrderControllers.getAllTrashOrders,
);

router.get(
  "/scheduled-orders",
  checkAuth(Role.ADMIN, Role.MANAGER, Role.TELLICELSS),
  OrderControllers.getAllScheduledOrders,
);

router.get(
  "/hold-orders",
  checkAuth(Role.ADMIN, Role.MANAGER, Role.TELLICELSS),
  OrderControllers.getAllHoldOrders,
);

router.get(
  "/no-response",
  checkAuth(Role.ADMIN, Role.MANAGER, Role.TELLICELSS),
  OrderControllers.getAllNoResponseOrders,
);

router.get(
  "/my-scheduled-orders",
  checkAuth(...Object.values(Role)),
  OrderControllers.getMyScheduledOrders,
);

router.get(
  "/my-hold-orders",
  checkAuth(...Object.values(Role)),
  OrderControllers.getMyHoldOrders,
);

router.get(
  "/check-phone",
  checkAuth(...Object.values(Role)),
  OrderControllers.getCustomerOrder,
);

router.get(
  "/:id",
  checkAuth(...Object.values(Role)),
  OrderControllers.getSingleOrder,
);

router.patch("/:id", OrderControllers.updateOrder);

router.patch(
  "/:id/no-response",
  checkAuth(Role.ADMIN, Role.MANAGER, Role.TELLICELSS),
  OrderControllers.markNoResponse,
);

router.patch(
  "/:id/restore-no-response",
  checkAuth(Role.ADMIN, Role.MANAGER, Role.MODERATOR, Role.TELLICELSS),
  OrderControllers.restoreNoResponseOrder,
);

router.patch(
  "/manual-delivery-status/:id",
  checkAuth(Role.ADMIN, Role.MANAGER, Role.TELLICELSS),
  OrderControllers.updateManualDeliveryStatus,
);

router.patch(
  "/:id/assign-seller",
  checkAuth(Role.ADMIN, Role.MANAGER, Role.TELLICELSS),
  OrderControllers.assignSeller,
);

router.patch(
  "/:id/confirm-status",
  checkAuth(Role.ADMIN, Role.MANAGER, Role.TELLICELSS),
  OrderControllers.updateOrderStatus,
);

router.patch(
  "/:id/status",
  checkAuth(Role.ADMIN, Role.MANAGER, Role.TELLICELSS),
  OrderControllers.updateCompleteOrder,
);
router.patch(
  "/:id/cancel-status",
  checkAuth(Role.ADMIN, Role.MANAGER, Role.TELLICELSS),
  OrderControllers.updateOrderCancelStatus,
);

router.post("/exchange", OrderControllers.exchangeOrderItem);

router.post("/damage", OrderControllers.markOrderDamage);
router.post("/partial-update", OrderControllers.partialUpdateOrder);

router.delete("/:id", checkAuth(Role.ADMIN), OrderControllers.deleteOrder);

export const orderRoutes = router;
