import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import http from 'http';
import { Server } from 'socket.io';

import connectDB from './config/database.js';
import authRoutes from './routes/auth.js';
import threadRoutes from './routes/threads.js';
import adminRoutes from './routes/admin.js';
import { Message, Thread } from './models/index.js';
import { setSocketIO } from './socket.js';

dotenv.config();

const app = express();
const server = http.createServer(app);

// CORS
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'https://konekt-blue.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
].filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      console.log('CORS blocked origin:', origin);
      return cb(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    maxAge: 86400,
    optionsSuccessStatus: 204,
  })
);

// Preflight
app.options('*', cors());

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// DB
connectDB();

// Request log
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.path} - Origin: ${req.headers.origin || 'No origin'}`);
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/threads', threadRoutes);
app.use('/api/admin', adminRoutes);

// Health
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', message: 'EventThreads API is running' });
});

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found', path: req.path });
});

// Error handler
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('Error:', err.stack || err);
  res.status(500).json({ success: false, message: 'Something went wrong!' });
});

// Socket.IO
const io = new Server(server, {
  cors: {
    origin: allowedOrigins.length ? allowedOrigins : '*',
    methods: ['GET', 'POST'],
  },
});
setSocketIO(io);

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('joinThread', async ({ threadId, userId }) => {
    try {
      if (!threadId || !userId) return socket.emit('unauthorized', { message: 'Missing threadId or userId' });
      const thread = await Thread.findById(threadId).select('members creator');
      if (!thread) return socket.emit('unauthorized', { message: 'Thread does not exist' });
      const isMember = thread.creator.equals(userId) || thread.members.some((m) => m.equals(userId));
      if (!isMember) return socket.emit('unauthorized', { message: 'You are not authorized to join this thread' });
      socket.join(threadId);
    } catch (e) {
      console.error('joinThread error:', e);
    }
  });

  // Leave a thread room
  socket.on('leaveThread', ({ threadId }) => {
    try {
      if (threadId) socket.leave(threadId);
    } catch (e) {
      console.error('leaveThread error:', e);
    }
  });

  socket.on('sendMessage', async ({ threadId, userId, username, message }) => {
    try {
      const thread = await Thread.findById(threadId).select('members creator');
      if (!thread || (!thread.creator.equals(userId) && !thread.members.some((m) => m.equals(userId)))) {
        return socket.emit('unauthorized', { message: 'You are not authorized to post in this thread' });
      }
      const newMessage = await new Message({ threadId, userId, username, message }).save();
      io.to(threadId).emit('newMessage', {
        id: newMessage._id.toString(),
        threadId,
        userId,
        username,
        message,
        timestamp: newMessage.timestamp.toISOString(),
      });
    } catch (e) {
      console.error('sendMessage error:', e);
    }
  });

  // Identify user to allow direct notifications (e.g., join requests)
  socket.on('identify', ({ userId }) => {
    if (userId) {
      socket.join(`user:${userId}`);
    }
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
  });
});

// Start
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`API: http://localhost:${PORT}/api`);
  console.log(`Health: http://localhost:${PORT}/api/health`);
});
