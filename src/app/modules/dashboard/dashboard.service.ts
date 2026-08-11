import { Order } from "../order/order.model";
import { User } from "../user/user.model";
import { Product } from "../product/product.model";
import { Payment } from "../payment/payment.model";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/appError";
import httpStatus from "http-status-codes";
import { Role } from "../user/user.interface";

const getDashboardOverview = async (
  userId: string,
  role: string,
  query: Record<string, string>,
) => {
  const queryObj: any = {};

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

  if (query.deliveryStatus) {
    queryObj.deliveryStatus = query.deliveryStatus;
  }

  let matchCondition: any = {
    isDeleted: false,
    isPublished: true,
    ...queryObj,
  };

  let staffPerformance = undefined;
  let myPerformance = undefined;

  const productCostAgg = await Order.aggregate([
    {
      $match: {
        ...matchCondition,
        orderStatus: { $in: ["COMPLETED", "PARTIAL"] },
      },
    },
    { $unwind: "$products" },
    {
      $lookup: {
        from: "products",
        localField: "products.product",
        foreignField: "_id",
        as: "productData",
      },
    },
    { $unwind: "$productData" },
    {
      $group: {
        _id: null,
        totalCost: {
          $sum: {
            $multiply: [
              "$products.quantity",
              { $ifNull: ["$productData.buyingPrice", 0] },
            ],
          },
        },
      },
    },
  ]);

  // const totalProductCost = productCostAgg[0]?.totalCost || 0;

  const salaryAgg = await User.aggregate([
    {
      $match: {
        role: { $in: ["ADMIN", "MANAGER", "MODERATOR", "TELESALES"] },
        isDeleted: false,
      },
    },
    {
      $group: {
        _id: null,
        totalSalary: {
          $sum: { $ifNull: ["$salary", 0] },
        },
      },
    },
  ]);

  const totalSalary = salaryAgg[0]?.totalSalary || 0;
  let mySalary = 0;

  if (role === Role.GENERALSTAFF) {
    const user = await User.findById(userId);
    mySalary = user?.salary || 0;
  }

  if (role === Role.CUSTOMER) {
    const user = await User.findById(userId);
    if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");

    matchCondition["billingDetails.email"] = user.email;
  }

  if ([Role.MODERATOR].includes(role as Role)) {
    matchCondition.seller = new Types.ObjectId(userId);
  }

  const totalOrders = await Order.countDocuments(matchCondition);

  const orderStatsAgg = await Order.aggregate([
    { $match: matchCondition },
    {
      $group: {
        _id: "$orderStatus",
        count: { $sum: 1 },
      },
    },
  ]);

  const courierAssignedCount = await Order.countDocuments({
    ...matchCondition,
    deliveryStatus: "COURIERASSIGNED",
  });
  const inTransitCount = await Order.countDocuments({
    ...matchCondition,
    deliveryStatus: "IN_TRANSIT",
  });

  const noResponseCount = await Order.countDocuments({
    ...matchCondition,
    deliveryStatus: "NO_RESPONSE",
  });
  // const orderStats = {
  //   PENDING: 0,
  //   CONFIRMED: 0,
  //   COMPLETED: 0,
  //   CANCELLED: 0,
  //   PARTIAL: 0,
  //   COURIER_ASSIGNED: courierAssignedCount || 0,
  //   NO_RESPONSE: 0,
  // };
  const orderStats = {
    PENDING: 0,
    CONFIRMED: 0,
    COMPLETED: 0,
    CANCELLED: 0,
    PARTIAL: 0,

    COURIER_ASSIGNED: courierAssignedCount,
    IN_TRANSIT: inTransitCount,
    NO_RESPONSE: noResponseCount,
  };
  orderStatsAgg.forEach((item) => {
    orderStats[item._id as keyof typeof orderStats] = item.count;
  });

  const revenueAgg = await Order.aggregate([
    {
      $match: {
        ...matchCondition,
        orderStatus: { $in: ["COMPLETED", "PARTIAL"] },
      },
    },
    {
      $group: {
        _id: null,
        total: {
          $sum: {
            $subtract: ["$total", { $ifNull: ["$shippingCost", 0] }],
          },
        },
      },
    },
  ]);
  const startDate = query["updatedAt[gte]"]
    ? new Date(query["updatedAt[gte]"])
    : new Date(new Date().setDate(1));

  const endDate = query["updatedAt[lte]"]
    ? new Date(query["updatedAt[lte]"])
    : new Date();

  const diffTime = Math.abs(endDate.getTime() - startDate.getTime());

  const staffUsers = await User.find({
    role: { $in: ["ADMIN", "MANAGER", "MODERATOR", "TELESALES"] },
    isDeleted: false,
  });

  const totalMonthlySalary = staffUsers.reduce(
    (sum, user) => sum + (user.salary || user.commissionSalary || 0),
    0,
  );

  const dailySalary = totalMonthlySalary / 30;

  const totalDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  const staffSalaryForPeriod = dailySalary * totalDays;

  // const totalRevenue = revenueAgg[0]?.total || 0;
  const now = new Date();
  const totalDaysInMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
  ).getDate();

  let days = totalDaysInMonth;

  if (query["updatedAt[gte]"] && query["updatedAt[lte]"]) {
    const start = new Date(query["updatedAt[gte]"]);
    const end = new Date(query["updatedAt[lte]"]);

    days =
      Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  }

  // const salaryUsed = (totalSalary / totalDaysInMonth) * days;
  const totalProductCost = productCostAgg[0]?.totalCost || 0;

  const totalRevenue = revenueAgg[0]?.total || 0;
  const totalCost = totalProductCost;

  const netProfit = totalRevenue - totalCost;
  // console.log(staffSalaryForPeriod, totalProductCost, totalRevenue);

  const recentOrders = await Order.find(matchCondition)
    .sort({ createdAt: -1 })
    .limit(5)
    .populate("customer", "name email")
    .populate("seller", "name email");

  let totalUsers = undefined;
  let totalProducts = undefined;
  let staffEarnings = undefined;
  let topProducts = undefined;
  let confirmedProducts = undefined;

  if (role === Role.ADMIN) {
    totalUsers = await User.countDocuments();
    totalProducts = await Product.countDocuments({ isDeleted: false });

    staffEarnings = await Order.aggregate([
      {
        $match: {
          isDeleted: false,
          isPublished: true,
          orderStatus: { $in: ["COMPLETED", "PARTIAL"] },
          deliveryStatus: { $in: ["DELIVERED", "PARTIAL"] },
          ...queryObj,
        },
      },

      {
        $addFields: {
          orderValue: {
            $max: [
              {
                $subtract: ["$total", { $ifNull: ["$shippingCost", 0] }],
              },
              0,
            ],
          },
        },
      },

      {
        $lookup: {
          from: "users",
          localField: "seller",
          foreignField: "_id",
          as: "seller",
        },
      },

      {
        $unwind: {
          path: "$seller",
          preserveNullAndEmptyArrays: false,
        },
      },

      {
        $addFields: {
          perOrderSalary: {
            $cond: [
              { $gt: ["$seller.commissionSalary", 0] },

              "$seller.commissionSalary",

              0,
            ],
          },
        },
      },

      {
        $group: {
          _id: "$seller._id",
          sellerName: { $first: "$seller.name" },
          phone: { $first: "$seller.phone" },

          totalOrders: { $sum: 1 },
          totalOrderValue: { $sum: "$orderValue" },

          totalEarnings: { $sum: "$perOrderSalary" },
          avgPerOrderSalary: { $avg: "$perOrderSalary" },
        },
      },

      {
        $sort: { totalEarnings: -1 },
      },
    ]);
  }

  if ([Role.ADMIN, Role.MANAGER].includes(role as Role)) {
    staffPerformance = await Order.aggregate([
      {
        $match: {
          isDeleted: false,
          isPublished: true,
          ...queryObj,
        },
      },

      {
        $lookup: {
          from: "users",
          localField: "seller",
          foreignField: "_id",
          as: "seller",
        },
      },

      {
        $unwind: {
          path: "$seller",
          preserveNullAndEmptyArrays: false,
        },
      },

      {
        $group: {
          _id: "$seller._id",

          sellerName: {
            $first: "$seller.name",
          },

          email: {
            $first: "$seller.email",
          },

          phone: {
            $first: "$seller.phone",
          },

          role: {
            $first: "$seller.role",
          },

          profileImage: {
            $first: "$seller.profileImage",
          },

          commissionPerOrder: {
            $first: "$seller.commissionSalary",
          },

          totalOrders: {
            $sum: 1,
          },

          pendingOrders: {
            $sum: {
              $cond: [{ $eq: ["$orderStatus", "PENDING"] }, 1, 0],
            },
          },

          confirmedOrders: {
            $sum: {
              $cond: [{ $eq: ["$orderStatus", "CONFIRMED"] }, 1, 0],
            },
          },

          completedOrders: {
            $sum: {
              $cond: [{ $eq: ["$orderStatus", "COMPLETED"] }, 1, 0],
            },
          },

          cancelledOrders: {
            $sum: {
              $cond: [{ $eq: ["$orderStatus", "CANCELLED"] }, 1, 0],
            },
          },

          partialOrders: {
            $sum: {
              $cond: [{ $eq: ["$orderStatus", "PARTIAL"] }, 1, 0],
            },
          },

          revenue: {
            $sum: {
              $cond: [
                {
                  $in: ["$orderStatus", ["COMPLETED", "PARTIAL"]],
                },
                {
                  $subtract: [
                    "$total",
                    {
                      $ifNull: ["$shippingCost", 0],
                    },
                  ],
                },
                0,
              ],
            },
          },

          totalCommission: {
            $sum: {
              $cond: [
                {
                  $in: ["$orderStatus", ["COMPLETED", "PARTIAL"]],
                },
                "$seller.commissionSalary",
                0,
              ],
            },
          },
        },
      },

      {
        $sort: {
          totalOrders: -1,
        },
      },
    ]);
  }

  if (
    [Role.MODERATOR, Role.GENERALSTAFF, Role.TELESALES].includes(role as Role)
  ) {
    const result = await Order.aggregate([
      {
        $match: {
          seller: new Types.ObjectId(userId),
          isDeleted: false,
          isPublished: true,
          ...queryObj,
        },
      },

      {
        $group: {
          _id: null,

          totalOrders: {
            $sum: 1,
          },

          pendingOrders: {
            $sum: {
              $cond: [{ $eq: ["$orderStatus", "PENDING"] }, 1, 0],
            },
          },

          confirmedOrders: {
            $sum: {
              $cond: [{ $eq: ["$orderStatus", "CONFIRMED"] }, 1, 0],
            },
          },

          completedOrders: {
            $sum: {
              $cond: [{ $eq: ["$orderStatus", "COMPLETED"] }, 1, 0],
            },
          },

          cancelledOrders: {
            $sum: {
              $cond: [{ $eq: ["$orderStatus", "CANCELLED"] }, 1, 0],
            },
          },

          partialOrders: {
            $sum: {
              $cond: [{ $eq: ["$orderStatus", "PARTIAL"] }, 1, 0],
            },
          },

          revenue: {
            $sum: {
              $cond: [
                {
                  $in: ["$orderStatus", ["COMPLETED", "PARTIAL"]],
                },
                {
                  $subtract: [
                    "$total",
                    {
                      $ifNull: ["$shippingCost", 0],
                    },
                  ],
                },
                0,
              ],
            },
          },
        },
      },
    ]);

    myPerformance = result[0] || {
      totalOrders: 0,
      pendingOrders: 0,
      confirmedOrders: 0,
      completedOrders: 0,
      cancelledOrders: 0,
      partialOrders: 0,
      revenue: 0,
    };
  }

  topProducts = await Order.aggregate([
    {
      $match: {
        orderStatus: "COMPLETED",
        deliveryStatus: "DELIVERED",
        isDeleted: false,
        ...queryObj,
      },
    },
    { $unwind: "$products" },

    {
      $group: {
        _id: "$products.product",

        totalSoldInPeriod: { $sum: "$products.quantity" },

        totalRevenueInPeriod: {
          $sum: {
            $multiply: ["$products.price", "$products.quantity"],
          },
        },

        orderCount: { $sum: 1 },
      },
    },

    { $sort: { totalSoldInPeriod: -1 } },

    {
      $lookup: {
        from: "products",
        localField: "_id",
        foreignField: "_id",
        as: "product",
      },
    },
    {
      $unwind: {
        path: "$product",
        preserveNullAndEmptyArrays: false,
      },
    },
    {
      $addFields: {
        availableStock: {
          $max: [
            {
              $subtract: [
                { $ifNull: ["$product.totalAddedStock", 0] },
                "$totalSoldInPeriod",
              ],
            },
            0,
          ],
        },
      },
    },

    {
      $project: {
        productId: "$product._id",
        title: "$product.title",
        price: "$product.price",
        buyingPrice: "$product.buyingPrice",
        images: "$product.images",
        availableStock: 1,
        totalSoldInPeriod: 1,
        totalRevenueInPeriod: 1,
        orderCount: 1,
      },
    },
  ]);

  const confirmedMatch = {
    ...matchCondition,
    orderStatus: "CONFIRMED",
  };

  confirmedProducts = await Order.aggregate([
    {
      $match: confirmedMatch,
    },
    { $unwind: "$products" },
    {
      $group: {
        _id: "$products.product",
        totalSoldInPeriod: { $sum: "$products.quantity" },
        totalRevenueInPeriod: {
          $sum: {
            $multiply: ["$products.price", "$products.quantity"],
          },
        },

        orderCount: { $sum: 1 },
      },
    },
    { $sort: { totalSoldInPeriod: -1 } },
    {
      $lookup: {
        from: "products",
        localField: "_id",
        foreignField: "_id",
        as: "product",
      },
    },
    { $unwind: { path: "$product", preserveNullAndEmptyArrays: false } },
    {
      $addFields: {
        availableStock: {
          $max: [
            {
              $subtract: [
                { $ifNull: ["$product.totalAddedStock", 0] },
                "$totalSoldInPeriod",
              ],
            },
            0,
          ],
        },
      },
    },
    {
      $project: {
        productId: "$product._id",
        title: "$product.title",
        price: "$product.price",
        discountPrice: "$product.discountPrice",
        buyingPrice: "$product.buyingPrice",
        images: "$product.images",
        availableStock: 1,
        totalSold: { $sum: "$products.quantity" },
        totalSoldInPeriod: 1,
        totalRevenueInPeriod: 1,
        orderCount: 1,
      },
    },
  ]);

  return {
    totalOrders,
    totalRevenue,
    totalUsers,
    totalProducts,
    orderStats,
    staffEarnings,

    staffPerformance,
    myPerformance,
    mySalary,
    topProducts,
    confirmedProducts,
    totalCost: totalProductCost,
    totalSalary: staffSalaryForPeriod,
    netProfit,
    recentOrders,
    role,
  };
};

export const DashboardService = {
  getDashboardOverview,
};
