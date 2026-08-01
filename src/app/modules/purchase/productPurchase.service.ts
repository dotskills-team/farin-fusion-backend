import { JwtPayload } from "jsonwebtoken";
import { Product } from "../product/product.model";
import AppError from "../../errorHelpers/appError";
import httpStatus from "http-status-codes";
import { QueryBuilder } from "../../utils/QueryBuilder";
import {
  IProductPurchase,
  PaymentStatus,
  PurchaseStatus,
} from "./productPurchase.interface";
import { ProductPurchase } from "./productPurchase.model";
import { productPurchaseSearchableFields } from "./productPurchase.constant";
import mongoose from "mongoose";
import { onProductStockIncreased } from "../order/order.stock";

const validatePaymentData = (
  grandTotal: number,
  payload: Partial<IProductPurchase>,
) => {
  const paymentType = payload.paymentType;
  const paidAmount = Number(payload.paidAmount || 0);

  if (!paymentType) {
    throw new AppError(httpStatus.BAD_REQUEST, "Payment type is required");
  }

  if (paidAmount < 0) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Paid amount cannot be negative",
    );
  }

  if (paidAmount > grandTotal) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Paid amount cannot exceed grand total",
    );
  }

  if (
    (paymentType === "FULL" || paymentType === "ADVANCE") &&
    !payload.paymentMethod
  ) {
    throw new AppError(httpStatus.BAD_REQUEST, "Payment method is required");
  }

  if (paymentType === "FULL" && paidAmount !== grandTotal) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Full payment must equal grand total",
    );
  }

  if (paymentType === "ADVANCE" && paidAmount <= 0) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Advance payment amount required",
    );
  }

  if (paymentType === "DUE" && paidAmount > 0) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Due purchase cannot have paid amount",
    );
  }

  const dueAmount = grandTotal - paidAmount;

  let paymentStatus: PaymentStatus;

  if (dueAmount <= 0) {
    paymentStatus = PaymentStatus.PAID;
  } else if (paidAmount > 0) {
    paymentStatus = PaymentStatus.PARTIAL;
  } else {
    paymentStatus = PaymentStatus.UNPAID;
  }

  return {
    paidAmount,
    dueAmount,
    paymentStatus,
  };
};

const createPurchase = async (
  payload: Partial<IProductPurchase>,
  user: JwtPayload,
) => {
  if (!payload.products?.length) {
    throw new AppError(httpStatus.BAD_REQUEST, "Products are required");
  }

  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    let grandTotal = 0;

    for (const item of payload.products) {
      const product = await Product.findById(item.product).session(session);

      if (!product) {
        throw new AppError(httpStatus.NOT_FOUND, "Product not found");
      }

      item.quantity = Number(item.quantity);
      item.buyingPrice = Number(item.buyingPrice);

      if (isNaN(item.quantity) || item.quantity <= 0) {
        throw new AppError(httpStatus.BAD_REQUEST, "Invalid quantity");
      }

      if (isNaN(item.buyingPrice) || item.buyingPrice < 0) {
        throw new AppError(httpStatus.BAD_REQUEST, "Invalid buying price");
      }

      item.totalAmount = item.quantity * item.buyingPrice;

      grandTotal += item.totalAmount;

      product.availableStock = (product.availableStock || 0) + item.quantity;

      product.totalAddedStock = (product.totalAddedStock || 0) + item.quantity;

      product.buyingPrice = item.buyingPrice;

      await product.save({ session });

      await onProductStockIncreased(product._id, session);
    }

    payload.grandTotal = grandTotal;

    const paymentData = validatePaymentData(grandTotal, payload);

    payload.paidAmount = paymentData.paidAmount;
    payload.dueAmount = paymentData.dueAmount;
    payload.paymentStatus = paymentData.paymentStatus;

    payload.createdBy = user.userId;

    const purchase = await ProductPurchase.create([payload], { session });

    await session.commitTransaction();
    session.endSession();

    return await ProductPurchase.findById(purchase[0]._id)
      .populate("products.product")
      .populate("createdBy", "name email");
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

const getAllPurchases = async (query: Record<string, string>) => {
  const queryBuilder = new QueryBuilder(
    ProductPurchase.find({ isDeleted: false })
      .populate("products.product")
      .populate("createdBy", "name email"),
    query,
  );

  const purchasesData = queryBuilder
    .filter()
    .search(productPurchaseSearchableFields)
    .sort()
    .fields()
    .paginate();

  const [data, meta] = await Promise.all([
    purchasesData.build(),
    queryBuilder.getMeta(),
  ]);

  return {
    data,
    meta,
  };
};

const getSinglePurchase = async (id: string) => {
  const purchase = await ProductPurchase.findById(id)
    .populate("products.product")
    .populate("createdBy", "name email");

  if (!purchase) {
    throw new AppError(httpStatus.NOT_FOUND, "Purchase not found");
  }

  return purchase;
};

const updatePurchase = async (
  id: string,
  payload: Partial<IProductPurchase>,
) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const purchase = await ProductPurchase.findById(id).session(session);

    if (!purchase) {
      throw new AppError(httpStatus.NOT_FOUND, "Purchase not found");
    }

    if (payload.products?.length) {
      // reverse old stock
      for (const oldItem of purchase.products) {
        const product = await Product.findById(oldItem.product).session(
          session,
        );

        if (product) {
          product.availableStock =
            (product.availableStock ?? 0) - oldItem.quantity;
          product.totalAddedStock =
            (product.totalAddedStock ?? 0) - oldItem.quantity;

          await product.save({ session });
        }
      }

      let grandTotal = 0;

      for (const item of payload.products) {
        const product = await Product.findById(item.product).session(session);

        if (!product) {
          throw new AppError(httpStatus.NOT_FOUND, "Product not found");
        }

        item.quantity = Number(item.quantity);
        item.buyingPrice = Number(item.buyingPrice);

        if (isNaN(item.quantity) || item.quantity <= 0) {
          throw new AppError(httpStatus.BAD_REQUEST, "Invalid quantity");
        }

        if (isNaN(item.buyingPrice) || item.buyingPrice < 0) {
          throw new AppError(httpStatus.BAD_REQUEST, "Invalid buying price");
        }

        item.totalAmount = item.quantity * item.buyingPrice;

        grandTotal += item.totalAmount;

        product.availableStock = (product.availableStock || 0) + item.quantity;
        product.totalAddedStock =
          (product.totalAddedStock || 0) + item.quantity;
        product.buyingPrice = item.buyingPrice;

        await product.save({ session });
        await onProductStockIncreased(product._id, session);
      }

      payload.grandTotal = grandTotal;

      const paymentData = validatePaymentData(payload.grandTotal, payload);

      payload.paidAmount = paymentData.paidAmount;
      payload.dueAmount = paymentData.dueAmount;
      payload.paymentStatus = paymentData.paymentStatus;
    }

    Object.assign(purchase, payload);

    await purchase.save({ session });

    await session.commitTransaction();
    session.endSession();

    return await ProductPurchase.findById(id)
      .populate("products.product")
      .populate("createdBy", "name email");
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

const updatePurchaseStatus = async (
  id: string,
  payload: {
    purchaseStatus?: PurchaseStatus;
    paymentStatus?: PaymentStatus;
  },
) => {
  const purchase = await ProductPurchase.findById(id);

  if (!purchase) {
    throw new AppError(httpStatus.NOT_FOUND, "Purchase not found");
  }

  if (payload.purchaseStatus) {
    purchase.purchaseStatus = payload.purchaseStatus;
  }

  if (payload.paymentStatus) {
    purchase.paymentStatus = payload.paymentStatus;
  }

  await purchase.save();

  return await ProductPurchase.findById(id)
    .populate("products.product")
    .populate("createdBy", "name email");
};

const getPurchaseStats = async () => {
  const purchases = await ProductPurchase.find({
    isDeleted: false,
  }).populate("products.product");

  const totalPurchases = purchases.length;

  const totalAmount = purchases.reduce(
    (sum, purchase: any) => sum + (purchase.grandTotal || 0),
    0,
  );

  const pendingPayments = purchases.filter(
    (purchase) => purchase.paymentStatus !== "PAID",
  ).length;

  const totalProfit = purchases.reduce((sum: number, purchase: any) => {
    const purchaseProfit =
      purchase.products?.reduce((acc: number, item: any) => {
        const sellingPrice = item.product?.price || 0;

        const buyingPrice = item.buyingPrice || 0;

        return acc + (sellingPrice - buyingPrice) * item.quantity;
      }, 0) || 0;

    return sum + purchaseProfit;
  }, 0);

  return {
    totalPurchases,
    totalAmount,
    totalProfit,
    pendingPayments,
  };
};

const deletePurchase = async (id: string) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const purchase = await ProductPurchase.findById(id).session(session);

    if (!purchase) {
      throw new AppError(httpStatus.NOT_FOUND, "Purchase not found");
    }

    if (purchase.isDeleted) {
      throw new AppError(httpStatus.BAD_REQUEST, "Already deleted");
    }

    for (const item of purchase.products) {
      const product = await Product.findById(item.product).session(session);

      if (product) {
        product.availableStock = Math.max(
          0,
          (product.availableStock || 0) - item.quantity,
        );

        product.totalAddedStock = Math.max(
          0,
          (product.totalAddedStock || 0) - item.quantity,
        );

        await product.save({ session });
      }
    }

    purchase.isDeleted = true;

    await purchase.save({ session });

    await session.commitTransaction();
    session.endSession();

    return null;
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

export const ProductPurchaseServices = {
  createPurchase,
  getAllPurchases,
  getSinglePurchase,
  updatePurchase,
  updatePurchaseStatus,
  getPurchaseStats,
  deletePurchase,
};
