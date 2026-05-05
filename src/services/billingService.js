// src/services/billingService.js
// Centralized completion hook for fare capture and invoice generation.

async function triggerPaymentAndInvoice(ride) {
  const invoice = {
    invoiceId: `INV-${ride._id.toString().slice(-6).toUpperCase()}`,
    rideId: ride._id.toString(),
    passengerId: ride.passengerId?.toString(),
    driverId: ride.driverId?.toString() ?? null,
    amount: ride.price,
    currency: 'LKR',
    generatedAt: new Date().toISOString(),
  };

  // This is intentionally isolated so a real payment gateway can be plugged in later.
  console.log('[Billing] Payment + invoice triggered:', invoice);
  return invoice;
}

module.exports = { triggerPaymentAndInvoice };
