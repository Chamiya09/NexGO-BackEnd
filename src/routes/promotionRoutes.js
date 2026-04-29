const express = require('express');

const {
  createPromotion,
  listPromotions,
} = require('../controllers/promotionController');

const router = express.Router();

router.get('/', listPromotions);
router.post('/', createPromotion);

module.exports = router;
