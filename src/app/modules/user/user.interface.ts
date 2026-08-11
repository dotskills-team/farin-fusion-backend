import { Types } from "mongoose";

export enum Role {
  ADMIN = "ADMIN",
  MANAGER = "MANAGER",
  MODERATOR = "MODERATOR",
  TELESALES = "TELESALES",
  CUSTOMER = "CUSTOMER",
  GENERALSTAFF = "GENERALSTAFF",
}

export enum IsActive {
  ACTIVE = "ACTIVE",
  INACTIVE = "INACTIVE",
  BLOCKED = "BLOCKED",
}

export interface IUser {
  _id?: Types.ObjectId;
  createdBy: Types.ObjectId;
  name: string;
  email: string;
  password?: string;
  phone?: string;
  address: string;
  picture?: string;
  isActive?: IsActive;
  permissions?: Types.ObjectId[];
  isVerified?: boolean;
  isDeleted?: boolean;
  salary?: number;
  commissionSalary?: number;
  role: Role;
}
