const jwt = require('jsonwebtoken');

const User = require('../models/User');
const { SupportTicket, SUPPORT_TICKET_TOPICS } = require('../models/SupportTicket');

const getTokenFromRequest = (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  return authHeader.split(' ')[1];
};

const getAuthenticatedUser = async (req) => {
  const token = getTokenFromRequest(req);
  if (!token) {
    return null;
  }

  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  return User.findById(decoded.id);
};

const normalizePassenger = (passenger) => {
  if (!passenger || typeof passenger !== 'object') {
    return null;
  }

  return {
    id: passenger._id?.toString?.() ?? passenger.toString?.() ?? '',
    fullName: passenger.fullName ?? '',
    email: passenger.email ?? '',
    phoneNumber: passenger.phoneNumber ?? '',
    profileImageUrl: passenger.profileImageUrl ?? '',
  };
};

const normalizeTicket = (ticket) => ({
  id: ticket._id.toString(),
  passengerId: ticket.passengerId?._id?.toString?.() ?? ticket.passengerId?.toString?.() ?? '',
  passenger: normalizePassenger(ticket.passengerId),
  topic: ticket.topic,
  subject: ticket.subject,
  description: ticket.description,
  rideReference: ticket.rideReference || '',
  priority: ticket.priority,
  status: ticket.status,
  adminNote: ticket.adminNote || '',
  createdAt: ticket.createdAt,
  updatedAt: ticket.updatedAt,
  resolvedAt: ticket.resolvedAt,
});

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

const listSupportTicketTopics = (_req, res) => {
  return res.status(200).json({ topics: SUPPORT_TICKET_TOPICS });
};

const createSupportTicket = async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const topic = normalizeText(req.body.topic);
    const subject = normalizeText(req.body.subject);
    const description = normalizeText(req.body.description);
    const rideReference = normalizeText(req.body.rideReference);
    const priority = req.body.priority === 'Urgent' ? 'Urgent' : 'Normal';

    if (!SUPPORT_TICKET_TOPICS.includes(topic)) {
      return res.status(400).json({ message: 'Please select a valid support topic.' });
    }

    if (subject.length < 3) {
      return res.status(400).json({ message: 'Subject must be at least 3 characters.' });
    }

    if (description.length < 12) {
      return res.status(400).json({ message: 'Description must be at least 12 characters.' });
    }

    const ticket = await SupportTicket.create({
      passengerId: user._id,
      topic,
      subject,
      description,
      rideReference,
      priority,
    });

    const populatedTicket = await SupportTicket.findById(ticket._id).populate(
      'passengerId',
      'fullName email phoneNumber profileImageUrl'
    );

    return res.status(201).json({
      message: 'Support ticket opened successfully',
      ticket: normalizeTicket(populatedTicket),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Unable to open support ticket' });
  }
};

const listMySupportTickets = async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const tickets = await SupportTicket.find({ passengerId: user._id })
      .sort({ createdAt: -1 })
      .populate('passengerId', 'fullName email phoneNumber profileImageUrl');

    return res.status(200).json({ tickets: tickets.map(normalizeTicket) });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Unable to load support tickets' });
  }
};

const listSupportTicketsForAdmin = async (req, res) => {
  try {
    const { status, priority } = req.query;
    const filter = {};

    if (status && ['Open', 'In Review', 'Resolved', 'Closed'].includes(status)) {
      filter.status = status;
    }

    if (priority && ['Normal', 'Urgent'].includes(priority)) {
      filter.priority = priority;
    }

    const tickets = await SupportTicket.find(filter)
      .sort({ createdAt: -1 })
      .populate('passengerId', 'fullName email phoneNumber profileImageUrl');

    return res.status(200).json({ tickets: tickets.map(normalizeTicket) });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Unable to load support tickets' });
  }
};

const getSupportTicketForAdmin = async (req, res) => {
  try {
    const ticket = await SupportTicket.findById(req.params.id).populate(
      'passengerId',
      'fullName email phoneNumber profileImageUrl'
    );

    if (!ticket) {
      return res.status(404).json({ message: 'Support ticket not found' });
    }

    return res.status(200).json({ ticket: normalizeTicket(ticket) });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Unable to load support ticket' });
  }
};

const updateSupportTicketForAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const status = normalizeText(req.body.status);
    const adminNote = normalizeText(req.body.adminNote);
    const update = {};

    if (status) {
      if (!['Open', 'In Review', 'Resolved', 'Closed'].includes(status)) {
        return res.status(400).json({ message: 'Please select a valid ticket status.' });
      }

      update.status = status;
      update.resolvedAt = ['Resolved', 'Closed'].includes(status) ? new Date() : null;
    }

    if (typeof req.body.adminNote === 'string') {
      update.adminNote = adminNote;
    }

    const ticket = await SupportTicket.findByIdAndUpdate(id, update, {
      new: true,
      runValidators: true,
    }).populate('passengerId', 'fullName email phoneNumber profileImageUrl');

    if (!ticket) {
      return res.status(404).json({ message: 'Support ticket not found' });
    }

    return res.status(200).json({
      message: 'Support ticket updated successfully',
      ticket: normalizeTicket(ticket),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Unable to update support ticket' });
  }
};

module.exports = {
  listSupportTicketTopics,
  createSupportTicket,
  listMySupportTickets,
  listSupportTicketsForAdmin,
  getSupportTicketForAdmin,
  updateSupportTicketForAdmin,
};
