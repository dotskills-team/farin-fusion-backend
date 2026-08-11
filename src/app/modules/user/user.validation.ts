import { z } from "zod";
import { IsActive, Role } from "./user.interface";

export const createUserZodSchema = z.object({
  name: z
    .string({ invalid_type_error: "Name must be string" })
    .min(2, { message: "Name must be at least 2 characters long." })
    .max(50, { message: "Name cannot exceed 50 characters." }),
  email: z
    .string({ invalid_type_error: "Email must be string" })
    .email({ message: "Invalid email address format." })
    .min(5, { message: "Email must be at least 5 characters long." })
    .max(100, { message: "Email cannot exceed 100 characters." }),
  password: z
    .string({ invalid_type_error: "Password must be string" })
    .min(8, { message: "Password must be at least 8 characters long." }),
  // .regex(/^(?=.*[A-Z])/, {
  //     message: "Password must contain at least 1 uppercase letter.",
  // })
  // .regex(/^(?=.*[!@#$%^&*])/, {
  //     message: "Password must contain at least 1 special character.",
  // })
  // .regex(/^(?=.*\d)/, {
  //     message: "Password must contain at least 1 number.",
  // })
  phone: z
    .string({ invalid_type_error: "Phone Number must be string" })
    .regex(/^(?:\+880|0)[1-9]\d{7,9}$/, {
      message:
        "Phone number must be valid for Bangladesh. Format: +88XXXXXXXXX or 0XXXXXXXXX",
    })
    .optional(),
  salary: z.coerce
    .number({ invalid_type_error: "Salary must be a number" })
    .min(0, { message: "Salary cannot be negative" })
    .optional(),
  commissionSalary: z.coerce
    .number({ invalid_type_error: "Salary must be a number" })
    .min(0, { message: "Salary cannot be negative" })
    .optional(),
  address: z
    .string({ invalid_type_error: "Address must be string" })
    .min(2, { message: "Address must be at least 2 characters long." })
    .max(100, { message: "Address cannot exceed 100 characters." }),
  role: z
    .enum(
      [
        Role.ADMIN,
        Role.CUSTOMER,
        Role.MANAGER,
        Role.MODERATOR,
        Role.TELESALES,
        Role.GENERALSTAFF,
      ],
      {
        invalid_type_error:
          "Role must be either ADMIN, CUSTOMER, MANAGER, TELESALES, GENERAL STAFF or MODERATOR",
      },
    )
    .optional(),
});

export const updateUserZodSchema = z.object({
  name: z
    .string({ invalid_type_error: "Name must be string" })
    .min(2, { message: "Name must be at least 2 characters long." })
    .max(50, { message: "Name cannot exceed 50 characters." })
    .optional(),
  phone: z
    .string({ invalid_type_error: "Phone Number must be string" })
    .regex(/^(?:\+880|0)[1-9]\d{7,9}$/, {
      message:
        "Phone number must be valid for Bangladesh. Format: +88XXXXXXXXX or 0XXXXXXXXX",
    })
    .optional(),
  permissions: z.array(z.string()).optional(),
  role: z
    .enum(
      [
        Role.ADMIN,
        Role.CUSTOMER,
        Role.MANAGER,
        Role.MODERATOR,
        Role.TELESALES,
        Role.GENERALSTAFF,
      ],
      {
        invalid_type_error:
          "Role must be either ADMIN, CUSTOMER, MANAGER, TELESALES, GENERAL STAFF or MODERATOR",
      },
    )
    .optional(),
  isActive: z.enum(Object.values(IsActive) as [string]).optional(),
  isDeleted: z
    .boolean({ invalid_type_error: "isDeleted must be true or false" })
    .optional(),
  isVerified: z
    .boolean({ invalid_type_error: "isVerified must be true or false" })
    .optional(),
  password: z
    .string({ invalid_type_error: "Password must be string" })
    .min(8, { message: "Password must be at least 8 characters long." })
    .optional(),
  picture: z
    .string({ invalid_type_error: "Picture must be string" })
    .optional(),
  salary: z.coerce
    .number({ invalid_type_error: "Salary must be a number" })
    .min(0, { message: "Salary cannot be negative" })
    .optional(),
  commissionSalary: z.coerce
    .number({ invalid_type_error: "Salary must be a number" })
    .min(0, { message: "Salary cannot be negative" })
    .optional(),
});
