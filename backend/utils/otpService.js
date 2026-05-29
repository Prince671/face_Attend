const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');

const otpTtlMinutes = () => Number(process.env.OTP_TTL_MINUTES || 10);

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const generateOtp = () => crypto.randomInt(100000, 1000000).toString();
const generateSecureToken = () => crypto.randomBytes(32).toString('hex');
const hashValue = (value) => bcrypt.hash(String(value), 10);
const compareValue = (value, hash) => Boolean(value && hash) && bcrypt.compare(String(value), hash);

let cachedTransporter = null;

const getMailTransporter = () => {
  if (cachedTransporter) return cachedTransporter;
  const user = process.env.SMTP_USER || 'learntocode011@gmail.com';
  const pass = process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD;
  if (!pass) return null;

  cachedTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || 'true').toLowerCase() !== 'false',
    auth: { user, pass }
  });
  return cachedTransporter;
};

const sendEmailOtp = async ({ to, otp, purpose }) => {
  const transporter = getMailTransporter();
  if (!transporter) {
    throw new Error('Email OTP service is not configured. Set SMTP_USER and SMTP_PASS/GMAIL_APP_PASSWORD.');
  }

  const isReset = purpose === 'forgot_password';
  await transporter.sendMail({
    from: process.env.MAIL_FROM || `"StudySphere" <${process.env.SMTP_USER || 'learntocode011@gmail.com'}>`,
    to,
    subject: isReset ? 'StudySphere password reset OTP' : 'StudySphere registration OTP',
    text: `Your StudySphere OTP is ${otp}. It expires in ${otpTtlMinutes()} minutes.`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a">
        <h2 style="margin:0 0 12px">StudySphere verification</h2>
        <p>${isReset ? 'Use this OTP to reset your password.' : 'Use this OTP to continue your student registration.'}</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:18px 0">${otp}</p>
        <p>This code expires in ${otpTtlMinutes()} minutes. Do not share it with anyone.</p>
      </div>
    `
  });
};

module.exports = {
  compareValue,
  generateOtp,
  generateSecureToken,
  hashValue,
  normalizeEmail,
  otpTtlMinutes,
  sendEmailOtp
};
