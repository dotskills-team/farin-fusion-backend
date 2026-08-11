import { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import httpStatus from "http-status-codes";
import { Courier } from "./courier.model";
import { getCourierProvider } from "./providers/courier.factory";
import { CourierDeliveryStatus, CourierName, CourierStatus } from "./courier.interface";

const createCourier = catchAsync(async (req: Request, res: Response) => {
  const { orderId, courierName } = req.body;

  const provider = getCourierProvider(courierName as CourierName);

  const result = await provider.createCourier(orderId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: `${courierName} courier created successfully`,
    data: result,
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
