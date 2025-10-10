import express from 'express';
import { Thread, Message, User } from '../models/index.js';

const router = express.Router();

// GET /api/threads - Get all active threads with messages
router.get('/', async (req, res) => {
  try {
    const viewerId = req.query.userId;
    const threads = await Thread.find({ expiresAt: { $gt: new Date() } })
      .sort({ createdAt: -1 })
      .populate('members', 'username')
      .populate('pendingRequests', 'username')
      .lean();

    const threadsWithMessages = await Promise.all(
      threads.map(async (thread) => {
        const isMember = viewerId && (thread.creator.toString() === viewerId || thread.members.some((m) => (m?._id ? m._id.toString() : m.toString()) === viewerId));
        const messages = isMember
          ? await Message.find({ threadId: thread._id }).sort({ timestamp: 1 }).lean()
          : [];
        const memberProfiles = (thread.members || []).map((m) => ({
          userId: (m?._id ? m._id.toString() : m.toString()),
          username: m && m.username ? m.username : undefined,
        }));
        return {
          id: thread._id.toString(),
          title: thread.title,
          description: thread.description,
          creator: thread.creatorUsername,
          creatorId: thread.creator.toString(),
          location: thread.location,
          tags: thread.tags,
          requiresApproval: typeof thread.requiresApproval === 'boolean' ? thread.requiresApproval : true,
          expiresAt: thread.expiresAt.toISOString(),
          members: thread.members.map((m) => (m?._id ? m._id.toString() : m.toString())),
          memberProfiles,
          pendingRequests: thread.pendingRequests.map((req) => ({
            userId: req._id.toString(),
            username: req.username,
            requestedAt: new Date().toISOString(),
          })),
          chat: messages.map((msg) => ({
            id: msg._id.toString(),
            user: msg.username,
            userId: msg.userId.toString(),
            message: msg.message,
            timestamp: msg.timestamp.toISOString(),
          })),
          createdAt: thread.createdAt.toISOString(),
        };
      })
    );

    res.json({ success: true, threads: threadsWithMessages });
  } catch (error) {
    console.error('GET THREADS ERROR:', error);
    res.status(500).json({ success: false, message: 'Error fetching threads' });
  }
});

// POST /api/threads - Create new thread
router.post('/', async (req, res) => {
  try {
    const { title, description, creator, creatorId, location, tags, expiresAt, requiresApproval } = req.body;

    const thread = new Thread({
      title,
      description,
      creator: creatorId,
      creatorUsername: creator,
      location,
      tags: tags || [],
      members: [creatorId],
      pendingRequests: [],
      requiresApproval: typeof requiresApproval === 'boolean' ? requiresApproval : true,
      expiresAt: new Date(expiresAt),
    });

    await thread.save();

    const welcomeMessage = new Message({
      threadId: thread._id,
      userId: creatorId,
      username: creator,
      message: 'Thread created! Welcome everyone',
    });
    await welcomeMessage.save();

    // Realtime: broadcast new thread to all clients
    try {
      const { getSocketIO } = await import('../socket.js');
      const io = getSocketIO();
      if (io) {
        io.emit('threadCreated', {
          id: thread._id.toString(),
          title: thread.title,
          description: thread.description,
          creator: thread.creatorUsername,
          creatorId: thread.creator.toString(),
          location: thread.location,
          tags: thread.tags,
          requiresApproval: thread.requiresApproval,
          expiresAt: thread.expiresAt.toISOString(),
          members: [creatorId],
          memberProfiles: [{ userId: creatorId, username: creator }],
          pendingRequests: [],
          createdAt: thread.createdAt.toISOString(),
        });
      }
    } catch {}

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
        requiresApproval: thread.requiresApproval,
        expiresAt: thread.expiresAt.toISOString(),
        members: [creatorId],
        pendingRequests: [],
        chat: [
          {
            id: welcomeMessage._id.toString(),
            user: creator,
            userId: creatorId,
            message: welcomeMessage.message,
            timestamp: welcomeMessage.timestamp.toISOString(),
          },
        ],
        createdAt: thread.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('CREATE THREAD ERROR:', error);
    res.status(500).json({ success: false, message: 'Error creating thread' });
  }
});

// DELETE /api/threads/:id - Delete thread (admin or creator)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    const thread = await Thread.findById(id);
    if (!thread) return res.status(404).json({ success: false, message: 'Thread not found' });

    const isAdmin = userId === 'admin_001';
    const isCreator = thread.creator.toString() === userId;
    if (!isAdmin && !isCreator) {
      return res.status(403).json({ success: false, message: 'Only admin or creator can delete the thread' });
    }

    // Notify connected users before deletion
    try {
      const { getSocketIO } = await import('../socket.js');
      const io = getSocketIO();
      if (io) {
        io.to(id.toString()).emit('threadDeleted', {
          threadId: id,
          deletedBy: isAdmin ? 'admin' : 'creator',
        });
      }
    } catch {}

    await Promise.all([Thread.findByIdAndDelete(id), Message.deleteMany({ threadId: id })]);
    res.json({ success: true, message: 'Thread deleted' });
  } catch (error) {
    console.error('DELETE THREAD ERROR:', error);
    res.status(500).json({ success: false, message: 'Error deleting thread' });
  }
});

// POST /api/threads/:id/join - Request to join thread
router.post('/:id/join', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    const thread = await Thread.findById(id);
    if (!thread) return res.status(404).json({ success: false, message: 'Thread not found' });

    const isMember = thread.members.some((m) => m.toString() === userId);
    const alreadyPending = thread.pendingRequests.some((p) => p.toString() === userId);
    if (isMember) {
      return res.status(400).json({ success: false, message: 'Already a member' });
    }

    // If approvals are not required, add immediately
    if (thread.requiresApproval === false) {
      if (alreadyPending) {
        thread.pendingRequests = thread.pendingRequests.filter((p) => p.toString() !== userId);
      }
      thread.members.push(userId);
      const user = await User.findById(userId).select('username').lean();

      const welcomeMessage = new Message({
        threadId: id,
        userId: userId,
        username: 'System',
        message: `${user?.username || 'User'} joined the thread!`,
      });
      await welcomeMessage.save();

      await thread.save();

      // Real-time notify thread room about new member and message
      try {
        const { getSocketIO } = await import('../socket.js');
        const io = getSocketIO();
        if (io) {
          io.to(id.toString()).emit('newMessage', {
            id: welcomeMessage._id.toString(),
            threadId: id,
            userId: welcomeMessage.userId.toString(),
            username: welcomeMessage.username,
            message: welcomeMessage.message,
            timestamp: welcomeMessage.timestamp.toISOString(),
          });
          io.to(id.toString()).emit('membershipChanged', {
            threadId: id,
            userId,
            username: user?.username || 'User',
          });
        }
      } catch {}

      return res.json({ success: true, message: 'Joined thread' });
    }

    // Otherwise, create a pending request and notify creator
    thread.pendingRequests.push(userId);
    await thread.save();

    try {
      const { getSocketIO } = await import('../socket.js');
      const io = getSocketIO();
      if (io) {
        const requester = await User.findById(userId).select('username').lean();
        io.to(`user:${thread.creator.toString()}`).emit('joinRequest', {
          threadId: id,
          userId,
          username: requester?.username || 'User',
        });
      }
    } catch {}

    res.json({ success: true, message: 'Join request sent' });
  } catch (error) {
    console.error('JOIN REQUEST ERROR:', error);
    res.status(500).json({ success: false, message: 'Error sending join request' });
  }
});

// POST /api/threads/:id/requests - Approve/Reject join request
router.post('/:id/requests', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, approve, currentUserId } = req.body;

    const thread = await Thread.findById(id);
    if (!thread) return res.status(404).json({ success: false, message: 'Thread not found' });
    if (thread.creator.toString() !== currentUserId) {
      return res.status(403).json({ success: false, message: 'Only thread creator can handle requests' });
    }

    // Remove from pending
    thread.pendingRequests = thread.pendingRequests.filter((reqId) => reqId.toString() !== userId);

    if (approve) {
      thread.members.push(userId);
      const user = await User.findById(userId);
      const welcomeMessage = new Message({
        threadId: id,
        userId: userId,
        username: 'System',
        message: `${user?.username || 'User'} joined the thread!`,
      });
      await welcomeMessage.save();

      // Real-time notify requester and thread room
      try {
        const { getSocketIO } = await import('../socket.js');
        const io = getSocketIO();
        if (io) {
          io.to(`user:${userId}`).emit('requestHandled', { threadId: id, approved: true });
          io.to(id.toString()).emit('newMessage', {
            id: welcomeMessage._id.toString(),
            threadId: id,
            userId: welcomeMessage.userId.toString(),
            username: welcomeMessage.username,
            message: welcomeMessage.message,
            timestamp: welcomeMessage.timestamp.toISOString(),
          });
          io.to(id.toString()).emit('membershipChanged', {
            threadId: id,
            userId,
            username: user?.username || 'User',
          });
        }
      } catch {}
    }

    await thread.save();

    if (!approve) {
      try {
        const { getSocketIO } = await import('../socket.js');
        const io = getSocketIO();
        if (io) io.to(`user:${userId}`).emit('requestHandled', { threadId: id, approved: false });
      } catch {}
    }

    res.json({ success: true, message: approve ? 'User approved' : 'User rejected' });
  } catch (error) {
    console.error('HANDLE REQUEST ERROR:', error);
    res.status(500).json({ success: false, message: 'Error handling request' });
  }
});

// POST /api/threads/:id/messages - Send message
router.post('/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    const { user, userId, message } = req.body;

    const newMessage = new Message({ threadId: id, userId, username: user, message });
    await newMessage.save();

    // Also emit in real-time for API-based sends
    try {
      const { getSocketIO } = await import('../socket.js');
      const io = getSocketIO();
      if (io) {
        io.to(id.toString()).emit('newMessage', {
          id: newMessage._id.toString(),
          threadId: id,
          userId: newMessage.userId.toString(),
          username: newMessage.username,
          message: newMessage.message,
          timestamp: newMessage.timestamp.toISOString(),
        });
      }
    } catch {}

    res.status(201).json({
      success: true,
      message: {
        id: newMessage._id.toString(),
        user: newMessage.username,
        userId: newMessage.userId.toString(),
        message: newMessage.message,
        timestamp: newMessage.timestamp.toISOString(),
      },
    });
  } catch (error) {
    console.error('SEND MESSAGE ERROR:', error);
    res.status(500).json({ success: false, message: 'Error sending message' });
  }
});

// PUT /api/threads/:id - Update thread (creator only)
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, location, tags, userId } = req.body;

    const thread = await Thread.findById(id);
    if (!thread) return res.status(404).json({ success: false, message: 'Thread not found' });
    if (thread.creator.toString() !== userId) {
      return res.status(403).json({ success: false, message: 'Only thread creator can update' });
    }

    thread.title = title;
    thread.description = description;
    thread.location = location;
    thread.tags = tags;
    await thread.save();

    // Realtime: broadcast thread update
    try {
      const { getSocketIO } = await import('../socket.js');
      const io = getSocketIO();
      if (io) {
        io.emit('threadUpdated', {
          id: thread._id.toString(),
          title: thread.title,
          description: thread.description,
          location: thread.location,
          tags: thread.tags,
        });
      }
    } catch {}

    res.json({
      success: true,
      message: 'Thread updated successfully',
      thread: {
        id: thread._id.toString(),
        title: thread.title,
        description: thread.description,
        location: thread.location,
        tags: thread.tags,
      },
    });
  } catch (error) {
    console.error('UPDATE THREAD ERROR:', error);
    res.status(500).json({ success: false, message: 'Error updating thread' });
  }
});

export default router;
