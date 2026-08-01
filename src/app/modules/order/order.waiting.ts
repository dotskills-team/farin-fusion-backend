import { ClientSession, Types } from "mongoose";
import { Order } from "./order.model";
import { Product } from "../product/product.model";
import { OrderStatus } from "./order.interface";
import AppError from "../../errorHelpers/appError";

export const allocateWaitingStockForProduct = async (
  productId: Types.ObjectId,
  session: ClientSession,
) => {
  const product = await Product.findById(productId).session(session);

  if (!product) {
    throw new AppError(404, "Product not found");
  }

  const availableStock = product.availableStock ?? 0;

  if (availableStock <= 0) {
    return;
  }

  const waitingOrders = await Order.find({
    orderStatus: OrderStatus.WAITING_FOR_STOCK,
    "products.product": productId,
  })
    .sort({ createdAt: 1 })
    .session(session);

  if (!waitingOrders.length) {
    return;
  }

  for (const order of waitingOrders) {
    if (availableStock <= 0) {
      break;
    }

    let orderChanged = false;

    for (const item of order.products as any[]) {
      if (item.product.toString() !== productId.toString()) {
        continue;
      }

      if (!item.isWaitingStock || item.pendingQuantity <= 0) {
        continue;
      }

      const allocateQty = Math.min(availableStock, item.pendingQuantity);

      if (allocateQty <= 0) {
        continue;
      }

      item.reservedQuantity += allocateQty;
      item.pendingQuantity -= allocateQty;

      product.availableStock = (product.availableStock || 0) - allocateQty;
      product.totalSold = (product.totalSold || 0) + allocateQty;

      if (item.pendingQuantity <= 0) {
        item.pendingQuantity = 0;
        item.isWaitingStock = false;
        item.fulfilledAt = new Date();
      }

      orderChanged = true;
    }

    if (!orderChanged) {
      continue;
    }

    const hasWaitingItems = order.products.some(
      (p: any) => p.pendingQuantity > 0,
    );

    if (!hasWaitingItems) {
      order.orderStatus = OrderStatus.PENDING;
      order.stockReservationCompleted = true;
      order.waitingStockResolvedAt = new Date();
    }

    await order.save({ session });

    if (availableStock <= 0) {
      break;
    }
  }

  await product.save({ session });
};
