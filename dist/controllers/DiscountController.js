"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = __importDefault(require("../config/prisma"));
const ApiResponse_1 = require("../utils/ApiResponse");
const client_1 = require("@prisma/client");
const DiscountService_1 = __importDefault(require("../services/DiscountService"));
const AsyncHandler_1 = require("../utils/AsyncHandler");
class DiscountController {
}
_a = DiscountController;
DiscountController.getAllDiscount = (0, AsyncHandler_1.asyncHandler)(async (req, res) => {
    const data = await DiscountService_1.default.getAllDiscount();
    ApiResponse_1.ApiResponse.success(res, data, "Get All Discount Success");
});
// soft-delete discount
DiscountController.softDeleteDiscount = (0, AsyncHandler_1.asyncHandler)(async (req, res) => {
    const discount_id = Number(req.params.id);
    const softDeleteDiscount = await DiscountService_1.default.softDeleteDiscount(discount_id);
    ApiResponse_1.ApiResponse.success(res, softDeleteDiscount, "Soft Delete Discount Success", 200);
});
DiscountController.createDiscount = (0, AsyncHandler_1.asyncHandler)(async (req, res) => {
    const discountData = req.body.data;
    if (!discountData) {
        return ApiResponse_1.ApiResponse.error(res, "Required all fields", 400);
    }
    const createDiscount = await DiscountService_1.default.createDiscount(discountData);
    ApiResponse_1.ApiResponse.success(res, createDiscount, "Create Discount Success!", 200);
});
DiscountController.verifyDiscount = (0, AsyncHandler_1.asyncHandler)(async (req, res) => {
    const { code, subtotal, items, storeId } = req.body;
    if (!code || subtotal === undefined || !items || !storeId) {
        return ApiResponse_1.ApiResponse.error(res, "Code, subtotal, items, and storeId are required", 400);
    }
    const discount = await prisma_1.default.discount.findFirst({
        where: {
            code: {
                equals: code,
                mode: "insensitive",
            },
            is_deleted: false,
            start_date: { lte: new Date() },
            end_date: { gte: new Date() },
            OR: [{ store_id: null }, { store_id: storeId }],
        },
    });
    if (!discount) {
        return ApiResponse_1.ApiResponse.error(res, "Promo code not found or has expired", 404);
    }
    // Check if product-specific discount is valid for the cart items
    if (discount.type === "B1G1" && discount.product_id) {
        const requiredItem = items.find((item) => item.productId === discount.product_id);
        if (!requiredItem) {
            return ApiResponse_1.ApiResponse.error(res, "Required product for this promo is not in your cart.", 400);
        }
        const stock = await prisma_1.default.productStocks.findUnique({
            where: {
                store_id_product_id: {
                    store_id: storeId,
                    product_id: discount.product_id,
                },
            },
            select: { stock_quantity: true },
        });
        const availableStock = stock?.stock_quantity ?? 0;
        if (requiredItem.quantity * 2 > availableStock) {
            return ApiResponse_1.ApiResponse.error(res, `Cannot apply B1G1: Not enough stock for the free item. Only ${availableStock} total units available.`, 400);
        }
    }
    else if (discount.type === "MANUAL" && discount.product_id) {
        const requiredItem = items.find((item) => item.productId === discount.product_id);
        if (!requiredItem) {
            return ApiResponse_1.ApiResponse.error(res, "Required product for this promo is not in your cart.", 400);
        }
    }
    if (discount.type === "MIN_PURCHASE" && discount.minPurch) {
        if (new client_1.Prisma.Decimal(subtotal).lt(discount.minPurch)) {
            return ApiResponse_1.ApiResponse.error(res, `Minimum purchase of Rp ${Number(discount.minPurch).toLocaleString("id-ID")} is required.`, 400);
        }
    }
    let discountValue = 0;
    let frontendPromoType = "fixed";
    if (discount.type === "FREE_ONGKIR") {
        frontendPromoType = "free_shipping";
        discountValue = 0;
    }
    else if (discount.type === "B1G1") {
        frontendPromoType = "b1g1";
        discountValue = 0; // B1G1 is not a monetary discount, it's about quantity
    }
    else if (discount.discAmount &&
        (discount.type === "MANUAL" || discount.type === "MIN_PURCHASE")) {
        if (discount.valueType === "PERCENTAGE") {
            frontendPromoType = "percentage";
            discountValue = Number(discount.discAmount);
        }
        else {
            frontendPromoType = "fixed";
            discountValue = Number(discount.discAmount);
        }
    }
    const responsePayload = {
        code: discount.code,
        description: discount.description || "",
        type: frontendPromoType,
        value: discountValue,
        productId: discount.product_id,
    };
    ApiResponse_1.ApiResponse.success(res, responsePayload, "Promo code applied successfully");
});
exports.default = DiscountController;
//# sourceMappingURL=DiscountController.js.map