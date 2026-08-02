import { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import httpStatus from "http-status-codes";
import { OrderServices } from "./order.service";
import { Product } from "../product/product.model";
import { Order } from "./order.model";
import mongoose from "mongoose";

const createOrder = catchAsync(async (req: Request, res: Response) => {
  const payload = req.body;

  const createdOrder = await OrderServices.createOrder(payload);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Order created successfully",
    data: createdOrder,
  });
});

const getMyOrders = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.userId;
  const query = req.query as Record<string, string>;

  const result = await OrderServices.getMyOrders(userId, query);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Orders Retrieved Successfully",
    meta: result.meta,
    data: result.data,
    stats: result.stats || { total: 0, PENDING: 0, CONFIRMED: 0, COMPLETED: 0, CANCELLED: 0 },
  });
});

const getAllOrders = catchAsync(async (req: Request, res: Response) => {
  const query = req.query as Record<string, string>;

  const result = await OrderServices.getAllOrders(query);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "All Orders Retrieved Successfully",
    meta: result.meta,
    data: result.data,
    stats: result.stats || { total: 0, PENDING: 0, CONFIRMED: 0, COMPLETED: 0, CANCELLED: 0 },
  });
});

const getAllTrashOrders = catchAsync(async (req: Request, res: Response) => {
  const query = req.query as Record<string, string>;

  const result = await OrderServices.getAllTrashOrders(query);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "All Trash Orders Retrieved Successfully",
    meta: result.meta,
    data: result.data,
  });
});

const getSingleOrder = catchAsync(async (req: Request, res: Response) => {
  const orderId = req.params.id as string;

  const result = await OrderServices.getSingleOrder(orderId);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Order Retrieved Successfully",
    data: result,
  });
});

const updateOrderCancelStatus = catchAsync(
  async (req: Request, res: Response) => {
    const orderId = req.params.id;
    const { orderStatus, deliveryStatus } = req.body;

    const result = await OrderServices.updateOrderCancelStatus(
      orderId as string,
      {
        orderStatus,
        deliveryStatus,
      },
    );

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.OK,
      message: "Order status updated successfully",
      data: result,
    });
  },
);

const updateOrderStatus = catchAsync(async (req: Request, res: Response) => {
  const orderId = req.params.id;
  const { orderStatus } = req.body;
  const user = req.user;

  const result = await OrderServices.updateOrderStatus(
    orderId as string,
    orderStatus,
    user,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Order status updated successfully",
    data: result,
  });
});

const updateOrder = catchAsync(async (req: Request, res: Response) => {
  const orderId = req.params.id as string;
  const payload = req.body;

  const result = await OrderServices.updateOrder(orderId, payload);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Order Updated Successfully",
    data: result,
  });
});

const assignSeller = catchAsync(async (req: Request, res: Response) => {
  const orderId = req.params.id as string;
  const { seller } = req.body;

  // console.log("Seller ID in Controller:", seller, orderId);

  const result = await OrderServices.assignSeller(orderId, seller);

  sendResponse(res, {
    success: true,
    statusCode: 200,
    message: "Seller assigned successfully",
    data: result,
  });
});

const getMyScheduledOrders = catchAsync(async (req, res) => {
  const user = req.user;

  const result = await OrderServices.getMyScheduledOrders(
    user.userId,
    req.query as Record<string, string>,
  );

  sendResponse(res, {
    success: true,
    statusCode: 200,
    message: "My scheduled orders retrieved",
    data: result.data,
    meta: result.meta,
  });
});

const getCustomerOrder = catchAsync(async (req, res) => {
  const phone = req.body;
  const result = await OrderServices.checkCustomerOrder(phone);

  sendResponse(res, {
    success: true,
    statusCode: 200,
    message: "Customer order retrieved",
    data: result,
  });
});

const getAllWaitingStockOrders = catchAsync(async(req,res)=>{
    const result = await OrderServices.getAllWaitingStockOrders(req.query as Record<string, string>);

    sendResponse(res,{
        success:true,
        statusCode:httpStatus.OK,
        message:"Waiting stock orders retrieved successfully",
        data:result.data,
        meta:result.meta,
    });
});

const getAllScheduledOrders = catchAsync(async (req, res) => {
  const result = await OrderServices.getAllScheduledOrders(
    req.query as Record<string, string>,
  );

  sendResponse(res, {
    success: true,
    statusCode: 200,
    message: "Scheduled orders retrieved",
    data: result.data,
    meta: result.meta,
    stats: result.stats || { total: 0, PENDING: 0, CONFIRMED: 0, COMPLETED: 0, CANCELLED: 0 },
  });
});

const getMyWaitingForStockOrders = catchAsync(async (req, res) => {
  const result = await OrderServices.getMyWaitingForStockOrders(
    req.user.userId,
    req.query as Record<string, string>,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Waiting for stock orders retrieved successfully",
    data: result.data,
    meta: result.meta,
    stats: result.stats,
  });
});

const updateCompleteOrder = catchAsync(async (req: Request, res: Response) => {
  const orderId = req.params.id as string;
  const { orderStatus } = req.body;
  const user = req.user;

  const result = await OrderServices.updateOrderStatus(
    orderId,
    orderStatus,
    user,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Order status changed to completed",
    data: result,
  });
});

const restoreNoResponseOrder = catchAsync(
  async (req: Request, res: Response) => {
    const result = await OrderServices.restoreNoResponseOrder(
      req.params.id as string,
    );

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.OK,
      message: "Order restored successfully",
      data: result,
    });
  },
);

const markNoResponse = catchAsync(async (req, res) => {
  const result = await OrderServices.markOrderNoResponse(
    req.params.id as string,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Order marked as no response successfully",
    data: result,
  });
});

const getAllNoResponseOrders = catchAsync(async (req, res) => {
  const result = await OrderServices.getAllNoResponseOrders(
    req.query as Record<string, string>,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "No response orders retrieved successfully",
    data: result.data,
    meta: result.meta,
  });
});

const deleteOrder = catchAsync(async (req: Request, res: Response) => {
  const orderId = req.params.id as string;

  const result = await OrderServices.deleteOrder(orderId);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Order Deleted Successfully",
    data: result,
  });
});

export const partialUpdateOrder = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();

  session.startTransaction();

  const { orderId, removeItems, addItems, note } = req.body;

  const order = await Order.findById(orderId).session(session);

  if (!order) {
    throw new Error("Order not found");
  }

  for (const r of removeItems) {
    const item = order.products[r.itemIndex];

    if (!item) throw new Error("Invalid item index");

    if (r.quantity > item.quantity) {
      throw new Error("Invalid remove quantity");
    }

    // reduce quantity
    item.quantity -= r.quantity;

    // restore stock
    await Product.findByIdAndUpdate(
      item.product,
      { $inc: { stock: r.quantity } },
      { session },
    );

    // remove if zero
    if (item.quantity === 0) {
      order.products.splice(r.itemIndex, 1);
    }
  }

  for (const a of addItems) {
    const product = await Product.findById(a.productId).session(session);

    if (!product) throw new Error("Product not found");

    if ((product.availableStock ?? 0) < a.quantity) {
      throw new Error("Insufficient stock");
    }

    // reduce stock
    product.availableStock = (product.availableStock ?? 0) - a.quantity;
    await product.save({ session });

    // push item
    order.products.push({
      product: product._id,
      title: product.title,
      price: product.price,
      quantity: a.quantity,
    });
  }

  order.total = order.products.reduce(
    (sum, i) => sum + i.price * i.quantity,
    0,
  );

  order.partialNotes = note || "";

  await order.save({ session });

  await session.commitTransaction();
  session.endSession();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Order partially updated",
    data: order,
  });
};

const exchangeOrderItem = catchAsync(async (req: Request, res: Response) => {
  const { orderId, itemIndex, newProductId, note } = req.body;

  const result = await OrderServices.exchangeOrderItem({
    orderId,
    itemIndex,
    newProductId,
    note,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Product exchanged successfully",
    data: result,
  });
});

const getAllDamagedProducts = catchAsync(
  async (req: Request, res: Response) => {
    const result = await OrderServices.getAllDamagedProducts();

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.OK,
      message: "Damaged products retrieved successfully",
      data: result,
    });
  },
);

const markOrderDamage = catchAsync(async (req: Request, res: Response) => {
  const { orderId, itemIndex, quantity, note } = req.body;

  const result = await OrderServices.markOrderDamage({
    orderId,
    itemIndex,
    quantity,
    note,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Order marked as damaged",
    data: result,
  });
});

const getMyHoldOrders = catchAsync(async (req, res) => {
  const user = req.user;

  const result = await OrderServices.getMyHoldOrders(
    user.userId,
    req.query as Record<string, string>,
  );

  sendResponse(res, {
    success: true,
    statusCode: 200,
    message: "My Hold orders retrieved",
    data: result.data,
    meta: result.meta,
  });
});

const getAllHoldOrders = catchAsync(async (req, res) => {
  const result = await OrderServices.getAllHoldOrders(
    req.query as Record<string, string>,
  );

  sendResponse(res, {
    success: true,
    statusCode: 200,
    message: "Hold orders retrieved",
    data: result.data,
    meta: result.meta,
    stats: result.stats,
  });
});

const updateManualDeliveryStatus = catchAsync(async (req, res) => {
  const result = await OrderServices.updateManualDeliveryStatus(
    req.params.id as string,
    req.body.deliveryStatus,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Delivery status updated successfully",
    data: result,
  });
});

export const OrderControllers = {
  createOrder,
  getMyOrders,
  updateManualDeliveryStatus,
  getAllOrders,
  getAllTrashOrders,
  getSingleOrder,
  getAllNoResponseOrders,
  updateOrder,
  updateCompleteOrder,
  assignSeller,
  getAllScheduledOrders,
  getAllDamagedProducts,
  exchangeOrderItem,
  markOrderDamage,
  getMyScheduledOrders,
  deleteOrder,
  getCustomerOrder,
  updateOrderCancelStatus,
  updateOrderStatus,
  partialUpdateOrder,
  markNoResponse,
  restoreNoResponseOrder,
  getAllWaitingStockOrders,
  getMyHoldOrders,
  getMyWaitingForStockOrders,
  getAllHoldOrders,
};
