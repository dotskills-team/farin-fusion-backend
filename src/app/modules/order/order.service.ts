/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */

import httpStatus from "http-status-codes";
import mongoose, { Types } from "mongoose";
import {
  AdvanceOption,
  DeliveryStatus,
  IOrderProduct,
  OrderStatus,
  OrderType,
} from "./order.interface";
import { Counter, Order } from "./order.model";
import { calculateOrderPrice } from "../../utils/calculateOrderTotal";
import { Payment } from "../payment/payment.model";
import { PaymentMethod, PaymentStatus } from "../payment/payment.interface";
import { Product } from "../product/product.model";
import { User } from "../user/user.model";
import AppError from "../../errorHelpers/appError";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { orderSearchableFields } from "./order.constants";
import { Role } from "../user/user.interface";
import { Coupon } from "../coupon/coupon.model";
import { CouponServices } from "../coupon/coupon.service";
import { JwtPayload } from "jsonwebtoken";
import { reserveOrderProducts } from "./order.stock";
import { deductReservedStock, restoreReservedStock } from "./order.inventory";

interface TCreateOrderPayload {
  orderType: OrderType;
  paymentMethod?: PaymentMethod;
  total: number;
  discount?: number;
  couponCode?: string;
  scheduleType?: string;
  scheduledAt?: Date;
  isPublished?: boolean;
  products: IOrderProduct[];
  note: string;
  shippingCost?: number;

  billingDetails: {
    fullName?: string;
    email?: string;
    phone?: string;
    address?: string;
  };
  advanceDetails: {
    option: string;
    amount: number;
  };
  user?: string;
  seller?: string;
}

const publishScheduledOrders = async () => {
  const now = new Date();

  const orders = await Order.find({
    scheduleType: "SCHEDULED",
    isPublished: false,
    scheduledAt: { $lte: now },
  });

  for (const order of orders) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const existing = await Order.findOne({
      "billingDetails.phone": order?.billingDetails?.phone,
      createdAt: {
        $gte: todayStart,
        $lte: todayEnd,
      },
      isPublished: true,
      _id: { $ne: order._id },
    });

    if (!existing) {
      order.isPublished = true;
      await order.save();
    }
  }
};

const getTransactionId = () => {
  return `Tran_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
};

const checkCustomerOrder = async (phone: string) => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const exists = await Order.exists({
    "billingDetails.phone": phone,
    createdAt: { $gte: todayStart, $lte: todayEnd },
    isPublished: true,
  });

  return { blocked: !!exists };
};

const createOrder = async (payload: TCreateOrderPayload) => {
  const session = await mongoose.startSession();

  let updatedOrder;

  try {
    session.startTransaction();

    const getNextCustomOrderId = async (
      session: mongoose.ClientSession,
    ): Promise<number> => {
      let counter = await Counter.findById("orderId").session(session);

      if (!counter) {
        const newCounter = new Counter({
          _id: "orderId",
          seq: 1000,
        });

        await newCounter.save({ session });
        counter = newCounter;
      }

      counter.seq += 1;
      await counter.save({ session });

      return counter.seq;
    };

    // const customOrderId = await getNextCustomOrderId(session);

    const sanitizedProducts = payload.products.map((p: any) => {
      if (!p.product) {
        throw new AppError(400, "Invalid product");
      }

      let productId;

      if (typeof p.product === "string") {
        productId = p.product;
      } else if (p.product?._id) {
        productId = p.product._id;
      } else {
        throw new AppError(400, "Invalid product format");
      }

      return {
        product: new Types.ObjectId(productId),
        quantity: Number(p.quantity) || 1,
        selectedExtras: p.selectedExtras || [],
      };
    });

    const calculatedOrder = await calculateOrderPrice(
      sanitizedProducts as unknown as IOrderProduct[],
      payload.shippingCost || 0,
    );

    const reservation = await reserveOrderProducts(
      calculatedOrder.productsWithPrice.map((item: any) => ({
        product:
          typeof item.product === "string"
            ? new Types.ObjectId(item.product)
            : new Types.ObjectId(item.product._id),
        quantity: item.quantity,
        price: item.price,
      })),
      session,
    );

    const availableProducts: any[] = [];
    const waitingProducts: any[] = [];

    for (const item of calculatedOrder.productsWithPrice) {
      const reserved = reservation.products.find(
        (r) =>
          r.product.toString() ===
          (typeof item.product === "string"
            ? item.product
            : item.product._id
          ).toString(),
      );

      const orderItem = {
        ...item,

        product:
          typeof item.product === "string"
            ? new Types.ObjectId(item.product)
            : new Types.ObjectId(item.product._id),

        reservedQuantity: reserved?.reservedQuantity ?? 0,
        pendingQuantity: reserved?.pendingQuantity ?? 0,
        isWaitingStock: reserved?.isWaitingStock ?? false,
      };

      if (orderItem.isWaitingStock) {
        waitingProducts.push(orderItem);
      } else {
        availableProducts.push(orderItem);
      }
    }

    const isScheduled = payload.scheduleType === "SCHEDULED";

    const orderConfigs: {
      products: any[];
      status: OrderStatus;
      stockReservationCompleted: boolean;
      shippingCost: number;
      discount: number;
    }[] = [];

    if (availableProducts.length > 0) {
      orderConfigs.push({
        products: availableProducts,
        status: OrderStatus.PENDING,
        stockReservationCompleted: true,

        // Instant order receives shipping & discount
        shippingCost: payload.shippingCost || 0,
        discount: payload.discount || 0,
      });
    }

    if (waitingProducts.length > 0) {
      orderConfigs.push({
        products: waitingProducts,
        status: OrderStatus.WAITING_FOR_STOCK,
        stockReservationCompleted: false,

        // Waiting order gets no shipping/discount
        shippingCost: availableProducts.length ? 0 : payload.shippingCost || 0,
        discount: availableProducts.length ? 0 : payload.discount || 0,
      });
    }

    const customOrderIds: number[] = [];

    const totalOrdersToCreate =
      (availableProducts.length ? 1 : 0) + (waitingProducts.length ? 1 : 0);

    for (let i = 0; i < totalOrdersToCreate; i++) {
      customOrderIds.push(await getNextCustomOrderId(session));
    }

if (payload.couponCode) {
  const coupon = await Coupon.findOne({
    code: payload.couponCode,
    isDeleted: false,
  }).session(session);

  if (!coupon) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Invalid coupon",
    );
  }

  await Coupon.findByIdAndUpdate(
    coupon._id,
    {
      $inc: {
        usedCount: 1,
      },
    },
    { session },
  );
}

    // if (
    //   payload.advanceDetails?.amount &&
    //   payload.advanceDetails.amount > orderDoc.total
    // ) {
    //   throw new AppError(400, "Advance amount cannot exceed payable total");
    // }

    // Link customer only if a valid email exists
    let customerId: Types.ObjectId | undefined;

    if (payload.billingDetails?.email) {
      const customer = await User.findOne({
        email: payload.billingDetails.email,
      }).session(session);

      if (customer) {
        customerId = customer._id;
      }
    }

    if (payload.orderType === OrderType.POS) {
      if (!payload.seller) {
        throw new AppError(httpStatus.BAD_REQUEST, "Seller required");
      }
    }

    // Prevent duplicate POS orders from the same customer on the same day.
    // Public website (ONLINE) orders are allowed multiple times.

    if (payload.orderType === OrderType.POS) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      const existingOrderToday = await Order.findOne({
        orderType: OrderType.POS,
        "billingDetails.phone": payload.billingDetails.phone,
        createdAt: {
          $gte: todayStart,
          $lte: todayEnd,
        },
        isDeleted: false,
        isPublished: true,
      }).session(session);

      if (existingOrderToday) {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          "This customer already has a POS order today. Please try again after 12:00 AM.",
        );
      }
    }

    const createdOrders = [];
    let remainingAdvance = payload.advanceDetails?.amount || 0;

    for (let index = 0; index < orderConfigs.length; index++) {
      const config = orderConfigs[index];

      const subtotal = config.products.reduce(
        (sum: number, item: any) => sum + item.price * item.quantity,
        0,
      );
      let total = subtotal + config.shippingCost;

      const discount = config.discount;

      total -= discount;

      let advanceAmount = 0;

      if (payload.advanceDetails?.option && remainingAdvance > 0) {
        advanceAmount = Math.min(remainingAdvance, total);
        remainingAdvance -= advanceAmount;
      }

      const orderDoc: any = {
        customOrderId: `ORD-${customOrderIds[index]}`,

        orderType: payload.orderType,

        products: config.products,

        subtotal,

        shippingCost: config.shippingCost,

        discount,

        total,

        scheduleType: payload.scheduleType || "INSTANT",

        scheduledAt: payload.scheduledAt || null,

        isPublished: isScheduled ? false : true,

        orderStatus: config.status,

        stockReservationCompleted: config.stockReservationCompleted,

        advanceDetails:
          payload.advanceDetails?.option && advanceAmount > 0
            ? {
                option: payload.advanceDetails.option,
                amount: advanceAmount,
              }
            : undefined,

        confirmedBy: null,

        billingDetails: payload.billingDetails,
      };

      if (customerId) {
        orderDoc.customer = customerId;
      }

      if (payload.orderType === OrderType.POS) {
        orderDoc.seller = payload.seller;
      }

      const order = new Order(orderDoc);

      await order.save({ session });

      const transactionId = getTransactionId();

      const [payment] = await Payment.create(
        [
          {
            order: order._id,

            transactionId,

            amount: orderDoc.total,

            paymentStatus:
              payload.paymentMethod === PaymentMethod.COD
                ? PaymentStatus.PAID
                : PaymentStatus.UNPAID,

            paymentMethod: payload.paymentMethod,
          },
        ],
        { session },
      );

      const updated = await Order.findByIdAndUpdate(
        order._id,
        {
          payment: payment._id,

          transactionId,

          note: payload.note || "Auto generated order",
        },
        {
          returnDocument: "after",
          session,
        },
      )
        .populate("customer", "name email _id role phone")
        .populate("seller", "name email _id role phone")
        .populate("payment")
        .populate("products.product")
        .populate("confirmedBy", "name email _id role phone");

      createdOrders.push(updated);
    }

    updatedOrder =
      createdOrders.length === 1 ? createdOrders[0] : createdOrders;

    // await Promise.all(
    //   sanitizedProducts.map(async (p) => {
    //     const product = await Product.findById(p.product).session(session);

    //     if (product) {
    //       product.totalSold = (product.totalSold || 0) + p.quantity;
    //       product.availableStock = (product.availableStock || 0) - p.quantity;
    //       await product.save({ session });
    //     }
    //   }),
    // );

    await session.commitTransaction();
    session.endSession();
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    session.endSession();
    throw error;
  }

  // (future use: invoice, email, notification etc.)

  return {
    order: updatedOrder,
  };
};

const getSingleOrder = async (id: string) => {
  const order = await Order.findById(id)
    .populate("customer", "name email _id role phone")
    .populate("seller", "name email _id role phone")
    .populate("payment")
    .populate("products.product")
    .populate("confirmedBy", "name email _id role phone");
  if (!order) {
    throw new AppError(httpStatus.NOT_FOUND, "Order Not Found");
  }

  return { data: order };
};

const restoreNoResponseOrder = async (orderId: string) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const existingOrder = await Order.findById(orderId).session(session);

    if (!existingOrder) {
      throw new AppError(httpStatus.NOT_FOUND, "Order not found");
    }

    if (existingOrder.orderStatus !== OrderStatus.NO_RESPONSE) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Only no response orders can be restored",
      );
    }

    // Stock deduct again
    if ((existingOrder as any).isRestocked) {
      await deductReservedStock(existingOrder, session);

      (existingOrder as any).isRestocked = false;
    }

    // Restore order
    existingOrder.orderStatus = OrderStatus.PENDING;
    existingOrder.noResponseAt = null;

    await existingOrder.save({ session });

    await session.commitTransaction();
    session.endSession();

    return await Order.findById(orderId)
      .populate("customer", "name email _id role phone")
      .populate("seller", "name email _id role phone")
      .populate("payment")
      .populate("products.product");
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

const markOrderNoResponse = async (orderId: string) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const existingOrder = await Order.findById(orderId).session(session);

    if (!existingOrder) {
      throw new AppError(httpStatus.NOT_FOUND, "Order not found");
    }

    // Already marked
    if (existingOrder.orderStatus === OrderStatus.NO_RESPONSE) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Order already marked as no response",
      );
    }

    if (!(existingOrder as any).isRestocked) {
      // for (const item of existingOrder.products) {
      //   const before = await Product.findById(item.product).session(session);

      // console.log("========== BEFORE ==========");
      // console.log({
      //   product: before?.title,
      //   availableStock: before?.availableStock,
      //   totalSold: before?.totalSold,
      // });

      await restoreReservedStock(existingOrder, session);

      // console.log("========== AFTER ==========");
      // console.log({
      //   product: updated?.title,
      //   availableStock: updated?.availableStock,
      //   totalSold: updated?.totalSold,
      // });
      // }

      existingOrder.isRestocked = true;
    }

    existingOrder.orderStatus = OrderStatus.NO_RESPONSE;
    existingOrder.deliveryStatus = DeliveryStatus.NOT_SHIPPED;
    existingOrder.noResponseAt = new Date();

    await existingOrder.save({ session });

    await session.commitTransaction();
    session.endSession();

    return await Order.findById(orderId)
      .populate("customer", "name email _id role phone")
      .populate("seller", "name email _id role phone")
      .populate("payment")
      .populate("products.product");
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

const updateManualDeliveryStatus = async (
  orderId: string,
  deliveryStatus: DeliveryStatus,
) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const order = await Order.findById(orderId).session(session);

    if (!order) {
      throw new AppError(httpStatus.NOT_FOUND, "Order not found");
    }

    if (order.courierName) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Courier assigned orders must be updated from courier tracking",
      );
    }

    if (
      [
        OrderStatus.COMPLETED,
        OrderStatus.CANCELLED,
        OrderStatus.DAMAGE,
      ].includes(order.orderStatus as OrderStatus)
    ) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Finalized orders cannot be updated manually",
      );
    }

    const allowedStatuses = [
      DeliveryStatus.PICKED_UP,
      DeliveryStatus.DELIVERED,
      DeliveryStatus.HOLD,
      DeliveryStatus.IN_TRANSIT,
      DeliveryStatus.CANCELLED,
    ];

    if (!allowedStatuses.includes(deliveryStatus)) {
      throw new AppError(httpStatus.BAD_REQUEST, "Unsupported delivery status");
    }

    if (
      order.deliveryStatus === deliveryStatus &&
      deliveryStatus !== DeliveryStatus.PICKED_UP
    ) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Order already in this delivery status",
      );
    }

    if (
      [DeliveryStatus.HOLD, DeliveryStatus.IN_TRANSIT].includes(
        deliveryStatus,
      ) &&
      order.orderStatus !== OrderStatus.CONFIRMED
    ) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Only confirmed orders can be updated to hold or transit",
      );
    }

    if (
      deliveryStatus === DeliveryStatus.PICKED_UP ||
      deliveryStatus === DeliveryStatus.DELIVERED
    ) {
      order.deliveryStatus = DeliveryStatus.DELIVERED;
      order.orderStatus = OrderStatus.COMPLETED;
      if (!order.deliveredAt) {
        order.deliveredAt = new Date();
      }
    }

    if (deliveryStatus === DeliveryStatus.HOLD) {
      order.deliveryStatus = DeliveryStatus.HOLD;
      order.orderStatus = OrderStatus.CONFIRMED;
      if (!order.holdAt) {
        order.holdAt = new Date();
      }
    }

    if (deliveryStatus === DeliveryStatus.IN_TRANSIT) {
      order.deliveryStatus = DeliveryStatus.IN_TRANSIT;
      order.orderStatus = OrderStatus.CONFIRMED;
    }

    if (deliveryStatus === DeliveryStatus.CANCELLED) {
      if (!(order as any).isRestocked) {
        await restoreReservedStock(order, session);

        (order as any).isRestocked = true;
      }

      order.deliveryStatus = DeliveryStatus.CANCELLED;
      order.orderStatus = OrderStatus.CANCELLED;
      if (!order.cancelledAt) {
        order.cancelledAt = new Date();
      }
    }

    await order.save({ session });

    await session.commitTransaction();

    return await Order.findById(orderId)
      .populate("customer", "name email _id role phone")
      .populate("seller", "name email _id role phone")
      .populate("payment")
      .populate("products.product");
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
};

const deleteOrder = async (id: string) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const order = await Order.findById(id).session(session);

    if (!order) {
      throw new AppError(httpStatus.NOT_FOUND, "Order Not Found");
    }

    if (!(order as any).isRestocked) {
      await restoreReservedStock(order, session);

      (order as any).isRestocked = true;
      await order.save({ session });
    }

    await Order.findByIdAndDelete(id).session(session);

    await session.commitTransaction();
    session.endSession();

    return { data: null };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

const updateOrderCancelStatus = async (
  orderId: string,
  payload: {
    orderStatus?: string;
    deliveryStatus?: string;
  },
) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const existingOrder = await Order.findById(orderId).session(session);

    if (!existingOrder) {
      throw new AppError(httpStatus.NOT_FOUND, "Order not found");
    }

    const previousStatus = existingOrder.orderStatus;

    const newOrderStatus = payload.orderStatus || previousStatus;

    if (previousStatus !== "CANCELLED" && newOrderStatus === "CANCELLED") {
      if (!(existingOrder as any).isRestocked) {
        await restoreReservedStock(existingOrder, session);
        (existingOrder as any).isRestocked = true;
      }

      existingOrder.deliveryStatus = DeliveryStatus.CANCELLED;
    }

    if (previousStatus === "CANCELLED" && newOrderStatus !== "CANCELLED") {
      if ((existingOrder as any).isRestocked) {
        await deductReservedStock(existingOrder, session);

        (existingOrder as any).isRestocked = false;
      }
    }

    if (payload.orderStatus) {
      existingOrder.orderStatus = payload.orderStatus as any;
    }

    if (payload.deliveryStatus) {
      existingOrder.deliveryStatus = payload.deliveryStatus as any;
    }

    // auto sync
    if (payload.orderStatus === "COMPLETED") {
      existingOrder.deliveryStatus = DeliveryStatus.DELIVERED;
    }

    await existingOrder.save({ session });

    await session.commitTransaction();
    session.endSession();

    return await Order.findById(orderId)
      .populate("customer", "name email _id role phone")
      .populate("seller", "name email _id role phone")
      .populate("payment")
      .populate("products.product");
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

const updateOrderStatus = async (
  orderId: string,
  status: string,
  user: JwtPayload,
) => {
  const existingOrder = await Order.findById(orderId);

  if (!existingOrder) {
    throw new AppError(httpStatus.NOT_FOUND, "Order not found");
  }

  const prevStatus = existingOrder.orderStatus;

  const updateData: any = {
    orderStatus: status,
  };

  if (status === OrderStatus.CONFIRMED) {
    updateData.confirmedBy = user.userId;
    if (!existingOrder.confirmedAt) {
      updateData.confirmedAt = new Date();
    }
  }

  if (status === OrderStatus.COMPLETED) {
    updateData.deliveryStatus = DeliveryStatus.DELIVERED;

    updateData.deliveredAt = new Date();
  }

  const updatedOrder = await Order.findByIdAndUpdate(orderId, updateData, {
    returnDocument: "after",
    runValidators: true,
  });

  if (!updatedOrder) {
    throw new AppError(httpStatus.BAD_REQUEST, "Failed to update order status");
  }

  return updatedOrder;
};

const exchangeOrderItem = async ({
  orderId,
  itemIndex,
  newProductId,
  note,
}: any) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const order = await Order.findById(orderId)
      .populate("products.product")
      .session(session);

    if (!order) throw new AppError(404, "Order not found");

    const item = order.products[itemIndex];
    if (!item) throw new AppError(400, "Invalid item index");

    const oldProduct = await Product.findById(item.product).session(session);
    const newProduct = await Product.findById(newProductId).session(session);

    if (!newProduct) throw new AppError(404, "New product not found");

    const qty = item.reservedQuantity ?? item.quantity;

    // RESTORE OLD PRODUCT
    await Product.findByIdAndUpdate(
      oldProduct?._id,
      {
        $inc: {
          availableStock: qty,
          totalSold: -qty,
        },
      },
      { session },
    );

    // DEDUCT NEW PRODUCT
    await Product.findByIdAndUpdate(
      newProduct._id,
      {
        $inc: {
          availableStock: -qty,
          totalSold: qty,
        },
      },
      { session },
    );

    // PRICE DIFFERENCE
    const priceDiff = (newProduct.price - item.price) * qty;

    // UPDATE ORDER ITEM
    item.product = newProduct._id;
    item.price = newProduct.price;

    // HISTORY (NO INTERFACE NEEDED)
    if (!order.exchangeHistory) order.exchangeHistory = [];

    order.exchangeHistory.push({
      oldProduct: oldProduct?._id,
      newProduct: newProduct._id,
      quantity: qty,
      priceDiff,
      note,
      updatedAt: new Date(),
    });

    order.total += priceDiff;

    await order.save({ session });

    await session.commitTransaction();
    session.endSession();

    return order;
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

const markOrderDamage = async ({ orderId, itemIndex, quantity, note }: any) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const order = await Order.findById(orderId)
      .populate("products.product")
      .session(session);

    if (!order) throw new AppError(404, "Order not found");

    const item = order.products[itemIndex];
    if (!item) throw new AppError(400, "Invalid item");

    if (quantity > item.quantity) {
      throw new AppError(400, "Invalid quantity");
    }

    if (!order.damageProducts) order.damageProducts = [];

    order.damageProducts.push({
      product: item.product,
      quantity,
      note,
      updatedAt: new Date(),
    });

    // DAMAGE = LOSS (no stock return)

    order.total -= item.price * quantity;
    order.orderStatus = OrderStatus.DAMAGE;

    await order.save({ session });

    await session.commitTransaction();
    session.endSession();

    return order;
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

const updateOrder = async (orderId: string, payload: any) => {
  const existingOrder =
    await Order.findById(orderId).populate("products.product");

  if (!existingOrder) {
    throw new AppError(httpStatus.NOT_FOUND, "Order not found");
  }

  // --- Stock/Sold reconciliation when products are being updated ---
  if (payload.products && payload.products.length > 0) {
    const existingProductMap = new Map<string, number>();

    // Build a map of productId -> quantity from the EXISTING order
    for (const item of existingOrder.products) {
      const productId =
        typeof item.product === "object"
          ? (item.product as any)._id.toString()
          : item.product;
      existingProductMap.set(
        productId,
        (existingProductMap.get(productId) || 0) + item.quantity,
      );
    }

    const newProductMap = new Map<string, number>();

    // Build a map of productId -> quantity from the NEW payload
    for (const item of payload.products) {
      const productId =
        typeof item.product === "object"
          ? (item.product._id?.toString() ?? item.product.toString())
          : item.product.toString();
      newProductMap.set(
        productId,
        (newProductMap.get(productId) || 0) + item.quantity,
      );
    }

    // Collect all unique product IDs across both old and new
    const allProductIds = new Set([
      ...existingProductMap.keys(),
      ...newProductMap.keys(),
    ]);

    await Promise.all(
      Array.from(allProductIds).map(async (productId) => {
        const oldQty = existingProductMap.get(productId) || 0;
        const newQty = newProductMap.get(productId) || 0;
        const diff = newQty - oldQty;

        if (diff === 0) return;

        const product = await Product.findById(productId);
        if (!product) return;

        product.totalSold = Math.max(0, (product.totalSold || 0) + diff);
        product.availableStock = Math.max(
          0,
          (product.availableStock || 0) - diff,
        );
        await product.save();
      }),
    );
  }

  let subtotal = 0;

  if (payload.products && payload.products.length > 0) {
    subtotal = payload.products.reduce(
      (sum: number, item: any) => sum + item.price * item.quantity,
      0,
    );
  }

  const shippingCost = payload.shippingCost ?? existingOrder.shippingCost ?? 0;
  const discount = payload.discount ?? existingOrder.discount ?? 0;
  let total = subtotal + shippingCost - discount;

  if (payload?.advanceDetails?.option && payload?.advanceDetails?.amount) {
    total = total - payload?.advanceDetails?.amount;
  }

  const updatedOrder = await Order.findByIdAndUpdate(
    orderId,
    { ...payload, total, subtotal },
    {
      returnDocument: "after",
      runValidators: true,
    },
  );

  if (!updatedOrder) {
    throw new AppError(httpStatus.NOT_FOUND, "Order update failed");
  }

  return updatedOrder;
};

const assignSeller = async (orderId: string, sellerId: string) => {
  const order = await Order.findById(orderId);

  if (!order) {
    throw new AppError(404, "Order not found");
  }

  const seller = await User.findById(sellerId);
  if (!seller) {
    throw new AppError(404, "Seller not found");
  }

  if (!["ADMIN", "MANAGER", "MODERATOR", "TELLICELSS"].includes(seller.role)) {
    throw new AppError(400, "Invalid seller role");
  }

  order.seller = new Types.ObjectId(sellerId);

  await order.save();

  return await order.populate([
    { path: "seller", select: "name email role" },
    { path: "customer", select: "name email" },
  ]);
};

const getAllOrders = async (query: Record<string, string>) => {
  await publishScheduledOrders();
  const queryObj: any = {};

  // DATE FILTER

  const dateFieldMap: Record<string, string> = {
    updatedAt: "updatedAt",
    confirmed: "confirmedAt",
    courierAssigned: "courierAssignedAt",
    pickedUp: "pickedUpAt",
    delivered: "deliveredAt",
    partial: "partialDeliveredAt",
    waitingForStock: "waitingForStock",
    cancelled: "cancelledAt",
    hold: "holdAt",
    noResponse: "noResponseAt",
  };

  const dateType = query.dateType || "created";

  const dateField = dateFieldMap[dateType] || "updatedAt";

  if (query["updatedAt[gte]"] || query["updatedAt[lte]"]) {
    queryObj[dateField] = {};

    if (query["updatedAt[gte]"]) {
      queryObj[dateField].$gte = new Date(query["updatedAt[gte]"]);
    }

    if (query["updatedAt[lte]"]) {
      queryObj[dateField].$lte = new Date(query["updatedAt[lte]"]);
    }
  }

  // STATUS
  if (query.orderStatus) {
    queryObj.orderStatus = query.orderStatus;
  } else {
    queryObj.orderStatus = {
      $ne: OrderStatus.WAITING_FOR_STOCK,
    };
  }

  if (query.deliveryStatus) {
    queryObj.deliveryStatus = query.deliveryStatus;
  }

  // REMOVE SPECIAL FIELDS
  delete query["updatedAt[gte]"];
  delete query["updatedAt[lte]"];
  delete query.dateType;

  const queryBuilder = new QueryBuilder(
    Order.find({
      isDeleted: false,
      isPublished: true,
      ...queryObj,
    }),
    query,
  );

  const matchStage: any = {
    isDeleted: false,
    isPublished: true,
    ...queryObj,
  };

  if (!query.orderStatus) {
    matchStage.orderStatus = {
      $ne: OrderStatus.WAITING_FOR_STOCK,
    };
  }

  const stats = await Order.aggregate([
    {
      $match: matchStage,
    },
    {
      $group: {
        _id: "$orderStatus",
        count: { $sum: 1 },
      },
    },
  ]);

  const formattedStats = {
    total: 0,
    PENDING: 0,
    CONFIRMED: 0,
    COMPLETED: 0,
    CANCELLED: 0,
    NO_RESPONSE: 0,
    WAITING_FOR_STOCK: 0,
  };

  stats.forEach((item) => {
    formattedStats[item._id as keyof typeof formattedStats] = item.count;
    formattedStats.total += item.count;
  });

  const ordersData = queryBuilder
    .search(orderSearchableFields)
    .filter()
    .sort()
    .fields()
    .paginate()
    .build()
    .populate("customer", "name email _id role phone")
    .populate("seller", "name email _id role phone")
    .populate("payment")
    .populate("products.product")
    .populate("confirmedBy", "name email _id role phone");

  const [data, meta] = await Promise.all([ordersData, queryBuilder.getMeta()]);

  return { data, meta, stats: formattedStats };
};

const getAllScheduledOrders = async (query: Record<string, string>) => {
  const queryObj: any = {
    isDeleted: false,
    isPublished: false,
    scheduleType: "SCHEDULED",
  };

  // DATE FILTER (optional)
  if (query["scheduledAt[gte]"] || query["scheduledAt[lte]"]) {
    queryObj.scheduledAt = {};

    if (query["scheduledAt[gte]"]) {
      queryObj.scheduledAt.$gte = new Date(query["scheduledAt[gte]"]);
    }

    if (query["scheduledAt[lte]"]) {
      queryObj.scheduledAt.$lte = new Date(query["scheduledAt[lte]"]);
    }
  }

  const queryBuilder = new QueryBuilder(Order.find(queryObj), query);

  const data = await Order.find(queryObj)
    .populate("customer", "name email phone")
    .populate("seller", "name email role")
    .populate("products.product");

  const stats = await Order.aggregate([
    {
      $match: {
        isDeleted: false,
        ...queryObj,
      },
    },
    {
      $group: {
        _id: "$orderStatus",
        count: { $sum: 1 },
      },
    },
  ]);

  const formattedStats = {
    total: 0,
    PENDING: 0,
    CONFIRMED: 0,
    COMPLETED: 0,
    CANCELLED: 0,
    NO_RESPONSE: 0,
    WAITING_FOR_STOCK: 0,
  };

  stats.forEach((item) => {
    formattedStats[item._id as keyof typeof formattedStats] = item.count;
    formattedStats.total += item.count;
  });

  const meta = await queryBuilder.getMeta();

  return { data, meta, stats: formattedStats };
};

const getMyScheduledOrders = async (
  userId: string,
  query: Record<string, string>,
) => {
  const user = await User.findById(userId).select("role email");

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  let baseQuery: any = {
    isDeleted: false,
    isPublished: false,
    scheduleType: "SCHEDULED",
  };

  if (user.role === Role.CUSTOMER) {
    baseQuery["billingDetails.email"] = user.email;
  } else if (
    [Role.MODERATOR, Role.MANAGER, Role.TELLICELSS].includes(user.role)
  ) {
    baseQuery.seller = userId;
  } else if (user.role === Role.ADMIN) {
    baseQuery.seller = userId;
  }

  const queryBuilder = new QueryBuilder(Order.find(baseQuery), query);

  const data = await Order.find(baseQuery)
    .populate("customer", "name email phone")
    .populate("seller", "name email role")
    .populate("products.product");

  const meta = await queryBuilder.getMeta();

  return { data, meta };
};

const getAllTrashOrders = async (query: Record<string, string>) => {
  const queryBuilder = new QueryBuilder(
    Order.find({ isDeleted: true, isPublished: true }),
    query,
  );
  const ordersData = queryBuilder
    .filter()
    .search(orderSearchableFields)
    .sort()
    .fields()
    .paginate()
    .build()
    .populate("customer", "name email _id role phone")
    .populate("seller", "name email _id role phone")
    .populate("payment")
    .populate("products.product");

  const [data, meta] = await Promise.all([ordersData, queryBuilder.getMeta()]);
  return { data, meta };
};

const getMyOrders = async (userId: string, query: Record<string, string>) => {
  await publishScheduledOrders();
  const queryObj: any = {};

  // DATE FILTER
  if (query["updatedAt[gte]"] || query["updatedAt[lte]"]) {
    queryObj.updatedAt = {};

    if (query["updatedAt[gte]"]) {
      queryObj.updatedAt.$gte = new Date(query["updatedAt[gte]"]);
    }

    if (query["updatedAt[lte]"]) {
      queryObj.updatedAt.$lte = new Date(query["updatedAt[lte]"]);
    }
  }

  if (query.orderStatus) {
    queryObj.orderStatus = query.orderStatus;
  }

  if (query.orderStatus) {
    queryObj.orderStatus = query.orderStatus;
  } else {
    queryObj.orderStatus = {
      $ne: OrderStatus.WAITING_FOR_STOCK,
    };
  }

  delete query["updatedAt[gte]"];
  delete query["updatedAt[lte]"];

  const user = await User.findById(userId).select("role email");
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");

  let baseQuery;

  if (user.role === Role.CUSTOMER) {
    baseQuery = Order.find({
      isDeleted: false,
      isPublished: true,
      "billingDetails.email": user.email,
      ...queryObj,
    });
  } else if (
    [Role.MODERATOR, Role.MANAGER, Role.TELLICELSS].includes(user.role)
  ) {
    baseQuery = Order.find({
      isDeleted: false,
      isPublished: true,
      seller: userId,
      ...queryObj,
    });
  } else if (user.role === Role.ADMIN) {
    baseQuery = Order.find({
      isDeleted: false,
      isPublished: true,
      seller: userId,
      ...queryObj,
    });
  } else {
    throw new AppError(httpStatus.FORBIDDEN, "Access denied");
  }

  const statsAgg = await Order.aggregate([
    {
      $match: {
        isDeleted: false,
        isPublished: true,

        ...(user.role === Role.CUSTOMER
          ? { "billingDetails.email": user.email }
          : { seller: new Types.ObjectId(userId) }),

        ...queryObj,
      },
    },
    {
      $group: {
        _id: "$orderStatus",
        count: { $sum: 1 },
      },
    },
  ]);

  const stats = {
    total: 0,
    PENDING: 0,
    CONFIRMED: 0,
    COMPLETED: 0,
    CANCELLED: 0,
    WAITING_FOR_STOCK: 0,
  };

  statsAgg.forEach((item) => {
    stats[item._id as keyof typeof stats] = item.count;
    stats.total += item.count;
  });

  const queryBuilder = new QueryBuilder(baseQuery, query)
    .search(orderSearchableFields)
    .filter()
    .sort()
    .fields()
    .paginate();

  const orders = await queryBuilder
    .build()
    .populate("customer", "name email _id role phone")
    .populate("seller", "name email _id role phone")
    .populate("payment")
    .populate("products.product");

  const meta = await queryBuilder.getMeta();

  return { data: orders, meta, stats };
};

const getMyWaitingForStockOrders = async (
  userId: string,
  query: Record<string, string>,
) => {
  await publishScheduledOrders();

  const queryObj: any = {
    orderStatus: OrderStatus.WAITING_FOR_STOCK,
  };

  // DATE FILTER
  if (query["updatedAt[gte]"] || query["updatedAt[lte]"]) {
    queryObj.updatedAt = {};

    if (query["updatedAt[gte]"]) {
      queryObj.updatedAt.$gte = new Date(query["updatedAt[gte]"]);
    }

    if (query["updatedAt[lte]"]) {
      queryObj.updatedAt.$lte = new Date(query["updatedAt[lte]"]);
    }
  }

  if (query.deliveryStatus) {
    queryObj.deliveryStatus = query.deliveryStatus;
  }

  delete query["updatedAt[gte]"];
  delete query["updatedAt[lte]"];

  const user = await User.findById(userId).select("role email");

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  let baseQuery;

  if (user.role === Role.CUSTOMER) {
    baseQuery = Order.find({
      isDeleted: false,
      isPublished: true,
      "billingDetails.email": user.email,
      ...queryObj,
    });
  } else if (
    [Role.MODERATOR, Role.MANAGER, Role.TELLICELSS, Role.ADMIN].includes(
      user.role,
    )
  ) {
    baseQuery = Order.find({
      isDeleted: false,
      isPublished: true,
      seller: userId,
      ...queryObj,
    });
  } else {
    throw new AppError(httpStatus.FORBIDDEN, "Access denied");
  }

  const matchStage = {
    isDeleted: false,
    isPublished: true,
    ...(user.role === Role.CUSTOMER
      ? { "billingDetails.email": user.email }
      : { seller: new Types.ObjectId(userId) }),
    ...queryObj,
  };

  const statsAgg = await Order.aggregate([
    {
      $match: matchStage,
    },
    {
      $group: {
        _id: "$orderStatus",
        count: { $sum: 1 },
      },
    },
  ]);

  const stats = {
    total: 0,
    PENDING: 0,
    CONFIRMED: 0,
    COMPLETED: 0,
    CANCELLED: 0,
    WAITING_FOR_STOCK: 0,
  };

  statsAgg.forEach((item) => {
    if (item._id in stats) {
      stats[item._id as keyof typeof stats] = item.count;
    }

    stats.total += item.count;
  });

  const queryBuilder = new QueryBuilder(baseQuery, query)
    .search(orderSearchableFields)
    .filter()
    .sort()
    .fields()
    .paginate();

  const orders = await queryBuilder
    .build()
    .populate("customer", "name email _id role phone")
    .populate("seller", "name email _id role phone")
    .populate("payment")
    .populate("products.product")
    .populate("confirmedBy", "name email _id role phone");

  const meta = await queryBuilder.getMeta();

  return {
    data: orders,
    meta,
    stats,
  };
};

const getAllHoldOrders = async (query: Record<string, string>) => {
  const queryObj: any = {
    isDeleted: false,
    isPublished: false,
    scheduleType: "HOLD",
  };

  // DATE FILTER (optional)
  if (query["scheduledAt[gte]"] || query["scheduledAt[lte]"]) {
    queryObj.scheduledAt = {};

    if (query["scheduledAt[gte]"]) {
      queryObj.scheduledAt.$gte = new Date(query["scheduledAt[gte]"]);
    }

    if (query["scheduledAt[lte]"]) {
      queryObj.scheduledAt.$lte = new Date(query["scheduledAt[lte]"]);
    }
  }

  const queryBuilder = new QueryBuilder(Order.find(queryObj), query);

  const data = await Order.find(queryObj)
    .populate("customer", "name email phone")
    .populate("seller", "name email role")
    .populate("products.product");

  const stats = await Order.aggregate([
    {
      $match: {
        isDeleted: false,
        ...queryObj,
      },
    },
    {
      $group: {
        _id: "$orderStatus",
        count: { $sum: 1 },
      },
    },
  ]);

  const formattedStats = {
    total: 0,
    PENDING: 0,
    CONFIRMED: 0,
    COMPLETED: 0,
    CANCELLED: 0,
    NO_RESPONSE: 0,
    WAITING_FOR_STOCK: 0,
  };

  stats.forEach((item) => {
    formattedStats[item._id as keyof typeof formattedStats] = item.count;
    formattedStats.total += item.count;
  });

  const meta = await queryBuilder.getMeta();

  return { data, meta, stats: formattedStats };
};

const getMyHoldOrders = async (
  userId: string,
  query: Record<string, string>,
) => {
  const user = await User.findById(userId).select("role email");

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  let baseQuery: any = {
    isDeleted: false,
    isPublished: false,
    scheduleType: "HOLD",
  };

  if (user.role === Role.CUSTOMER) {
    baseQuery["billingDetails.email"] = user.email;
  } else if (
    [Role.MODERATOR, Role.MANAGER, Role.TELLICELSS].includes(user.role)
  ) {
    baseQuery.seller = userId;
  } else if (user.role === Role.ADMIN) {
    baseQuery.seller = userId;
  }

  const queryBuilder = new QueryBuilder(Order.find(baseQuery), query);

  const data = await Order.find(baseQuery)
    .populate("customer", "name email phone")
    .populate("seller", "name email role")
    .populate("products.product");

  const meta = await queryBuilder.getMeta();

  return { data, meta };
};

const getAllNoResponseOrders = async (query: Record<string, string>) => {
  await publishScheduledOrders();

  const queryObj: any = {
    orderStatus: OrderStatus.NO_RESPONSE,
  };

  if (query["createdAt[gte]"] || query["createdAt[lte]"]) {
    queryObj.createdAt = {};

    if (query["createdAt[gte]"]) {
      queryObj.createdAt.$gte = new Date(query["createdAt[gte]"]);
    }

    if (query["createdAt[lte]"]) {
      queryObj.createdAt.$lte = new Date(query["createdAt[lte]"]);
    }
  }

  delete query.orderStatus;

  const queryBuilder = new QueryBuilder(
    Order.find({
      isDeleted: false,
      isPublished: true,
      ...queryObj,
    }),
    query,
  );

  const data = await queryBuilder
    .search(orderSearchableFields)
    .filter()
    .sort()
    .fields()
    .paginate()
    .build()
    .populate("customer", "name email _id role phone")
    .populate("seller", "name email _id role phone")
    .populate("payment")
    .populate("products.product")
    .populate("confirmedBy", "name email _id role phone");

  const meta = await queryBuilder.getMeta();

  return { data, meta };
};

const getAllWaitingStockOrders = async (query: Record<string, string>) => {
  const queryBuilder = new QueryBuilder(
    Order.find({
      isDeleted: false,
      isPublished: true,
      orderStatus: OrderStatus.WAITING_FOR_STOCK,
    }),
    query,
  );

  const ordersData = queryBuilder
    .search(orderSearchableFields)
    .filter()
    .sort()
    .fields()
    .paginate()
    .build()
    .populate("customer", "name email phone")
    .populate("seller", "name email role phone")
    .populate("payment")
    .populate("products.product");

  const [data, meta] = await Promise.all([ordersData, queryBuilder.getMeta()]);

  return {
    data,
    meta,
  };
};

const getAllDamagedProducts = async () => {
  const orders = await Order.find({ isDeleted: false, isPublished: true })
    .populate("products.product")
    .lean();

  const damagedProducts: any[] = [];

  orders.forEach((order) => {
    order.products.forEach((item: any) => {
      if (order.orderStatus === "DAMAGE") {
        damagedProducts.push({
          orderId: order._id,
          customOrderId: order.customOrderId,
          productId: item.product?._id,
          productTitle: item.product?.title || item.title,
          quantity: item.damagedQuantity || item.quantity,
          unitPrice: item.price,
          totalPrice: item.price * (item.damagedQuantity || item.quantity),
          customerName: order.billingDetails?.fullName,
          markedAt: item.updatedAt || order.updatedAt,
          notes: order.note,
        });
      }
    });
  });

  return damagedProducts;
};

export const OrderServices = {
  createOrder,
  getSingleOrder,
  getAllOrders,
  getAllTrashOrders,
  getAllNoResponseOrders,
  updateOrder,
  checkCustomerOrder,
  updateOrderStatus,
  assignSeller,
  markOrderNoResponse,
  deleteOrder,
  getAllScheduledOrders,
  getAllDamagedProducts,
  exchangeOrderItem,
  getAllWaitingStockOrders,
  markOrderDamage,
  updateManualDeliveryStatus,
  getMyScheduledOrders,
  getMyWaitingForStockOrders,
  getMyOrders,
  restoreNoResponseOrder,
  updateOrderCancelStatus,
  getAllHoldOrders,
  getMyHoldOrders,
};
