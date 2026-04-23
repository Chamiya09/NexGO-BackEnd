# NexGO-BackEnd

## Environment Variables

```env
PORT=5000
MONGO_URI=
JWT_SECRET=
PASSWORD_RESET_OTP_SECRET=
PAYMENT_METHOD_SECRET=

BREVO_API_KEY=
BREVO_SENDER_EMAIL=
BREVO_SENDER_NAME=NexGO
BREVO_REQUEST_TIMEOUT_MS=10000
PASSWORD_RESET_OTP_TTL_MINUTES=10
PASSWORD_RESET_RESEND_SECONDS=60
PASSWORD_RESET_MAX_ATTEMPTS=5
```

Brevo is used for transactional email, including password reset OTP messages. The sender email must be verified in Brevo before password reset email can be delivered.

If `BREVO_API_KEY` or `BREVO_SENDER_EMAIL` is missing, the OTP endpoint will return `503 Email service is not configured`.
