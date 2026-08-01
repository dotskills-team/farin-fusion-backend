import { ClientSession } from "mongoose";
import { Product } from "../product/product.model";
import { IOrder } from "./order.interface";

export const restoreReservedStock = async (
  order: IOrder,
  session: ClientSession,
) => {
  for (const item of order.products) {
    const reserved = item.reservedQuantity ?? item.quantity;

    if (reserved <= 0) continue;

    await Product.findByIdAndUpdate(
      item.product,
      {
        $inc: {
          availableStock: reserved,
          totalSold: -reserved,
        },
      },
      { session },
    );
  }
};

export const deductReservedStock = async (
  order: IOrder,
  session: ClientSession,
) => {
  for (const item of order.products) {
    const reserved = item.reservedQuantity ?? item.quantity;

    if (reserved <= 0) continue;

    await Product.findByIdAndUpdate(
      item.product,
      {
        $inc: {
          availableStock: -reserved,
          totalSold: reserved,
        },
      },
      { session },
    );
  }
};