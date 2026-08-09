/* eslint-disable @typescript-eslint/no-explicit-any */

import axios from "axios";
import httpStatus from "http-status-codes";
import AppError from "../../../errorHelpers/appError";
import { Courier } from "../courier.model";
import {
  CourierDeliveryStatus,
  CourierName,
  CourierStatus,
} from "../courier.interface";
import { Order } from "../../order/order.model";
import { DeliveryStatus } from "../../order/order.interface";
import { getCourierConfig } from "./getCourierConfig";
import { CourierProvider } from "../../courierSettings/courierSettings.interface";

const MAX_PRODUCT_BRIEF_LENGTH = 200;

let paperflyConfigCache: Awaited<
  ReturnType<typeof getPaperflyCredentials>
> | null = null;

let paperflyConfigCacheTime = 0;

const PAPERFLY_CONFIG_TTL = 5 * 60 * 1000;

const getPaperflyCredentials = async () => {
  const settings = await getCourierConfig(CourierProvider.PAPERFLY);

  if (
    !settings.config.baseUrl ||
    !settings.config.username ||
    !settings.config.password ||
    !settings.config.apiKey
  ) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Paperfly credentials are incomplete",
    );
  }

  return {
    baseUrl: settings.config.baseUrl,
    auth: {
      username: settings.config.username,
      password: settings.config.password,
    },
    headers: {
      paperflykey: settings.config.apiKey,
      "Content-Type": "application/json",
    },
    pickupInfo: settings.pickupInfo,
    isSandbox: settings.isSandbox,
  };
};

const getCachedPaperflyCredentials = async () => {
  const now = Date.now();

  if (
    paperflyConfigCache &&
    now - paperflyConfigCacheTime < PAPERFLY_CONFIG_TTL
  ) {
    return paperflyConfigCache;
  }

  const config = await getPaperflyCredentials();

  paperflyConfigCache = config;
  paperflyConfigCacheTime = now;

  return config;
};

const buildProductDescription = (products: any[], maxLength: number) => {
  let parts = products.map((p: any) => ({
    name: p.product?.title || "Item",
    qty: p.quantity || 1,
  }));

  const buildText = (items: any[]) =>
    items.map((p) => `${p.name} x${p.qty}`).join(", ");

  let description = buildText(parts);

  if (description.length <= maxLength) {
    return description;
  }

  const totalNamesLength = parts.reduce(
    (sum: number, p: any) => sum + p.name.length,
    0,
  );

  const reservedLength = parts.length * 6;
  const availableForNames = maxLength - reservedLength;

  const shrinkRatio = availableForNames / totalNamesLength;

  const minLength = 5;

  parts = parts.map((p: any) => {
    let newLen = Math.floor(p.name.length * shrinkRatio);

    if (newLen < minLength) {
      newLen = minLength;
    }

    if (newLen < p.name.length) {
      return {
        ...p,
        name: p.name.slice(0, Math.max(newLen - 3, 1)) + "...",
      };
    }

    return p;
  });

  description = buildText(parts);

  if (description.length > maxLength) {
    description = description.slice(0, maxLength - 3) + "...";
  }

  return description;
};

const mapPaperflyStatus = (statusObj: any): CourierDeliveryStatus => {
  if (!statusObj) {
    return CourierDeliveryStatus.PENDING;
  }

  if (statusObj.Delivered) {
    return CourierDeliveryStatus.DELIVERED;
  }

  if (statusObj.Partial) {
    return CourierDeliveryStatus.PARTIAL;
  }

  if (statusObj.Returned || statusObj.close) {
    return CourierDeliveryStatus.CANCELLED;
  }

  if (statusObj.onHoldSchedule) {
    return CourierDeliveryStatus.HOLD;
  }

  if (statusObj.PickedForDelivery) {
    return CourierDeliveryStatus.PICKED_UP;
  }

  if (statusObj.inTransit || statusObj.ReceivedAtPoint || statusObj.Pick) {
    return CourierDeliveryStatus.IN_TRANSIT;
  }

  return CourierDeliveryStatus.PENDING;
};

const mapOrderToPaperfly = (order: any, merchantReference: string) => {
  const products = order.products || [];

  const productBrief = buildProductDescription(
    products,
    MAX_PRODUCT_BRIEF_LENGTH,
  );

  return {
    merchantOrderReference: merchantReference,
    storeName: "Farin Fusion",
    productBrief: productBrief || "Customer Order",
    packagePrice: order.total,
    max_weight: "1",
    customerName: order.billingDetails?.fullName,
    customerAddress: order.billingDetails?.address,
    customerPhone: order.billingDetails?.phone,
  };
};

const createCourier = async (orderId: string, courierId?: string) => {
  const order = await Order.findById(orderId)
    .select(
      "_id customOrderId total billingDetails products courierName trackingNumber courierAssignedAt",
    )
    .populate({
      path: "products.product",
      select: "title",
    });

  if (!order) {
    throw new AppError(httpStatus.NOT_FOUND, "Order not found");
  }

  const [reassignCount, activeCourier] = await Promise.all([
    Courier.countDocuments({
      order: order._id,
      courierName: CourierName.PAPERFLY,
    }),

    Courier.findOne({
      order: order._id,
      courierName: CourierName.PAPERFLY,
      status: {
        $ne: CourierStatus.CANCELLED,
      },
      isDeleted: {
        $ne: true,
      },
    }).sort({ createdAt: -1 }),
  ]);

  const merchantReference =
    reassignCount === 0
      ? `${order.customOrderId ?? ""}`
      : `${order.customOrderId}-R${String(reassignCount).padStart(4, "0")}`;

  const payload = mapOrderToPaperfly(order, merchantReference);

  try {
    const config = await getCachedPaperflyCredentials();

    const response = await axios.post(
      `${config.baseUrl}/merchant/api/service/new_order_v2.php`,
      payload,
      {
        auth: config.auth,
        headers: config.headers,

        timeout: 15000,
      },
    );

    const success = response.data?.success;

    if (!success) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        response.data?.message || "Paperfly courier creation failed",
      );
    }

    if (activeCourier && activeCourier._id.toString() !== courierId) {
      await Courier.findByIdAndUpdate(activeCourier._id, {
        status: CourierStatus.CANCELLED,
        deliveryStatus: CourierDeliveryStatus.CANCELLED,
      });
    }

    const courier = courierId
      ? await Courier.findByIdAndUpdate(
          courierId,
          {
            status: CourierStatus.CREATED,
            deliveryStatus: CourierDeliveryStatus.PENDING,

            trackingCode: success.tracking_number,

            consignmentId: success.tracking_barcode,

            trackingBarcode: success.tracking_barcode,

            merchantOrderReference: merchantReference,

            rawResponse: response.data,
          },
          {
            new: true,
          },
        )
      : await Courier.create({
          order: order._id,
          courierName: CourierName.PAPERFLY,

          status: CourierStatus.CREATED,

          deliveryStatus: CourierDeliveryStatus.PENDING,

          trackingCode: success.tracking_number,

          consignmentId: success.tracking_barcode,

          trackingBarcode: success.tracking_barcode,

          merchantOrderReference: merchantReference,

          rawResponse: response.data,
        });

    await Order.findByIdAndUpdate(order._id, {
      courierName: CourierName.PAPERFLY,

      trackingNumber: success.tracking_number,

      deliveryStatus: DeliveryStatus.COURIERASSIGNED,

      ...(!order.courierAssignedAt && {
        courierAssignedAt: new Date(),
      }),
    });

    return courier;
  } catch (error: any) {
    console.error(
      "Paperfly courier creation failed:",
      error?.response?.data || error,
    );

    if (courierId) {
      await Courier.findByIdAndUpdate(courierId, {
        status: CourierStatus.FAILED,
        deliveryStatus: CourierDeliveryStatus.CANCELLED,

        rawResponse: {
          error:
            error?.response?.data ||
            error?.message ||
            "Paperfly courier creation failed",
        },
      });
    }

    throw new AppError(
      httpStatus.BAD_REQUEST,
      error?.response?.data?.error?.message ||
        error?.response?.data?.message ||
        error?.message ||
        "Paperfly courier creation failed",
    );
  }
};

const trackCourier = async (trackingCode: string) => {
  const courier = await Courier.findOne({
    trackingCode,
    courierName: CourierName.PAPERFLY,
  });

  if (!courier) {
    throw new AppError(httpStatus.NOT_FOUND, "Paperfly courier not found");
  }

  const referenceNumber =
    courier.merchantOrderReference || courier.trackingCode;

  try {
    const config = await getCachedPaperflyCredentials();

    const response = await axios.post(
      `${config.baseUrl}/API-Order-Tracking`,
      {
        ReferenceNumber: referenceNumber,
      },
      {
        auth: config.auth,
        headers: config.headers,
        timeout: 10000,
      },
    );

    const tracking = response.data?.success?.trackingStatus?.[0];

    if (!tracking) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Invalid Paperfly tracking response",
      );
    }

    const mappedStatus = mapPaperflyStatus(tracking);

    courier.rawResponse = response.data;

    if (courier.deliveryStatus !== mappedStatus) {
      courier.deliveryStatus = mappedStatus;

      await courier.save();
    } else {
      await courier.save();
    }

    return courier;
  } catch (error: any) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      error?.response?.data?.error?.message ||
        error?.response?.data?.message ||
        error?.message ||
        "Paperfly tracking failed",
    );
  }
};

export const PaperflyProvider = {
  createCourier,
  trackCourier,
};
