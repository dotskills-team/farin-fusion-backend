import { model, Schema } from "mongoose";
import { IsActive, IUser, Role } from "./user.interface";

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, index: true },
    password: { type: String, required: true },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    permissions: {
      type: [String],
      enum: [
        "dashboard",
        "my-orders",
        "analytics",
        "product-stock-adjustment",
        "user-management",
        "returns",
        "reviews-management",
        "product-verifications",
        "blogs",
        "courier-settings",
        "staff-management",
        "product-management",
        "purchase-products",
        "category-management",
        "brand-management",
        "inventory",
        "promotions",
        "reports",
        "settings",
        "profile",
        "coupons",
        "customer-management",
        "my-customers",
        "orders-management",
        "leads",
        "pos",
      ],
      default: [],
    },
    role: {
      type: String,
      enum: Object.values(Role),
      default: Role.CUSTOMER,
    },
    phone: { type: String },
    address: { type: String, required: true },
    picture: { type: String },
    isDeleted: { type: Boolean, default: false },
    isActive: {
      type: String,
      enum: Object.values(IsActive),
      default: IsActive.ACTIVE,
    },
    isVerified: { type: Boolean, default: false },
    salary: { type: Number },
    commissionSalary: { type: Number },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

export const User = model<IUser>("User", userSchema);
