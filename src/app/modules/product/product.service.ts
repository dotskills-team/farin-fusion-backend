import httpStatus from "http-status-codes";
import AppError from "../../errorHelpers/appError";
import { Product } from "./product.model";
import { productSearchableFields } from "./product.constants";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { deleteImageFromCloudinary } from "../../config/cloudinary.config";
import mongoose from "mongoose";
import { ICategory } from "../category/category.interface";
import { IProduct } from "./product.interface";
import { JwtPayload } from "jsonwebtoken";
import { Order } from "../order/order.model";
import { Category } from "../category/category.model";
import { Brand } from "../brand/brand.model";
import { onProductStockIncreased } from "../order/order.stock";

const generateUniqueBarcode = async () => {
  let barcode = "";
  let exists = true;

  while (exists) {
    barcode = `FF${Date.now()}${Math.floor(Math.random() * 9999)}`;

    exists = !!(await Product.findOne({ barcode }));
  }

  return barcode;
};

const assignMissingBarcodes = async () => {
  const products = await Product.find({
    $or: [{ barcode: { $exists: false } }, { barcode: null }, { barcode: "" }],
  });

  let updatedCount = 0;

  for (const product of products) {
    product.barcode = await generateUniqueBarcode();
    await product.save();
    updatedCount++;
  }

  return {
    updatedCount,
  };
};

// const createProductService = async (payload: Partial<IProduct>) => {
//   const isProductExist = await Product.findOne({ name: payload.title });
//   if (isProductExist) {
//     throw new AppError(httpStatus.CONFLICT, "Product with this title already exists");
//   }

//   const totalAddedStock = payload.totalAddedStock || 0;
//   const totalSold = payload.totalSold || 0;

//   payload.availableStock = totalAddedStock - totalSold;

//   const product = await Product.create(payload);
//   return product;
// };

const createProductService = async (
  payload: Partial<IProduct>,
  user: JwtPayload,
) => {
  const isProductExist = await Product.findOne({ title: payload.title });

  const availableStock = payload.availableStock ?? 0;

  payload.availableStock = availableStock;
  payload.totalAddedStock = availableStock;
  payload.totalSold = 0;
  payload.isFeatured = false;

  if (user.role !== "ADMIN") {
    delete payload.buyingPrice;
  }

  payload.createdBy = new mongoose.Types.ObjectId(user.userId);

  const product = await Product.create(payload);
  return product;
};

// const updateProduct = async (
//   productId: string,
//   payload: Partial<IProduct>
// ) => {
//   const existingProduct = await Product.findById(productId);

//   if (!existingProduct) {
//     throw new AppError(httpStatus.NOT_FOUND, "Product not found");
//   }

//     if (payload.totalAddedStock !== undefined || payload.totalSold !== undefined) {

//     const product = await Product.findById(productId);

//     const totalAddedStock = payload.totalAddedStock ?? product?.totalAddedStock ?? 0;
//     const totalSold = payload.totalSold ?? product?.totalSold ?? 0;

//     payload.availableStock = totalAddedStock - totalSold;
//   }

//   const updatedProduct = await Product.findByIdAndUpdate(
//     productId,
//     payload,
//     { new: true, runValidators: true }
//   );

//   return updatedProduct;

// };

const updateProduct = async (
  productId: string,
  payload: Partial<IProduct>,
  user: JwtPayload,
) => {
  const product = await Product.findById(productId);
  if (!product) {
    throw new AppError(httpStatus.NOT_FOUND, "Product not found");
  }

  // your code override the totalAddedStock
  // if (payload?.totalAddedStock !== undefined) {
  //   product.availableStock = payload.totalAddedStock;
  // }

  product.lastUpdatedBy = new mongoose.Types.ObjectId(user.userId);
  product.lastUpdatedAt = new Date();
  const stockChanged = payload.totalAddedStock !== undefined;
  const stockChange = stockChanged ? Number(payload.totalAddedStock) : 0;

  // STOCK UPDATE
  if (payload?.totalAddedStock !== undefined) {
    if (stockChanged) {
      const newTotalAddedStock = (product.totalAddedStock || 0) + stockChange;

      const newAvailableStock = (product.availableStock || 0) + stockChange;

      if (newTotalAddedStock < 0 || newAvailableStock < 0) {
        throw new AppError(httpStatus.BAD_REQUEST, "Stock cannot be negative");
      }

      product.totalAddedStock = newTotalAddedStock;
      product.availableStock = newAvailableStock;

      product.lastStockUpdatedBy = new mongoose.Types.ObjectId(user.userId);
      product.lastStockUpdatedAt = new Date();

      delete payload.totalAddedStock;
    }
  }

  if (payload.images) {
    const deletedImages = (product.images || []).filter(
      (img) => !payload.images!.includes(img),
    );

    await Promise.all(
      deletedImages.map((img) => deleteImageFromCloudinary(img)),
    );

    product.images = payload.images;
  }

  if (user.role !== "ADMIN") {
    delete payload.buyingPrice;
  }

  const updatableFields = { ...payload };
  Object.assign(product, updatableFields);

  await product.save();

  if (stockChanged && stockChange > 0) {
    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      await onProductStockIncreased(product._id, session);

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }
  return product;
};

const getSingleProduct = async (slug: string) => {
  const product = await Product.findOne({ slug })
    .populate("category", "title slug")
    .populate("brand", "title slug")
    .populate("createdBy", "name email phone role profileImage")
    .populate("lastUpdatedBy", "name email phone role profileImage")
    .populate(
      "lastStockUpdatedBy",
      "name fullName firstName lastName email phone role profileImage",
    );

  if (!product) {
    throw new AppError(httpStatus.NOT_FOUND, "Product Not Found");
  }

  const sales = await Order.aggregate([
    {
      $match: {
        isDeleted: false,
        isPublished: true,
        orderStatus: {
          $ne: "CANCELLED",
        },
      },
    },
    { $unwind: "$products" },
    {
      $match: {
        "products.product": product._id,
      },
    },
    {
      $group: {
        _id: "$products.product",
        totalSold: { $sum: "$products.quantity" },
        totalRevenue: {
          $sum: {
            $cond: [
              {
                $eq: ["$orderStatus", "COMPLETED"],
              },
              {
                $multiply: ["$products.price", "$products.quantity"],
              },
              0,
            ],
          },
        },
      },
    },
  ]);

  const totalSold = sales[0]?.totalSold || 0;
  const totalRevenue = sales[0]?.totalRevenue || 0;

  const plain = product.toObject();

  const availableStock = Math.max((plain.totalAddedStock || 0) - totalSold, 0);

  return {
    data: {
      ...plain,
      totalSold: plain.totalSold || 0,
      totalRevenue,
      availableStock: plain.availableStock || 0,
    },
  };
};

const deleteProduct = async (id: string) => {
  const product = await Product.findById(id);
  if (!product) {
    throw new AppError(httpStatus.NOT_FOUND, "Product Not Found");
  }

  if (product.images && product.images.length > 0) {
    await Promise.all(
      product.images.map((image) => deleteImageFromCloudinary(image)),
    );
  }

  await Product.findByIdAndDelete(id);

  return { data: null };
};

const getAllProducts = async (query: Record<string, string>) => {
  const orderMatch: any = {
    isDeleted: false,
    isPublished: true,
  };

  const sales = await Order.aggregate([
    {
      $match: {
        ...orderMatch,
        orderStatus: {
          $ne: "CANCELLED",
        },
      },
    },
    { $unwind: "$products" },
    {
      $group: {
        _id: "$products.product",
        totalSold: { $sum: "$products.quantity" },
        totalRevenue: {
          $sum: {
            $cond: [
              {
                $eq: ["$orderStatus", "COMPLETED"],
              },
              {
                $multiply: ["$products.price", "$products.quantity"],
              },
              0,
            ],
          },
        },
      },
    },
  ]);

  const salesMap = new Map();
  sales.forEach((item) => {
    salesMap.set(item._id.toString(), item);
  });

  // PRODUCT QUERY
  const productQuery: any = {
    isDeleted: false,
  };

  if (query["createdAt[gte]"] || query["createdAt[lte]"]) {
    productQuery.createdAt = {};

    if (query["createdAt[gte]"]) {
      productQuery.createdAt.$gte = new Date(query["createdAt[gte]"]);
    }

    if (query["createdAt[lte]"]) {
      productQuery.createdAt.$lte = new Date(query["createdAt[lte]"]);
    }
  }

  // STOCK FILTER
  if (query.stockFilter === "outOfStock") {
    productQuery.availableStock = {
      $lte: 0,
    };
  }

  if (query.stockFilter === "lowStock") {
    productQuery.availableStock = {
      $gt: 0,
      $lte: 5,
    };
  }

  if (query.stockFilter === "inStock") {
    productQuery.availableStock = {
      $gt: 5,
    };
  }

  if (query.isBestSelling === "true") {
    productQuery.isBestSelling = true;
  }

  // SAVE SORT VALUE
  const sortValue = query.sort;

  // REMOVE SPECIAL FIELDS
  delete query["createdAt[gte]"];
  delete query["createdAt[lte]"];
  delete query.stockFilter;

  // PRICE FILTER
  if (query["price[gte]"] || query["price[lte]"]) {
    const minPrice = Number(query["price[gte]"] || 0);
    const maxPrice = Number(query["price[lte]"] || Infinity);

    productQuery.$expr = {
      $and: [
        {
          $gte: [
            {
              $cond: [
                {
                  $and: [
                    { $ne: ["$discountPrice", null] },
                    { $gt: ["$discountPrice", 0] },
                  ],
                },
                "$discountPrice",
                "$price",
              ],
            },
            minPrice,
          ],
        },
        {
          $lte: [
            {
              $cond: [
                {
                  $and: [
                    { $ne: ["$discountPrice", null] },
                    { $gt: ["$discountPrice", 0] },
                  ],
                },
                "$discountPrice",
                "$price",
              ],
            },
            maxPrice,
          ],
        },
      ],
    };
  }

  // REMOVE SPECIAL FIELDS
  delete query["createdAt[gte]"];
  delete query["createdAt[lte]"];
  delete query.stockFilter;

  delete query["price[gte]"];
  delete query["price[lte]"];

  if (query.category) {
    const category = await Category.findOne({ slug: query.category });

    if (category) {
      productQuery.category = category._id;
    }

    delete query.category;
  }

  if (query.brand) {
    const brand = await Brand.findOne({ slug: query.brand });

    if (brand) {
      productQuery.brand = brand._id;
    }

    delete query.brand;
  }

  const queryBuilder = new QueryBuilder(
    Product.find(productQuery)
      .populate("category")
      .populate("brand")
      .populate("createdBy", "name email phone role profileImage")
      .populate("lastUpdatedBy", "name email phone role profileImage")
      .populate(
        "lastStockUpdatedBy",
        "name fullName firstName lastName email phone role profileImage",
      ),
    query,
  );

  const productsData = queryBuilder
    .filter()
    .search(productSearchableFields)
    .sort()
    .fields()
    .paginate();

  const [data, meta] = await Promise.all([
    productsData.build(),
    queryBuilder.getMeta(),
  ]);

  let finalData = data.map((product: any) => {
    const plain = product.toObject ? product.toObject() : product;

    const sale = salesMap.get(plain._id.toString());
    const totalSold = sale?.totalSold || 0;

    const calculatedStock = (plain.totalAddedStock || 0) - totalSold;

    const availableStock = Math.max(calculatedStock, 0);

    return {
      ...plain,
      totalSold: plain.totalSold || 0,
      availableStock: plain.availableStock || 0,
      totalRevenue: sale?.totalRevenue || 0,
    };
  });

  // CUSTOM PRICE SORT
  if (sortValue === "price") {
    finalData = finalData.sort((a: any, b: any) => {
      const aPrice =
        a.discountPrice && a.discountPrice > 0 ? a.discountPrice : a.price;

      const bPrice =
        b.discountPrice && b.discountPrice > 0 ? b.discountPrice : b.price;

      return aPrice - bPrice;
    });
  }

  if (sortValue === "-price") {
    finalData = finalData.sort((a: any, b: any) => {
      const aPrice =
        a.discountPrice && a.discountPrice > 0 ? a.discountPrice : a.price;

      const bPrice =
        b.discountPrice && b.discountPrice > 0 ? b.discountPrice : b.price;

      return bPrice - aPrice;
    });
  }

  return {
    data: finalData,
    meta,
  };
};

const getAllTrashProducts = async (query: Record<string, string>) => {
  const queryObj: any = {};

  // DATE FILTER
  if (query["createdAt[gte]"] || query["createdAt[lte]"]) {
    queryObj.createdAt = {};

    if (query["createdAt[gte]"]) {
      queryObj.createdAt.$gte = new Date(query["createdAt[gte]"]);
    }

    if (query["createdAt[lte]"]) {
      queryObj.createdAt.$lte = new Date(query["createdAt[lte]"]);
    }
  }

  // REMOVE SPECIAL FIELDS
  delete query["createdAt[gte]"];
  delete query["createdAt[lte]"];

  const queryBuilder = new QueryBuilder(
    Product.find({ isDeleted: true, ...queryObj })
      .populate("category")
      .populate("brand"),
    query,
  );
  const productsData = queryBuilder
    .filter()
    .search(productSearchableFields)
    .sort()
    .fields()
    .paginate();

  const [data, meta] = await Promise.all([
    productsData.build(),
    queryBuilder.getMeta(),
  ]);

  return {
    data,
    meta,
  };
};

export const CategoryServices = {
  createProductService,
  updateProduct,
  getSingleProduct,
  deleteProduct,
  getAllProducts,
  assignMissingBarcodes,
  getAllTrashProducts,
};
