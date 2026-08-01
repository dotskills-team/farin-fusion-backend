import { Schema, model } from "mongoose";
import {
  AdvanceOption,
  DeliveryStatus,
  IOrder,
  OrderStatus,
} from "./order.interface";

// customer order Id counter
const counterSchema = new Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 1000 },
});

export const Counter = model("Counter", counterSchema);

// Order Schema
const orderSchema = new Schema<IOrder>(
  {
    customOrderId: {
      type: String,
      required: true,
      unique: true,
    },

    orderType: {
      type: String,
      enum: ["POS", "ONLINE"],
      required: true,
    },

    customer: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },

    billingDetails: {
      fullName: String,
      phone: String,
      email: String,
      address: String,
    },

    advanceDetails: {
      option: {
        type: String,
        enum: Object.values(AdvanceOption),
        required: false,
      },
      amount: {
        type: Number,
        default: 0,
        required: false,
      },
    },
    confirmedAt: {
      type: Date,
      default: null,
    },

    courierAssignedAt: {
      type: Date,
      default: null,
    },

    pickedUpAt: {
      type: Date,
      default: null,
    },

    deliveredAt: {
      type: Date,
      default: null,
    },

    partialDeliveredAt: {
      type: Date,
      default: null,
    },

    cancelledAt: {
      type: Date,
      default: null,
    },

    noResponseAt: {
      type: Date,
      default: null,
    },

    holdAt: {
      type: Date,
      default: null,
    },

    products: [
      {
        product: {
          type: Schema.Types.ObjectId,
          ref: "Product",
        },

        title: String,

        quantity: Number,

        reservedQuantity: {
          type: Number,
          default: 0,
        },

        pendingQuantity: {
          type: Number,
          default: 0,
        },

        isWaitingStock: {
          type: Boolean,
          default: false,
        },
        fulfilledAt: {
          type: Date,
          default: null,
        },

        price: Number,
      },
    ],

    partialNotes: { type: String },
    returnCount: {
      type: Number,
      default: 0,
    },

    totalReturnedQuantity: {
      type: Number,
      default: 0,
    },

    exchangeHistory: [
      {
        oldProduct: { type: Schema.Types.ObjectId, ref: "Product" },
        newProduct: { type: Schema.Types.ObjectId, ref: "Product" },
        quantity: Number,
        priceDiff: Number,
        note: String,
        createdAt: { type: Date, default: Date.now },
      },
    ],

    damageProducts: [
      {
        product: { type: Schema.Types.ObjectId, ref: "Product" },
        quantity: Number,
        note: String,
        createdAt: { type: Date, default: Date.now },
      },
    ],

    subtotal: Number,
    shippingCost: Number,
    total: Number,
    discount: Number,
    note: String,

    transactionId: String,
    payment: String,
    isDeleted: { type: Boolean, default: false },
    courierName: String,
    trackingNumber: String,

    orderStatus: {
      type: String,
      enum: Object.values(OrderStatus),
      default: OrderStatus.PENDING,
    },

    deliveryStatus: {
      type: String,
      enum: Object.values(DeliveryStatus),
      default: DeliveryStatus.NOT_SHIPPED,
    },

    scheduleType: {
      type: String,
      enum: ["INSTANT", "SCHEDULED", "HOLD"],
      default: "INSTANT",
    },

    scheduledAt: {
      type: Date,
    },

    isPublished: {
      type: Boolean,
      default: true,
    },

    isRestocked: {
      type: Boolean,
      default: false,
    },

    stockReservationCompleted: {
      type: Boolean,
      default: true,
    },

    waitingStockResolvedAt: {
      type: Date,
      default: null,
    },

    seller: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },

    confirmedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  },
);

export const Order = model<IOrder>("Order", orderSchema);
