const express = require('express');

const {
  listSupportTicketTopics,
  createSupportTicket,
  listMySupportTickets,
  listSupportTicketsForAdmin,
  getSupportTicketForAdmin,
  updateSupportTicketForAdmin,
} = require('../controllers/supportTicketController');

const router = express.Router();

router.get('/topics', listSupportTicketTopics);
router.post('/', createSupportTicket);
router.get('/my-tickets', listMySupportTickets);
router.get('/admin', listSupportTicketsForAdmin);
router.get('/admin/:id', getSupportTicketForAdmin);
router.patch('/admin/:id', updateSupportTicketForAdmin);

module.exports = router;
