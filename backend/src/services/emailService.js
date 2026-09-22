import nodemailer from 'nodemailer';

const createTransporter = () => {
  const isProduction = process.env.NODE_ENV === 'production';
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: process.env.EMAIL_PORT || 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    },
    tls: {
      rejectUnauthorized: isProduction,
      minVersion: 'TLSv1.2'
    }
  });
};

export const sendPasswordResetEmail = async (email, resetToken, frontendUrl) => {
  const transporter = createTransporter();

  const resetUrl = `${frontendUrl}/reset-password/${resetToken}`;

  const mailOptions = {
    from: `"Task Manager" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Reset your Task Manager password',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #f8f9fa; border-radius: 12px; padding: 40px; border: 1px solid #e9ecef;">
          <h1 style="color: #2c3e50; margin-top: 0; font-size: 24px;">Reset your Task Manager password</h1>
          
          <p style="font-size: 16px; color: #555;">Hello,</p>
          
          <p style="font-size: 16px; color: #555;">We received a request to reset your Task Manager password.</p>
          
          <p style="font-size: 16px; color: #555;">Click the button below to create a new password:</p>
          
          <div style="text-align: center; margin: 32px 0;">
            <a href="${resetUrl}" style="display: inline-block; background: #3b82f6; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-size: 16px; font-weight: 600;">Reset Password</a>
          </div>
          
          <p style="font-size: 14px; color: #888;">Or copy and paste this link into your browser:</p>
          <p style="font-size: 13px; color: #3b82f6; word-break: break-all; background: #f1f5f9; padding: 12px; border-radius: 6px;">${resetUrl}</p>
          
          <p style="font-size: 14px; color: #888; margin-top: 24px;">This password reset link expires in <strong>15 minutes</strong>.</p>
          
          <hr style="border: none; border-top: 1px solid #e9ecef; margin: 24px 0;">
          
          <p style="font-size: 13px; color: #888; margin: 0;">If you did not request this password reset, you can safely ignore this email. Your password will remain unchanged.</p>
          
          <p style="font-size: 13px; color: #888; margin-top: 16px;">Regards,<br>Task Manager Team</p>
        </div>
      </body>
      </html>
    `,
    text: `
Reset your Task Manager password

Hello,

We received a request to reset your Task Manager password.

Click the link below to create a new password:
${resetUrl}

This password reset link expires in 15 minutes.

If you did not request this password reset, you can safely ignore this email. Your password will remain unchanged.

Regards,
Task Manager Team
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    return { success: true };
  } catch (error) {
    console.error('Email sending failed:', error.message);
    return { success: false, error: error.message };
  }
};