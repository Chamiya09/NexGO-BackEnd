const express = require('express');

const {
  createPromotion,
  deletePromotion,
  listPromotions,
  updatePromotion,
} = require('../controllers/promotionController');

const router = express.Router();

router.get('/', listPromotions);
router.post('/', createPromotion);
router.patch('/:id', updatePromotion);
router.delete('/:id', deletePromotion);

module.exports = router;
