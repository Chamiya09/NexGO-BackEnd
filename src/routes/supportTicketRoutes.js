const express = require('express');

const {
  listSupportTicketTopics,
  createSupportTicket,
  createDriverSupportTicket,
  listMySupportTickets,
  listMyDriverSupportTickets,
  updateMySupportTicket,
  updateMyDriverSupportTicket,
  deleteMySupportTicket,
  deleteMyDriverSupportTicket,
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
router.post('/driver', createDriverSupportTicket);
router.get('/driver/my-tickets', listMyDriverSupportTickets);
router.patch('/driver/my-tickets/:id', updateMyDriverSupportTicket);
router.delete('/driver/my-tickets/:id', deleteMyDriverSupportTicket);
router.get('/admin', listSupportTicketsForAdmin);
router.get('/admin/:id', getSupportTicketForAdmin);
router.patch('/admin/:id', updateSupportTicketForAdmin);
router.delete('/admin/:id', deleteSupportTicketForAdmin);

module.exports = router;
