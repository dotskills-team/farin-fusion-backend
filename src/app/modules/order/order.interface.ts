import { Types } from "mongoose";

export enum OrderType {
  POS = "POS",
  ONLINE = "ONLINE",
}

export enum OrderStatus {
  PENDING = "PENDING",
  RESPONDED = "RESPONDED",
  COMPLETED = "COMPLETED",
  WAITING_FOR_STOCK = "WAITING_FOR_STOCK",
  CONFIRMED = "CONFIRMED",
  PARTIAL = "PARTIAL",
  PROCESSING = "PROCESSING",
  SHIPPED = "SHIPPED",
  DELIVERED = "DELIVERED",
  CANCELLED = "CANCELLED",
  DAMAGE = "DAMAGE",
  NO_RESPONSE = "NO_RESPONSE",
}

export enum DeliveryStatus {
  PENDING = "PENDING",
  PICKED_UP = "PICKED_UP",
  HOLD = "HOLD",
  COURIERASSIGNED = "COURIERASSIGNED",
  NOT_SHIPPED = "NOT_SHIPPED",
  IN_TRANSIT = "IN_TRANSIT",
  DELIVERED = "DELIVERED",
  RETURNED = "RETURNED",
  CANCELLED = "CANCELLED",
  IN_REVIEW = "IN_REVIEW",
}

export enum AdvanceOption {
  BKASH = "bkash",
  NAGAD = "nagad",
  ROCKET = "rocket",
  UPay = "upay",
  BANK = "bank_transfer",
  VISA = "visa",
  MASTERCARD = "master_card",
  CASH = "cash",
}

export interface IOrderProduct {
  product: Types.ObjectId;
  quantity: number;
  reservedQuantity?: number;
  pendingQuantity?: number;
  isWaitingStock?: boolean;
  title?: string;
  price: number;
  lineTotal?: number;
  fulfilledAt?: Date;
}

export interface IBillingDetails {
  fullName: string;
  phone: string;
  email?: string;
  address: string;
}

export interface IOrder {
  _id?: Types.ObjectId;
  customOrderId?: number;
  scheduleType?: string;
  scheduledAt?: Date;
  isPublished?: boolean;
  returnCount?: number;
  totalReturnedQuantity?: number;
  confirmedAt?: Date;
  courierAssignedAt?: Date;
  pickedUpAt?: Date;
  holdAt?: Date;
  deliveredAt?: Date;
  stockReservationCompleted?: boolean;

  waitingStockResolvedAt?: Date | null;
  partialDeliveredAt?: Date;
  cancelledAt?: Date;
  noResponseAt?: Date | null;
  orderType: OrderType;
  exchangeHistory?: any[];
  damageProducts?: any[];

  customer?: Types.ObjectId;
  partialNotes?: string;

  billingDetails?: IBillingDetails;

  products: IOrderProduct[];

  advanceDetails?: {
    option?: AdvanceOption;
    amount?: number;
  };

  subtotal: number;
  discount: number;
  shippingCost: number;
  note: string;
  total: number;

  transactionId?: string;
  payment?: string;
  isRestocked?: boolean;

  courierName?: string;
  trackingNumber?: string;

  orderStatus: OrderStatus;
  deliveryStatus: DeliveryStatus;
  isDeleted?: boolean;
  seller?: Types.ObjectId;

  confirmedBy?: Types.ObjectId | null;

  createdAt?: Date;
  updatedAt?: Date;
}
