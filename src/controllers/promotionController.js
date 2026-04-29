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

const updatePromotion = async (req, res) => {
  try {
    const promotion = await Promotion.findById(req.params.id);
    if (!promotion) {
      return res.status(404).json({ message: 'Promotion not found.' });
    }

    const {
      name,
      code,
      discountType,
      discountValue,
      imageUrl,
      maxDiscount,
      minFare,
      startDate,
      endDate,
      usageLimit,
      audience,
      active,
      status,
    } = req.body;

    if (name !== undefined) {
      const normalizedName = String(name || '').trim();
      if (!normalizedName) {
        return res.status(400).json({ message: 'Promotion name is required.' });
      }
      promotion.name = normalizedName;
    }

    if (code !== undefined) {
      const normalizedCode = String(code || '').trim().toUpperCase();
      if (!normalizedCode) {
        return res.status(400).json({ message: 'Promo code is required.' });
      }

      const existingPromotion = await Promotion.findOne({
        _id: { $ne: promotion._id },
        code: normalizedCode,
      });
      if (existingPromotion) {
        return res.status(400).json({ message: 'A promotion with this promo code already exists.' });
      }

      promotion.code = normalizedCode;
    }

    if (discountType !== undefined) {
      promotion.discountType = discountType === 'Fixed' ? 'Fixed' : 'Percentage';
    }

    if (discountValue !== undefined) {
      const numericDiscountValue = toNumber(discountValue);
      if (!numericDiscountValue) {
        return res.status(400).json({ message: 'Discount value is required.' });
      }
      promotion.discountValue = numericDiscountValue;
    }

    if (imageUrl !== undefined) promotion.imageUrl = String(imageUrl || '').trim();
    if (maxDiscount !== undefined) promotion.maxDiscount = toNumber(maxDiscount);
    if (minFare !== undefined) promotion.minFare = toNumber(minFare);
    if (startDate !== undefined) promotion.startDate = toDateOrNull(startDate) || new Date();
    if (endDate !== undefined) promotion.endDate = toDateOrNull(endDate);
    if (usageLimit !== undefined) promotion.usageLimit = toNumber(usageLimit);
    if (audience !== undefined) promotion.audience = String(audience || 'All passengers').trim();
    if (active !== undefined) promotion.active = Boolean(active);
    if (status !== undefined) {
      promotion.status = promotion.active ? (status === 'Scheduled' ? 'Scheduled' : 'Active') : 'Paused';
    } else if (active !== undefined && !promotion.active) {
      promotion.status = 'Paused';
    }

    await promotion.save();

    return res.status(200).json({
      message: 'Promotion updated successfully.',
      promotion: buildPromotionResponse(promotion),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Unable to update promotion' });
  }
};

const deletePromotion = async (req, res) => {
  try {
    const promotion = await Promotion.findByIdAndDelete(req.params.id);
    if (!promotion) {
      return res.status(404).json({ message: 'Promotion not found.' });
    }

    return res.status(200).json({
      message: 'Promotion deleted successfully.',
      id: req.params.id,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Unable to delete promotion' });
  }
};

module.exports = {
  listPromotions,
  createPromotion,
  updatePromotion,
  deletePromotion,
};
