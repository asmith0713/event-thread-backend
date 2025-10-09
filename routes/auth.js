import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../models/index.js';

const router = express.Router();

// POST /api/auth/register - User registration with specific errors
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    console.log('📝 USER REGISTRATION ATTEMPT:', username);

    // Specific validation messages
    if (!username) {
      return res.status(400).json({
        success: false,
        message: 'Username is required'
      });
    }

    if (!password) {
      return res.status(400).json({
        success: false,
        message: 'Password is required'
      });
    }

    if (username.length < 3) {
      return res.status(400).json({
        success: false,
        message: 'Username must be at least 3 characters long'
      });
    }

    if (username.length > 30) {
      return res.status(400).json({
        success: false,
        message: 'Username cannot be longer than 30 characters'
      });
    }

    // Check for invalid characters in username
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({
        success: false,
        message: 'Username can only contain letters, numbers, and underscores'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    if (password.length > 128) {
      return res.status(400).json({
        success: false,
        message: 'Password cannot be longer than 128 characters'
      });
    }

    // Check if username already exists (SPECIFIC ERROR)
    const existingUser = await User.findOne({ 
      username: username.toLowerCase().trim() 
    });

    if (existingUser) {
      console.log('❌ REGISTRATION FAILED - Username taken:', username);
      return res.status(409).json({
        success: false,
        message: 'Username already taken. Please choose a different username.'
      });
    }

    // Create new user
    const user = new User({
      username: username.toLowerCase().trim(),
      password: password // Will be hashed by pre-save middleware
    });

    await user.save();

    // Generate JWT token
    const token = jwt.sign(
      { 
        id: user._id.toString(), 
        username: user.username, 
        isAdmin: user.isAdmin 
      },
      process.env.JWT_SECRET || 'your-default-secret',
      { expiresIn: '7d' }
    );

    console.log('✅ USER REGISTERED SUCCESSFULLY:', username, '| ID:', user._id);

    res.status(201).json({
      success: true,
      message: 'Account created successfully! Welcome to Event Threads!',
      user: {
        id: user._id.toString(),
        username: user.username,
        isAdmin: user.isAdmin,
        createdAt: user.createdAt
      },
      token: token
    });

  } catch (error) {
    console.error('❌ REGISTRATION ERROR:', error);

    // Handle specific database errors
    if (error.code === 11000) {
      // Duplicate key error
      return res.status(409).json({
        success: false,
        message: 'Username already taken. Please choose a different username.'
      });
    }

    if (error.name === 'ValidationError') {
      // Mongoose validation error
      const field = Object.keys(error.errors)[0];
      const message = error.errors[field].message;
      return res.status(400).json({
        success: false,
        message: message || 'Invalid data provided'
      });
    }

    // Database connection or other server errors
    return res.status(500).json({
      success: false,
      message: 'Unable to create account. Please try again in a few moments.'
    });
  }
});

// POST /api/auth/login - User/Admin login with specific errors
router.post('/login', async (req, res) => {
  try {
    const { username, password, isAdmin } = req.body;

    // Specific validation messages
    if (!username) {
      return res.status(400).json({
        success: false,
        message: 'Username is required'
      });
    }

    if (!password) {
      return res.status(400).json({
        success: false,
        message: 'Password is required'
      });
    }

    if (isAdmin) {
      // Admin login with specific error messages
      console.log('🔐 ADMIN LOGIN ATTEMPT:', username);

      if (username !== process.env.ADMIN_USERNAME) {
        console.log('❌ ADMIN LOGIN FAILED - Invalid username:', username);
        return res.status(401).json({
          success: false,
          message: 'Invalid admin username'
        });
      }

      if (password !== process.env.ADMIN_PASSWORD) {
        console.log('❌ ADMIN LOGIN FAILED - Invalid password:', username);
        return res.status(401).json({
          success: false,
          message: 'Invalid admin password'
        });
      }

      console.log('✅ ADMIN LOGIN SUCCESSFUL:', username);

      // Generate admin token
      const adminToken = jwt.sign(
        { id: 'admin_001', username: process.env.ADMIN_USERNAME, isAdmin: true },
        process.env.JWT_SECRET || 'your-default-secret',
        { expiresIn: '1d' }
      );

      return res.json({
        success: true,
        user: {
          id: 'admin_001',
          username: process.env.ADMIN_USERNAME,
          isAdmin: true
        },
        token: adminToken,
        message: 'Admin login successful'
      });
    } else {
      // Regular user login with password verification
      console.log('👤 USER LOGIN ATTEMPT:', username);

      // Find user by username
      const user = await User.findOne({ 
        username: username.toLowerCase().trim() 
      });

      if (!user) {
        console.log('❌ USER LOGIN FAILED - User not found:', username);
        return res.status(401).json({
          success: false,
          message: 'Username not found. Please check your username or create a new account.'
        });
      }

      // Check if user has a password (for migration from old system)
      if (!user.password) {
        console.log('❌ USER LOGIN FAILED - No password set:', username);
        return res.status(400).json({
          success: false,
          message: 'This account needs to be updated. Please create a new account with a password.'
        });
      }

      // Verify password
      let isPasswordValid = false;
      try {
        isPasswordValid = await user.comparePassword(password);
      } catch (passwordError) {
        console.log('❌ PASSWORD VERIFICATION ERROR:', passwordError);
        return res.status(500).json({
          success: false,
          message: 'Unable to verify password. Please try again.'
        });
      }

      if (!isPasswordValid) {
        console.log('❌ USER LOGIN FAILED - Wrong password:', username);
        return res.status(401).json({
          success: false,
          message: 'Incorrect password. Please check your password and try again.'
        });
      }

      // Generate JWT token
      const token = jwt.sign(
        { 
          id: user._id.toString(), 
          username: user.username, 
          isAdmin: user.isAdmin 
        },
        process.env.JWT_SECRET || 'your-default-secret',
        { expiresIn: '7d' }
      );

      console.log('✅ USER LOGIN SUCCESSFUL:', username, '| ID:', user._id);

      // Update last login time
      try {
        user.lastLogin = new Date();
        await user.save();
      } catch (updateError) {
        // Don't fail login if we can't update last login time
        console.log('⚠️ Could not update last login time:', updateError);
      }

      return res.json({
        success: true,
        user: {
          id: user._id.toString(),
          username: user.username,
          isAdmin: user.isAdmin,
          lastLogin: user.lastLogin
        },
        token: token,
        message: 'Login successful! Welcome back!'
      });
    }
  } catch (error) {
    console.error('❌ LOGIN ERROR:', error);

    // Handle specific database errors
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid user data. Please try again.'
      });
    }

    if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
      return res.status(503).json({
        success: false,
        message: 'Database connection error. Please try again in a few moments.'
      });
    }

    // Generic server error as last resort
    return res.status(500).json({
      success: false,
      message: 'Login service temporarily unavailable. Please try again.'
    });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  try {
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('❌ LOGOUT ERROR:', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed. Please clear your browser data.'
    });
  }
});

export default router;