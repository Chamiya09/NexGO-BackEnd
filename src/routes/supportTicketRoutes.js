const express = require('express');

const {
  listSupportTicketTopics,
  createSupportTicket,
  listMySupportTickets,
  updateMySupportTicket,
  deleteMySupportTicket,
  listSupportTicketsForAdmin,
  getSupportTicketForAdmin,
  updateSupportTicketForAdmin,
  deleteSupportTicketForAdmin,
} = require('../controllers/supportTicketController');

const router = express.Router();

router.get('/topics', listSupportTicketTopics);
router.post('/', createSupportTicket);
router.get('/my-tickets', listMySupportTickets);
router.patch('/my-tickets/:id', updateMySupportTicket);
router.delete('/my-tickets/:id', deleteMySupportTicket);
router.get('/admin', listSupportTicketsForAdmin);
router.get('/admin/:id', getSupportTicketForAdmin);
router.patch('/admin/:id', updateSupportTicketForAdmin);
router.delete('/admin/:id', deleteSupportTicketForAdmin);

module.exports = router;
