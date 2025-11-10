"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = __importDefault(require("../config/prisma"));
const client_1 = require("@prisma/client");
const EmailService_1 = __importDefault(require("./EmailService"));
const cloudinary_1 = __importDefault(require("../config/cloudinary"));
const UserOrderReads_1 = require("../queries/UserOrderReads");
const OrderMappers_1 = require("../mappers/OrderMappers");
const UserOrderMutations_1 = require("../mutations/UserOrderMutations");
class OrderService {
    static async createOrder(payload) {
        const { userId, addressId, storeId, shippingCost, paymentMethodId, promoCode, } = payload;
        return prisma_1.default.$transaction(async (tx) => {
            const userCart = await tx.cart.findFirst({
                where: { user_id: userId, store_id: storeId },
                include: { cartItems: { include: { product: true } } },
            });
            if (!userCart || userCart.cartItems.length === 0) {
                throw new Error("Your cart is empty. Please add items to continue.");
            }
            for (const item of userCart.cartItems) {
                const productStock = await tx.productStocks.findUnique({
                    where: {
                        store_id_product_id: {
                            store_id: userCart.store_id,
                            product_id: item.product_id,
                        },
                    },
                });
                if (!productStock || productStock.stock_quantity < item.quantity) {
                    throw new Error(`Insufficient stock for ${item.product.name}. Only ${productStock?.stock_quantity || 0} left.`);
                }
            }
            const userAddress = await tx.userAddress.findFirst({
                where: { id: addressId, user_id: userId },
            });
            if (!userAddress) {
                throw new Error("Address not found or does not belong to the user.");
            }
            const { name, phone, street, detail, subdistrict, district, city, province, postal_code, } = userAddress;
            const destinationAddress = [
                `${name} (${phone})`,
                street,
                detail,
                subdistrict,
                district,
                `${city}, ${province} ${postal_code}`,
            ]
                .filter(Boolean)
                .join(", ");
            const shippingCostNum = parseFloat(shippingCost);
            if (isNaN(shippingCostNum)) {
                throw new Error("Invalid shipping cost format.");
            }
            const subtotal = userCart.cartItems.reduce((sum, item) => sum + Number(item.product.price) * item.quantity, 0);
            let productDiscount = 0;
            let shippingDiscount = 0;
            let finalAppliedDiscount = null;
            let isB1G1 = false;
            let b1g1ProductId = null;
            if (promoCode) {
                const foundDiscount = await tx.discount.findFirst({
                    where: {
                        code: promoCode,
                        is_deleted: false,
                        start_date: { lte: new Date() },
                        end_date: { gte: new Date() },
                        OR: [{ store_id: null }, { store_id: storeId }],
                    },
                });
                if (foundDiscount) {
                    const meetsMinPurchase = !foundDiscount.minPurch ||
                        new client_1.Prisma.Decimal(subtotal).gte(foundDiscount.minPurch);
                    if (meetsMinPurchase) {
                        finalAppliedDiscount = foundDiscount;
                        if (finalAppliedDiscount.type === "FREE_ONGKIR") {
                            shippingDiscount = shippingCostNum;
                        }
                        else if (finalAppliedDiscount.type === "B1G1") {
                            isB1G1 = true;
                            b1g1ProductId = finalAppliedDiscount.product_id;
                            productDiscount = 0; // B1G1 is a quantity bonus, not a price discount.
                        }
                        else if (finalAppliedDiscount.discAmount) {
                            if (finalAppliedDiscount.valueType === "PERCENTAGE") {
                                productDiscount =
                                    (subtotal * Number(finalAppliedDiscount.discAmount)) / 100;
                            }
                            else {
                                productDiscount = Number(finalAppliedDiscount.discAmount);
                            }
                        }
                    }
                }
            }
            // Re-validate stock with B1G1 logic
            for (const item of userCart.cartItems) {
                const productStock = await tx.productStocks.findUniqueOrThrow({
                    where: {
                        store_id_product_id: { store_id: userCart.store_id, product_id: item.product_id, },
                    },
                });
                let requiredStock = item.quantity;
                if (isB1G1 && item.product_id === b1g1ProductId) {
                    requiredStock *= 2; // Double the stock requirement
                }
                if (productStock.stock_quantity < requiredStock) {
                    throw new Error(`Insufficient stock for ${item.product.name}. Required: ${requiredStock}, Available: ${productStock.stock_quantity}`);
                }
            }
            const finalUserCart = {
                ...userCart,
                cartItems: userCart.cartItems.map(item => {
                    if (isB1G1 && item.product_id === b1g1ProductId) {
                        return { ...item, quantity: item.quantity * 2 };
                    }
                    return item;
                }),
            };
            productDiscount = Math.min(subtotal, productDiscount);
            shippingDiscount = Math.min(shippingCostNum, shippingDiscount);
            const totalDiscount = productDiscount + shippingDiscount;
            const totalPrice = Math.max(0, subtotal + shippingCostNum - totalDiscount);
            return await UserOrderMutations_1.UserOrderMutations.createOrderTransaction({
                tx,
                userId,
                storeId,
                userCart: finalUserCart,
                userAddress,
                destinationAddress,
                paymentMethodId,
                subtotal: subtotal,
                shippingCost: shippingCostNum,
                discountAmount: totalDiscount,
                totalPrice: totalPrice,
                finalAppliedDiscount,
            });
        }, { timeout: 20000 });
    }
    static async getOrderById(userId, orderId) {
        const order = await UserOrderReads_1.UserOrderReads.getFullOrderDetail(userId, orderId);
        return OrderMappers_1.OrderMappers.formatOrderForUserDetailResponse(order);
    }
    static async getMyOrders(params) {
        return UserOrderReads_1.UserOrderReads.getPaginatedUserOrders(params);
    }
    static async cancelOrder(userId, orderId) {
        const order = await UserOrderMutations_1.UserOrderMutations.cancelOrderTransaction(userId, orderId);
        await EmailService_1.default.sendAdminOrderCancelledEmail(order.user, order);
    }
    static async confirmReceipt(userId, orderId) {
        await UserOrderMutations_1.UserOrderMutations.confirmReceiptTransaction(userId, orderId);
    }
    static async validateRepay(userId, orderId) {
        await UserOrderMutations_1.UserOrderMutations.validateRepay(userId, orderId);
    }
    static async uploadPaymentProof(userId, orderId, file) {
        let imageUrl = "";
        if (file) {
            const result = await new Promise((resolve, reject) => {
                cloudinary_1.default.uploader
                    .upload_stream({ folder: "payment_proofs", resource_type: "image" }, (error, uploaded) => {
                    if (error)
                        reject(error);
                    else
                        resolve(uploaded);
                })
                    .end(file.buffer);
            });
            imageUrl = result.secure_url;
        }
        else {
            if (process.env.NODE_ENV === "production") {
                throw new Error("A payment proof file is required.");
            }
            imageUrl = `https://placehold.co/600x400/png?text=DEV+Payment+Proof\\nOrder+${orderId}`;
        }
        await UserOrderMutations_1.UserOrderMutations.uploadPaymentProofTransaction(userId, orderId, imageUrl);
    }
}
exports.default = OrderService;
//# sourceMappingURL=OrderService.js.map