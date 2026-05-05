const getClientKey = (req) => {
  const forwardedFor = req.headers['x-forwarded-for'];
  const forwardedIp = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const ip = forwardedIp ? forwardedIp.split(',')[0].trim() : req.ip || req.socket?.remoteAddress || 'unknown';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';

  return `${ip}:${email}`;
};

const createRateLimiter = ({ windowMs, maxRequests, message }) => {
  const hits = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const key = getClientKey(req);
    const current = hits.get(key);

    if (!current || current.expiresAt <= now) {
      hits.set(key, {
        count: 1,
        expiresAt: now + windowMs,
      });
      next();
      return;
    }

    if (current.count >= maxRequests) {
      const retryAfterSeconds = Math.ceil((current.expiresAt - now) / 1000);
      res.set('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({ message });
    }

    current.count += 1;
    hits.set(key, current);
    next();
  };
};

module.exports = {
  createRateLimiter,
};
