import express from 'express';
import { Thread, Message, User } from '../models/index.js';

const router = express.Router();

// GET /api/admin/dashboard - Get admin dashboard data
router.get('/dashboard', async (req, res) => {
  try {
    const { userId } = req.query;

    console.log('\n🛡️  ADMIN DASHBOARD REQUEST | User ID:', userId);

    // Check if admin
    if (userId !== 'admin_001') {
      console.log('❌ ACCESS DENIED: Not admin');
      return res.status(403).json({ 
        success: false, 
        message: 'Admin access required' 
      });
    }

    const [threads, users] = await Promise.all([
      Thread.find({ expiresAt: { $gt: new Date() } })
        .populate('members', 'username')
        .lean(),
      User.find({ isAdmin: false }).lean()
    ]);

    console.log('📊 ADMIN DASHBOARD DATA:');
    console.log(`  └─ Total Threads: ${threads.length}`);
    console.log(`  └─ Total Users: ${users.length}`);
    console.log(`  └─ Active Users: ${users.length}`);

    const threadsWithDetails = await Promise.all(
      threads.map(async (thread) => {
        // Get all messages for this thread
        const messages = await Message.find({ threadId: thread._id })
          .sort({ timestamp: 1 })
          .lean();
        
        return {
          id: thread._id.toString(),
          title: thread.title,
          description: thread.description,
          creator: thread.creatorUsername,
          creatorId: thread.creator.toString(),
          location: thread.location,
          tags: thread.tags,
          members: thread.members.map(m => m._id.toString()),
          pendingRequests: thread.pendingRequests.map(p => p.toString()),
          memberDetails: thread.members.map(member => ({
            id: member._id.toString(),
            username: member.username
          })),
          chat: messages.map(msg => ({
            id: msg._id.toString(),
            user: msg.username,
            userId: msg.userId.toString(),
            message: msg.message,
            timestamp: msg.timestamp.toISOString()
          })),
          expiresAt: thread.expiresAt.toISOString(),
          createdAt: thread.createdAt.toISOString()
        };
      })
    );

    const dashboardData = {
      totalThreads: threads.length,
      totalUsers: users.length + 1,
      activeUsers: users.length,
      threads: threadsWithDetails,
      users: users.map(user => ({
        id: user._id.toString(),
        username: user.username,
        createdAt: user.createdAt.toISOString()
      }))
    };

    console.log('✅ ADMIN DASHBOARD DATA SENT');
    res.json({ success: true, data: dashboardData });
  } catch (error) {
    console.error('❌ ADMIN DASHBOARD ERROR:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching admin dashboard' 
    });
  }
});

export default router;