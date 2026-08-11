import express from "express";
import { UserControllers } from "./user.controller";
import { validateRequest } from "../../middlewares/validateRequest";
import { createUserZodSchema, updateUserZodSchema } from "./user.validation";
import { checkAuth } from "../../middlewares/checkAuth";
import { Role } from "./user.interface";
import { multerUpload } from "../../config/multer.config";
const router = express.Router();

router.post(
  "/create-user",
  multerUpload.single("picture"),
  validateRequest(createUserZodSchema),
  UserControllers.createUser,
);
router.get("/me", checkAuth(...Object.values(Role)), UserControllers.getMe);
router.patch(
  "/update-profile",
  checkAuth(...Object.values(Role)),
  multerUpload.single("picture"),
  validateRequest(updateUserZodSchema),
  UserControllers.updateProfile,
);
router.get(
  "/all-users",
  checkAuth(Role.ADMIN, Role.MANAGER, Role.TELESALES),
  UserControllers.getAllUsers,
);
router.get(
  "/all-trash-users",
  checkAuth(Role.ADMIN),
  UserControllers.getAllTrashUsers,
);
router.get(
  "/all-customers",
  checkAuth(Role.ADMIN, Role.MANAGER, Role.TELESALES),
  UserControllers.getAllCustomers,
);

router.get(
  "/my-customers",
  checkAuth(Role.ADMIN, Role.MANAGER, Role.MODERATOR, Role.TELESALES),
  UserControllers.getMyCustomers,
);

router.get(
  "/all-trash-customers",
  checkAuth(Role.ADMIN, Role.MANAGER, Role.TELESALES),
  UserControllers.getAllTrashCustomers,
);
router.get(
  "/:id",
  checkAuth(...Object.values(Role)),
  UserControllers.getSingleUser,
);
router.patch(
  "/:id",
  multerUpload.single("file"),
  // validateRequest(updateUserZodSchema),
  checkAuth(...Object.values(Role)),
  UserControllers.updateUser,
);
router.delete("/:id", checkAuth(Role.ADMIN), UserControllers.deleteUser);

router.post(
  "/user-trash/:id",
  checkAuth(Role.ADMIN),
  UserControllers.updateUserTrash,
);
router.post(
  "/customer-trash/:id",
  checkAuth(Role.ADMIN, Role.MANAGER, Role.TELESALES),
  UserControllers.updateCustomerTrash,
);

export const userRoutes = router;
