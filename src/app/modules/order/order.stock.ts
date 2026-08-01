import { ClientSession, Types } from "mongoose";
import { Product } from "../product/product.model";
import { OrderStatus } from "./order.interface";
import AppError from "../../errorHelpers/appError";
import { allocateWaitingStockForProduct } from "./order.waiting";

export const onProductStockIncreased = async (
  productId: Types.ObjectId,
  session: ClientSession,
) => {
  await allocateWaitingStockForProduct(productId, session);
};

export const reserveOrderProducts = async (
  products: {
    product: Types.ObjectId;
    quantity: number;
    price: number;
  }[],
  session: ClientSession,
) => {
  let hasWaitingStock = false;

  const finalProducts = [];

  for (const item of products) {
    const product = await Product.findById(item.product).session(session);

    if (!product) {
      throw new AppError(404, "Product not found");
    }

    const available = Math.max(product.availableStock || 0, 0);
    if (item.quantity <= 0) {
      throw new AppError(400, "Invalid product quantity");
    }

    const reserved = Math.min(available, item.quantity);

    const pending = item.quantity - reserved;

    if (reserved > 0) {
      product.availableStock = (product.availableStock || 0) - reserved;
      product.totalSold = (product.totalSold || 0) + reserved;

      await product.save({ session });
    }

    if (pending > 0) {
      hasWaitingStock = true;
    }

    finalProducts.push({
      ...item,
      reservedQuantity: reserved,
      pendingQuantity: pending,
      isWaitingStock: pending > 0,
    });
  }

  return {
    hasWaitingStock,
    products: finalProducts,
  };
};
