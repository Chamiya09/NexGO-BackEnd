const Promotion = require('../models/Promotion');

const toNumber = (value, fallback = 0) => {
  if (value === 'Unlimited') {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toDateOrNull = (value) => {
  if (!value || value === 'No end date') {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const buildPromotionResponse = (promotion) => ({
  id: promotion._id.toString(),
  name: promotion.name,
  code: promotion.code,
  discountType: promotion.discountType,
  discountValue: String(promotion.discountValue),
  imageUrl: promotion.imageUrl || '',
  maxDiscount: String(promotion.maxDiscount || 0),
  minFare: String(promotion.minFare || 0),
  startDate: promotion.startDate ? promotion.startDate.toISOString().slice(0, 10) : '',
  endDate: promotion.endDate ? promotion.endDate.toISOString().slice(0, 10) : 'No end date',
  usageLimit: promotion.usageLimit ? String(promotion.usageLimit) : 'Unlimited',
  usedCount: promotion.usedCount || 0,
  audience: promotion.audience,
  status: promotion.status,
  active: promotion.active,
});

const listPromotions = async (_req, res) => {
  try {
    const promotions = await Promotion.find().sort({ createdAt: -1 });
    return res.status(200).json({
      promotions: promotions.map(buildPromotionResponse),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Unable to load promotions' });
  }
};

const createPromotion = async (req, res) => {
  try {
    const {
      name,
      code,
      discountType = 'Percentage',
      discountValue,
      imageUrl = '',
      maxDiscount,
      minFare,
      startDate,
      endDate,
      usageLimit,
      audience = 'All passengers',
      active = true,
      status,
    } = req.body;

    const normalizedName = String(name || '').trim();
    const normalizedCode = String(code || '').trim().toUpperCase();
    const normalizedDiscountType = discountType === 'Fixed' ? 'Fixed' : 'Percentage';
    const numericDiscountValue = toNumber(discountValue);

    if (!normalizedName || !normalizedCode || !numericDiscountValue) {
      return res.status(400).json({ message: 'Promotion name, promo code, and discount value are required.' });
    }

    const existingPromotion = await Promotion.findOne({ code: normalizedCode });
    if (existingPromotion) {
      return res.status(400).json({ message: 'A promotion with this promo code already exists.' });
    }

    const nextActive = Boolean(active);
    const nextStatus = nextActive ? (status === 'Scheduled' ? 'Scheduled' : 'Active') : 'Paused';

    const promotion = await Promotion.create({
      name: normalizedName,
      code: normalizedCode,
      discountType: normalizedDiscountType,
      discountValue: numericDiscountValue,
      imageUrl: String(imageUrl || '').trim(),
      maxDiscount: toNumber(maxDiscount, normalizedDiscountType === 'Fixed' ? numericDiscountValue : 500),
      minFare: toNumber(minFare),
      startDate: toDateOrNull(startDate) || new Date(),
      endDate: toDateOrNull(endDate),
      usageLimit: toNumber(usageLimit),
      audience: String(audience || 'All passengers').trim(),
      status: nextStatus,
      active: nextActive,
    });

    return res.status(201).json({
      message: 'Promotion created successfully.',
      promotion: buildPromotionResponse(promotion),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Unable to create promotion' });
  }
};

module.exports = {
  listPromotions,
  createPromotion,
};
