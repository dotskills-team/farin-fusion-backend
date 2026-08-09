import { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import httpStatus from "http-status-codes";
import { Courier } from "./courier.model";
import { getCourierProvider } from "./providers/courier.factory";
import { CourierDeliveryStatus, CourierName, CourierStatus } from "./courier.interface";

const createCourier = catchAsync(async (req: Request, res: Response) => {
  const { orderId, courierName } = req.body;

  if (!orderId || !courierName) {
    return sendResponse(res, {
      statusCode: httpStatus.BAD_REQUEST,
      success: false,
      message: "orderId and courierName are required",
      data: null,
    });
  }

  const provider = getCourierProvider(courierName as CourierName);

  const pendingCourier = await Courier.findOne({
    order: orderId,
    courierName,
    status: CourierStatus.PENDING,
    isDeleted: { $ne: true },
  }).sort({ createdAt: -1 });

  if (pendingCourier) {
    return sendResponse(res, {
      statusCode: httpStatus.ACCEPTED,
      success: true,
      message: `${courierName} courier assignment is already processing`,
      data: pendingCourier,
    });
  }

  const courier = await Courier.create({
    order: orderId,
    courierName: courierName as CourierName,
    status: CourierStatus.PENDING,
    deliveryStatus: CourierDeliveryStatus.PENDING,
  });

  setImmediate(async () => {
    try {
      await provider.createCourier(
        orderId,
        courier?._id?.toString() as string,
      );
    } catch (error) {
      console.error(
        `[${courierName}] background courier creation failed:`,
        error,
      );

      await Courier.findByIdAndUpdate(courier._id, {
        status: CourierStatus.FAILED,
        deliveryStatus: CourierDeliveryStatus.CANCELLED,
        rawResponse: {
          error:
            error instanceof Error
              ? error.message
              : "Courier creation failed",
        },
      });
    }
  });

  return sendResponse(res, {
    statusCode: httpStatus.ACCEPTED,
    success: true,
    message: `${courierName} courier assignment started`,
    data: courier,
  });
});

const trackCourier = catchAsync(async (req: Request, res: Response) => {
  const { trackingCode } = req.params;

  const courier = await Courier.findOne({
    trackingCode,
  });

  if (!courier) {
    return sendResponse(res, {
      statusCode: httpStatus.NOT_FOUND,
      success: false,
      message: "Courier not found",
      data: null,
    });
  }

  const provider = getCourierProvider(courier.courierName);

  const result = await provider.trackCourier(trackingCode as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Tracking fetched successfully",
    data: result,
  });
});

const getCourierByOrderId = catchAsync(async (req, res) => {
  const { orderId } = req.params;

  const result = await Courier.findOne({
    order: orderId,
    status: { $ne: CourierStatus.FAILED },
  }).sort({ createdAt: -1 });

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Courier fetched successfully",
    data: result,
  });
});

const getSingleCourier = catchAsync(async (req, res) => {
  const result = await Courier.findById(req.params.id);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Courier fetched successfully",
    data: result,
  });
});

const getAllCouriers = catchAsync(async (req, res) => {
  const couriers = await Courier.find();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Couriers fetched successfully",
    data: couriers,
  });
});

export const CourierControllers = {
  createCourier,
  trackCourier,
  getAllCouriers,
  getSingleCourier,
  getCourierByOrderId,
};
