import express from 'express';
import { User } from '../models/index.js';

const router = express.Router();

// POST /api/auth/login - User/Admin login
router.post('/login', async (req, res) => {
  try {
    const { username, password, isAdmin } = req.body;

    if (isAdmin) {
      // Admin login
      console.log('🔐 ADMIN LOGIN ATTEMPT:', username);
      if (
        username === process.env.ADMIN_USERNAME && 
        password === process.env.ADMIN_PASSWORD
      ) {
        console.log('✅ ADMIN LOGIN SUCCESSFUL:', username);
        return res.json({
          success: true,
          user: {
            id: 'admin_001',
            username: process.env.ADMIN_USERNAME,
            isAdmin: true
          },
          message: 'Admin login successful'
        });
      }
      console.log('❌ ADMIN LOGIN FAILED:', username);
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid admin credentials' 
      });
    } else {
      // Regular user login/signup
      console.log('👤 USER LOGIN ATTEMPT:', username);
      let user = await User.findOne({ username });
      
      if (!user) {
        // Create new user if doesn't exist
        console.log('🆕 CREATING NEW USER:', username);
        user = new User({ username });
        await user.save();
        console.log('✅ NEW USER CREATED:', username, '| ID:', user._id);
      } else {
        console.log('✅ EXISTING USER LOGGED IN:', username, '| ID:', user._id);
      }
      
      return res.json({
        success: true,
        user: {
          id: user._id.toString(),
          username: user.username,
          isAdmin: false
        }
      });
    }
  } catch (error) {
    console.error('❌ LOGIN ERROR:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({ 
        success: false, 
        message: 'Username already exists' 
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: 'Server error during login' 
    });
  }
});

export default router;