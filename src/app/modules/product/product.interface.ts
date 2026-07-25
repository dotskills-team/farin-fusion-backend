import { Types } from "mongoose";

export enum ProductStatus {
  ACTIVE = "ACTIVE",
  INACTIVE = "INACTIVE",
}

export interface IProduct {
  _id?: Types.ObjectId;
  isCusFavorite?: boolean;
  totalReturned: number;
  barcode?: string;
  lastStockUpdatedBy?: Types.ObjectId;
  lastStockUpdatedAt?: Date;
  createdBy?: Types.ObjectId;
  lastUpdatedBy?: Types.ObjectId;
  lastUpdatedAt?: Date;
  restockCount: number;
  isBestSelling?: boolean;
  // Basic Info
  title: string; // e.g., "Aveeno Baby Sunscreen"
  brand: Types.ObjectId; // Reference to Brand collection
  category: Types.ObjectId; // Reference to Category collection
  size?: string; // e.g., "88ml"
  slug?: string; // URL-friendly slug

  // Pricing
  price: number; // e.g., 2350
  discountPrice?: number; // optional discounted price
  buyingPrice?: number;

  // Stock / Availability
  totalAddedStock?: number; // Total stock ever added for this product
  totalSold?: number; // total stock sold
  availableStock?: number; // calculated as totalAddedStock - totalSold
  status: ProductStatus;
  isDeleted?: boolean;
  // Media
  images: string[]; // Array of image URLs

  // Ratings & Reviews
  ratings?: number; // average rating
  reviews?: {
    user: string;
    rating: number;
    comment: string;
    date: Date;
  }[];

  isFeatured: boolean;

  // Description
  description: string; // Full product description

  // Optional meta
  createdAt?: Date;
  updatedAt?: Date;
}
