import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import User from '../models/userModel.js';
import { config } from '../config/config.js';
import { sendPasswordResetEmail } from '../services/emailService.js';

export const authController = {
  // POST /register
  register: async (req, res, next) => {
    try {
      const { email, password } = req.body || {};

      // Server-side validation
      if (!email || typeof email !== 'string' || !email.trim()) {
        return res.status(400).json({ error: 'Email is required' });
      }

      if (!password || typeof password !== 'string' || !password.trim()) {
        return res.status(400).json({ error: 'Password is required' });
      }

      const normalizedEmail = email.trim().toLowerCase();

      // Check for duplicate email
      const existingUser = await User.findOne({ email: normalizedEmail });
      if (existingUser) {
        return res.status(400).json({ error: 'Email already registered' });
      }

      // Hash password with bcryptjs
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create new user
      const user = await User.create({
        email: normalizedEmail,
        password: hashedPassword
      });

      const userResponse = user.toJSON();

      res.status(201).json({
        message: 'User registered successfully',
        user: userResponse
      });
    } catch (error) {
      if (error.code === 11000) {
        return res.status(400).json({ error: 'Email already registered' });
      }
      next(error);
    }
  },

  // POST /login
  login: async (req, res, next) => {
    try {
      const { email, password } = req.body || {};

      // Server-side validation
      if (!email || typeof email !== 'string' || !email.trim()) {
        return res.status(400).json({ error: 'Email is required' });
      }

      if (!password || typeof password !== 'string' || !password.trim()) {
        return res.status(400).json({ error: 'Password is required' });
      }

      const normalizedEmail = email.trim().toLowerCase();

      // Find user by email
      const user = await User.findOne({ email: normalizedEmail });
      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Compare password
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const jwtSecret = process.env.JWT_SECRET || config.jwtSecret;

      // Generate JWT token
      const token = jwt.sign(
        { id: user._id },
        jwtSecret,
        { expiresIn: '1h' }
      );

      const userResponse = user.toJSON();

      res.status(200).json({
        token,
        user: userResponse
      });
    } catch (error) {
      next(error);
    }
  },

  // GET /me
  getMe: async (req, res, next) => {
    try {
      const userId = req.user.id;
      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.status(200).json(user.toJSON());
    } catch (error) {
      next(error);
    }
  },

  // POST /forgot-password
  forgotPassword: async (req, res, next) => {
    try {
      const { email } = req.body || {};

      if (!email || typeof email !== 'string' || !email.trim()) {
        return res.status(400).json({ error: 'Email is required' });
      }

      const normalizedEmail = email.trim().toLowerCase();

      // Find user by email (but don't reveal if user exists)
      const user = await User.findOne({ email: normalizedEmail });

      // Always return success message to prevent account enumeration
      const genericResponse = {
        message: 'If an account exists for this email, a password reset link has been sent.'
      };

      if (!user) {
        return res.status(200).json(genericResponse);
      }

      // Generate cryptographically secure reset token
      const resetToken = crypto.randomBytes(32).toString('hex');

      // Hash token before storing
      const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

      // Set expiration (15 minutes)
      const expires = new Date(Date.now() + 15 * 60 * 1000);

      // Save hashed token and expiration to user
      user.resetPasswordToken = hashedToken;
      user.resetPasswordExpires = expires;
      await user.save();

      // Send reset email
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      const emailResult = await sendPasswordResetEmail(user.email, resetToken, frontendUrl);

      if (!emailResult.success) {
        // Don't reveal email failure to user, but log it
        console.error('Failed to send password reset email:', emailResult.error);
      }

      res.status(200).json(genericResponse);
    } catch (error) {
      next(error);
    }
  },

  // POST /reset-password/:token
  resetPassword: async (req, res, next) => {
    try {
      const { token } = req.params;
      const { password } = req.body || {};

      if (!password || typeof password !== 'string' || !password.trim()) {
        return res.status(400).json({ error: 'Password is required' });
      }

      // Hash the received token to compare with stored hash
      const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

      // Find user with matching hashed token and valid expiration
      const user = await User.findOne({
        resetPasswordToken: hashedToken,
        resetPasswordExpires: { $gt: new Date() }
      });

      if (!user) {
        return res.status(400).json({ error: 'Invalid or expired reset token' });
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Update password and clear reset token fields
      user.password = hashedPassword;
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save();

      res.status(200).json({ message: 'Password reset successfully' });
    } catch (error) {
      next(error);
    }
  }
};
