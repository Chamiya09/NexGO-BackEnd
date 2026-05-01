const express = require('express');

const {
  listSupportTicketTopics,
  createSupportTicket,
  listMySupportTickets,
  listSupportTicketsForAdmin,
  updateSupportTicketForAdmin,
} = require('../controllers/supportTicketController');

const router = express.Router();

router.get('/topics', listSupportTicketTopics);
router.post('/', createSupportTicket);
router.get('/my-tickets', listMySupportTickets);
router.get('/admin', listSupportTicketsForAdmin);
router.patch('/admin/:id', updateSupportTicketForAdmin);

module.exports = router;
