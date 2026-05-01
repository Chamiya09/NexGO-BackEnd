const express = require('express');

const {
  createPromotion,
  deletePromotion,
  listPromotions,
  updatePromotion,
  validatePromotion,
} = require('../controllers/promotionController');
const { requireAdmin } = require('../middleware/adminAuth');

const router = express.Router();

router.get('/', listPromotions);
router.get('/validate/:code', validatePromotion);
router.post('/', requireAdmin, createPromotion);
router.post('/:id', requireAdmin, updatePromotion);
router.post('/:id/delete', requireAdmin, deletePromotion);
router.patch('/:id', requireAdmin, updatePromotion);
router.delete('/:id', requireAdmin, deletePromotion);

module.exports = router;
