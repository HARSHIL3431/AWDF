import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/userModel.js';
import { config } from '../config/config.js';

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
  }
};
