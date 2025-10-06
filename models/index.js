import mongoose from 'mongoose';

// User Schema
const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    maxlength: 50
  },
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  isAdmin: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Thread Schema
const threadSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  creator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  creatorUsername: {
    type: String,
    required: true
  },
  location: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  tags: [{
    type: String,
    trim: true
  }],
  members: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  pendingRequests: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 } // TTL index - auto-delete expired threads
  }
}, {
  timestamps: true
});

// Message Schema
const messageSchema = new mongoose.Schema({
  threadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Thread',
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  username: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true,
    trim: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

// Indexes for performance
userSchema.index({ username: 1 });
threadSchema.index({ creator: 1 });
threadSchema.index({ expiresAt: 1 });
threadSchema.index({ createdAt: -1 });
messageSchema.index({ threadId: 1, timestamp: -1 });

// Models
const User = mongoose.model('User', userSchema);
const Thread = mongoose.model('Thread', threadSchema);
const Message = mongoose.model('Message', messageSchema);

export { User, Thread, Message };