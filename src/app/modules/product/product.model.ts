import { Schema, model, Types } from "mongoose";
import { IProduct, ProductStatus } from "./product.interface";

const reviewSchema = new Schema(
  {
    user: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
    },
    rating: {
      type: Number,
      min: 1,
      max: 5,
      required: true,
    },
    comment: {
      type: String,
    },
    date: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false },
);

const productSchema = new Schema<IProduct>(
  {
    title: {
      type: String,
      required: true,
      index: true,
    },
    slug: {
      type: String,
      unique: true,
      index: true,
    },
    isCusFavorite: {
      type: Boolean,
      default: false,
    },
    brand: {
      type: Types.ObjectId,
      ref: "Brand",
      required: true,
    },
    category: {
      type: Types.ObjectId,
      ref: "Category",
      required: true,
    },
    size: {
      type: String,
    },

    // Pricing
    price: {
      type: Number,
      required: true,
    },
    discountPrice: {
      type: Number,
    },
    buyingPrice: {
      type: Number,
    },
    totalReturned: {
      type: Number,
      default: 0,
    },

    restockCount: {
      type: Number,
      default: 0,
    },
    // Stock
    totalAddedStock: {
      type: Number,
      default: 0,
    },
    barcode: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },
    lastStockUpdatedBy: {
      type: Types.ObjectId,
      ref: "User",
      default: null,
    },

    lastStockUpdatedAt: {
      type: Date,
      default: null,
    },
     createdBy: {
      type: Types.ObjectId,
      ref: "User",
      required: false,
    },

    lastUpdatedBy: {
      type: Types.ObjectId,
      ref: "User",
      default: null,
    },

    lastUpdatedAt: {
      type: Date,
      default: null,
    },
    totalSold: {
      type: Number,
      default: 0,
    },
    availableStock: {
      type: Number,
      default: 0,
    },

    status: {
      type: String,
      enum: Object.values(ProductStatus),
      default: ProductStatus.ACTIVE,
    },
    isDeleted: { type: Boolean, default: false },
    // Media
    images: [
      {
        type: String,
        required: true,
      },
    ],

    // Ratings
    ratings: {
      type: Number,
      default: 0,
    },

    reviews: [reviewSchema],

    // Description
    description: {
      type: String,
      required: true,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    isBestSelling: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

// slug generate (same as category)
productSchema.pre("save", async function () {
  if (this.isModified("title")) {
    const baseSlug = this.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    let slug = `${baseSlug}`;

    let counter = 1;
    while (await Product.exists({ slug })) {
      slug = `${baseSlug}-${counter++}`;
    }

    this.slug = slug;
  }
});

productSchema.pre("findOneAndUpdate", async function () {
  const product = this.getUpdate() as Partial<IProduct>;

  if (product.title) {
    const baseSlug = product.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    let slug = `${baseSlug}`;

    let counter = 1;
    while (await Product.exists({ slug })) {
      slug = `${baseSlug}-${counter++}`;
    }

    product.slug = slug;
  }

  this.setUpdate(product);
});

export const Product = model<IProduct>("Product", productSchema);
