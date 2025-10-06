import express from 'express';
import { Thread, Message, User } from '../models/index.js';

const router = express.Router();

// GET /api/threads - Get all active threads
router.get('/', async (req, res) => {
  try {
    console.log('\n📋 FETCHING ALL ACTIVE THREADS...');
    
    const threads = await Thread.find({
      expiresAt: { $gt: new Date() }
    })
    .sort({ createdAt: -1 })
    .lean();

    console.log(`📊 FOUND ${threads.length} ACTIVE THREADS`);

    const threadsWithMessages = await Promise.all(
      threads.map(async (thread) => {
        const messages = await Message.find({ threadId: thread._id })
          .sort({ timestamp: 1 })
          .lean();

        console.log(`  └─ 📌 "${thread.title}" | Creator: ${thread.creatorUsername} | Members: ${thread.members.length} | Messages: ${messages.length}`);

        return {
          id: thread._id.toString(),
          title: thread.title,
          description: thread.description,
          creator: thread.creatorUsername,
          creatorId: thread.creator.toString(),
          location: thread.location,
          tags: thread.tags,
          expiresAt: thread.expiresAt.toISOString(),
          members: thread.members.map(m => m.toString()),
          pendingRequests: thread.pendingRequests.map(p => p.toString()),
          chat: messages.map(msg => ({
            id: msg._id.toString(),
            user: msg.username,
            userId: msg.userId.toString(),
            message: msg.message,
            timestamp: msg.timestamp.toISOString()
          })),
          createdAt: thread.createdAt.toISOString()
        };
      })
    );

    res.json({ success: true, threads: threadsWithMessages });
  } catch (error) {
    console.error('❌ GET THREADS ERROR:', error);
    res.status(500).json({ success: false, message: 'Error fetching threads' });
  }
});

// POST /api/threads - Create new thread
router.post('/', async (req, res) => {
  try {
    const { title, description, creator, creatorId, location, tags, expiresAt } = req.body;

    console.log('\n🎯 CREATING NEW THREAD...');
    console.log(`  📝 Title: ${title}`);
    console.log(`  👤 Creator: ${creator} (ID: ${creatorId})`);
    console.log(`  📍 Location: ${location}`);
    console.log(`  🏷️  Tags: ${tags.join(', ')}`);
    console.log(`  ⏰ Expires: ${new Date(expiresAt).toLocaleString()}`);

    const thread = new Thread({
      title,
      description,
      creator: creatorId,
      creatorUsername: creator,
      location,
      tags,
      members: [creatorId],
      pendingRequests: [],
      expiresAt: new Date(expiresAt)
    });

    await thread.save();
    console.log(`✅ THREAD CREATED | ID: ${thread._id}`);

    // Create welcome message
    const welcomeMessage = new Message({
      threadId: thread._id,
      userId: creatorId,
      username: creator,
      message: 'Thread created! Welcome everyone 👋'
    });
    await welcomeMessage.save();
    console.log(`💬 WELCOME MESSAGE ADDED`);

    res.status(201).json({
      success: true,
      thread: {
        id: thread._id.toString(),
        title: thread.title,
        description: thread.description,
        creator: thread.creatorUsername,
        creatorId: thread.creator.toString(),
        location: thread.location,
        tags: thread.tags,
        expiresAt: thread.expiresAt.toISOString(),
        members: [creatorId],
        pendingRequests: [],
        chat: [{
          id: welcomeMessage._id.toString(),
          user: creator,
          userId: creatorId,
          message: 'Thread created! Welcome everyone 👋',
          timestamp: welcomeMessage.timestamp.toISOString()
        }],
        createdAt: thread.createdAt.toISOString()
      }
    });
  } catch (error) {
    console.error('❌ CREATE THREAD ERROR:', error);
    res.status(500).json({ success: false, message: 'Error creating thread' });
  }
});

// DELETE /api/threads/:id - Delete thread (admin only)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    console.log(`\n🗑️  DELETE THREAD REQUEST | Thread ID: ${id} | By User: ${userId}`);

    // Check if admin
    if (userId !== 'admin_001') {
      console.log('❌ DELETE FAILED: Not admin');
      return res.status(403).json({ 
        success: false, 
        message: 'Admin access required' 
      });
    }

    await Promise.all([
      Thread.findByIdAndDelete(id),
      Message.deleteMany({ threadId: id })
    ]);

    console.log('✅ THREAD DELETED SUCCESSFULLY');
    res.json({ success: true, message: 'Thread deleted' });
  } catch (error) {
    console.error('❌ DELETE THREAD ERROR:', error);
    res.status(500).json({ success: false, message: 'Error deleting thread' });
  }
});

// POST /api/threads/:id/join - Request to join thread
router.post('/:id/join', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    console.log(`\n🙋 JOIN REQUEST | Thread ID: ${id} | User ID: ${userId}`);

    const thread = await Thread.findById(id);
    if (!thread) {
      console.log('❌ JOIN FAILED: Thread not found');
      return res.status(404).json({ success: false, message: 'Thread not found' });
    }

    if (thread.members.includes(userId) || thread.pendingRequests.includes(userId)) {
      console.log('❌ JOIN FAILED: Already member or pending');
      return res.status(400).json({ 
        success: false, 
        message: 'Already a member or request pending' 
      });
    }

    thread.pendingRequests.push(userId);
    await thread.save();

    console.log(`✅ JOIN REQUEST SENT | Thread: "${thread.title}"`);
    res.json({ success: true, message: 'Join request sent' });
  } catch (error) {
    console.error('❌ JOIN REQUEST ERROR:', error);
    res.status(500).json({ success: false, message: 'Error sending join request' });
  }
});

// POST /api/threads/:id/requests - Handle join request
// POST /api/threads/:id/requests - Handle join request
router.post('/:id/requests', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, approve, currentUserId } = req.body;

    console.log(`\n${approve ? '✅' : '❌'} HANDLING JOIN REQUEST | Thread ID: ${id} | User ID: ${userId} | Action: ${approve ? 'APPROVE' : 'REJECT'}`);

    const thread = await Thread.findById(id);
    if (!thread) {
      console.log('❌ HANDLE REQUEST FAILED: Thread not found');
      return res.status(404).json({ success: false, message: 'Thread not found' });
    }

    if (thread.creator.toString() !== currentUserId) {
      console.log('❌ HANDLE REQUEST FAILED: Not thread creator');
      return res.status(403).json({ 
        success: false, 
        message: 'Only thread creator can handle requests' 
      });
    }

    thread.pendingRequests = thread.pendingRequests.filter(
      reqId => reqId.toString() !== userId
    );

    if (approve) {
      thread.members.push(userId);
      
      const user = await User.findById(userId);
      console.log(`👥 USER APPROVED: ${user?.username} | Thread: "${thread.title}"`);
      
      // FIX: Use the actual user's ID instead of 'system'
      const welcomeMessage = new Message({
        threadId: id,
        userId: userId,  // ✅ Changed from 'system' to userId
        username: 'System',
        message: `${user?.username || 'User'} joined the thread!`
      });
      await welcomeMessage.save();
      console.log(`💬 WELCOME MESSAGE SENT`);
    } else {
      console.log(`🚫 USER REJECTED | Thread: "${thread.title}"`);
    }

    await thread.save();

    res.json({ 
      success: true, 
      message: approve ? 'User approved' : 'User rejected' 
    });
  } catch (error) {
    console.error('❌ HANDLE REQUEST ERROR:', error);
    res.status(500).json({ success: false, message: 'Error handling request' });
  }
});
// POST /api/threads/:id/messages - Send message
router.post('/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    const { user, userId, message } = req.body;

    console.log(`\n💬 NEW MESSAGE | Thread ID: ${id} | User: ${user} | Message: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`);

    const newMessage = new Message({
      threadId: id,
      userId,
      username: user,
      message
    });
    
    await newMessage.save();
    console.log(`✅ MESSAGE SAVED | ID: ${newMessage._id}`);

    res.status(201).json({
      success: true,
      message: {
        id: newMessage._id.toString(),
        user: newMessage.username,
        userId: newMessage.userId.toString(),
        message: newMessage.message,
        timestamp: newMessage.timestamp.toISOString()
      }
    });
  } catch (error) {
    console.error('❌ SEND MESSAGE ERROR:', error);
    res.status(500).json({ success: false, message: 'Error sending message' });
  }
});
// PUT /api/threads/:id - Update thread (creator only)
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, location, tags, userId } = req.body;

    console.log(`\n✏️  UPDATE THREAD REQUEST | Thread ID: ${id} | User ID: ${userId}`);

    const thread = await Thread.findById(id);
    if (!thread) {
      console.log('❌ UPDATE FAILED: Thread not found');
      return res.status(404).json({ success: false, message: 'Thread not found' });
    }

    // Check if user is the creator
    if (thread.creator.toString() !== userId) {
      console.log('❌ UPDATE FAILED: Not thread creator');
      return res.status(403).json({ 
        success: false, 
        message: 'Only thread creator can update' 
      });
    }

    // Update fields
    thread.title = title;
    thread.description = description;
    thread.location = location;
    thread.tags = tags;
    
    await thread.save();

    console.log(`✅ THREAD UPDATED | Title: ${title}`);

    res.json({
      success: true,
      message: 'Thread updated successfully',
      thread: {
        id: thread._id.toString(),
        title: thread.title,
        description: thread.description,
        location: thread.location,
        tags: thread.tags
      }
    });
  } catch (error) {
    console.error('❌ UPDATE THREAD ERROR:', error);
    res.status(500).json({ success: false, message: 'Error updating thread' });
  }
});
export default router;