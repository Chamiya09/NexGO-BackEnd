const https = require('https');

const BREVO_EMAIL_API_HOST = 'api.brevo.com';
const BREVO_EMAIL_API_PATH = '/v3/smtp/email';

const getRequiredEnv = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required to send transactional email`);
  }

  return value;
};

const postToBrevo = (payload) =>
  new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);

    const request = https.request(
      {
        hostname: BREVO_EMAIL_API_HOST,
        path: BREVO_EMAIL_API_PATH,
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'api-key': getRequiredEnv('BREVO_API_KEY'),
        },
      },
      (response) => {
        let responseBody = '';

        response.on('data', (chunk) => {
          responseBody += chunk;
        });

        response.on('end', () => {
          let parsedBody = {};

          try {
            parsedBody = responseBody ? JSON.parse(responseBody) : {};
          } catch {
            parsedBody = {};
          }

          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve(parsedBody);
            return;
          }

          reject(new Error(parsedBody?.message || 'Brevo email request failed'));
        });
      }
    );

    request.on('error', reject);
    request.write(body);
    request.end();
  });

const sendTransactionalEmail = async ({ toEmail, toName, subject, htmlContent, textContent }) => {
  if (!toEmail || !subject || !htmlContent) {
    throw new Error('toEmail, subject, and htmlContent are required to send transactional email');
  }

  return postToBrevo({
    sender: {
      email: getRequiredEnv('BREVO_SENDER_EMAIL'),
      name: process.env.BREVO_SENDER_NAME || 'NexGO',
    },
    to: [
      {
        email: toEmail,
        name: toName || toEmail,
      },
    ],
    subject,
    htmlContent,
    textContent,
  });
};

const sendPasswordResetOtpEmail = ({ toEmail, toName, otp, ttlMinutes }) => {
  if (!otp) {
    throw new Error('otp is required to send password reset email');
  }

  const expiresIn = ttlMinutes || 10;

  return sendTransactionalEmail({
    toEmail,
    toName,
    subject: 'Your NexGO password reset code',
    htmlContent: `
      <p>Hi ${toName || 'there'},</p>
      <p>Your NexGO password reset code is:</p>
      <h2>${otp}</h2>
      <p>This code expires in ${expiresIn} minutes.</p>
      <p>If you did not request this, you can ignore this email.</p>
    `,
    textContent: `Your NexGO password reset code is ${otp}. This code expires in ${expiresIn} minutes.`,
  });
};

module.exports = {
  sendTransactionalEmail,
  sendPasswordResetOtpEmail,
};
