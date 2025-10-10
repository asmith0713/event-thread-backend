# Konekt — Realtime Group Chat with Approvals

Modern, lightweight app for creating event-based threads with realtime chat, membership approvals, and an admin view. The project is split into two repos (frontend and backend) that work together.

- Frontend (Vite + React): https://github.com/your-org/event-threads-frontend
- Backend (Node + Express + MongoDB + Socket.IO): https://github.com/your-org/event-threads-backend

Update the links above to your actual GitHub repos.

## Features

- Create event threads with title, description, location, optional tags, and expiry
- Realtime chat via Socket.IO
- Join requests with creator approval (optional per thread; creators can allow instant join with no approval)
- Restricted chat access: non-members cannot open chat
- Realtime notifications for:
  - New messages
  - Join requests (to creator)
  - Approvals/rejections (to requester)
  - Thread creation/updates
  - Thread deletion (kicks users back to threads list)
  - Membership changes (someone approved)
- Admin dashboard for overview and management
- Session-only auth (closing the tab logs out)
- Friendly to deploy (e.g., Vercel frontend, Render backend)

## Tech Stack

- Frontend: React 18, Vite, TailwindCSS, axios, socket.io-client
- Backend: Node.js, Express, MongoDB (Mongoose), Socket.IO, JWT, CORS, Helmet, Rate limiting
- Auth: JWT stored in sessionStorage (session-lifetime)

## Architecture

- Frontend calls REST endpoints for data (threads, auth) and uses Socket.IO for realtime updates.
- Backend exposes REST under `/api/*` and a Socket.IO server at the same origin.
- MongoDB stores Users, Threads, and Messages.

## Repos Layout

Although deployed and versioned separately, the two repos are a single app.

- Frontend repo: `event-thread-frontend-main/`
- Backend repo: `event-thread-backend-main/`

Each repo README should link to the other for easy discovery (see top of this file).

## Local Development

Prerequisites:

- Node.js 18+ (works on v22 as well)
- npm 9+
- MongoDB running locally (service or Docker) or a MongoDB Atlas connection string

### 1) Clone both repos

In two sibling folders:

- Frontend: `event-threads-frontend`
- Backend: `event-threads-backend`

### 2) Backend setup

In `event-threads-backend`:

```
npm install
```

Create `.env`:

```
# MongoDB
MONGODB_URI= mongoDB connection string

# Server
PORT=5050
NODE_ENV=development

# Admin credentials
ADMIN_USERNAME= your preferred username
ADMIN_PASSWORD= ypur preferred password

# JWT
JWT_SECRET=change_this_in_production

# CORS
FRONTEND_URL=http://localhost:5173
```

Run:

```
npm start
```

Verify:

- API: http://localhost:5050/api/health

### 3) Frontend setup

In `event-threads-frontend`:

```
npm install
```

Create `.env`:

```
VITE_API_URL=http://localhost:5050
VITE_BACKEND_WS=http://localhost:5050
```

Run:

```
npm run dev
```

Open: http://localhost:5173

## Production Deployment

- Frontend (Vercel):
  - Set `VITE_API_URL` to your backend URL (e.g., https://your-backend.onrender.com)
  - Set `VITE_BACKEND_WS` to the same backend URL for Socket.IO

- Backend (Render/Heroku/VM):
  - Ensure `FRONTEND_URL` contains your frontend origin (e.g., https://your-frontend.vercel.app)
  - Set `MONGODB_URI`, `JWT_SECRET`, `ADMIN_*` env vars
  - Expose the Socket.IO server on the same origin as the REST API

## Data Model (simplified)

- User
  - username, password (hashed), isAdmin, createdAt, lastLogin
- Thread
  - title, description, creator (User id), creatorUsername, location, tags[] (optional)
  - members[] (User ids), pendingRequests[] (User ids)
  - expiresAt, createdAt
- Message
  - threadId, userId, username, message, timestamp

## REST API

Base URL: `${API_URL}/api`

Auth

- POST `/auth/register` { username, password }
- POST `/auth/login` { username, password, isAdmin }
- POST `/auth/logout`

Threads

- GET `/threads?userId={currentUserId}`
  - Returns threads. If the requester is not a member of a thread (and not creator), chat list for that thread is empty.
- POST `/threads`
  - body: { title, description, creator (name), creatorId, location, tags?[], expiresAt, requiresApproval:boolean }
  - Creates thread and a welcome message
- DELETE `/threads/:id`
  - body: { userId } (must be creator or admin)
  - Emits `threadDeleted` via Socket.IO to participants
- POST `/threads/:id/join`
  - body: { userId }
  - If `requiresApproval=true`: adds to pending requests and emits `joinRequest` to creator
  - If `requiresApproval=false`: adds user directly to members, emits `membershipChanged` and a system welcome message
- POST `/threads/:id/requests`
  - body: { userId, approve: boolean, currentUserId }
  - Approve/reject; on approve emits `requestHandled` to requester, `membershipChanged` to thread room, and a system welcome message
- POST `/threads/:id/messages`
  - body: { user, userId, message }
  - Persists and emits `newMessage`
- PUT `/threads/:id`
  - body: { title, description, location, tags, userId } (creator only)
  - Emits `threadUpdated`

Admin

- GET `/admin/dashboard?userId=admin_001`

## Socket.IO

Client emits:

- `identify` { userId } — join a private user room for direct notifications
- `joinThread` { threadId, userId } — join a thread room (must be creator or member)
- `leaveThread` { threadId } — leave the room cleanly
- `sendMessage` { threadId, userId, username, message }

Server emits:

- `unauthorized` { message }
- `newMessage` { id, threadId, userId, username, message, timestamp }
- `joinRequest` { threadId, userId, username } — to creator
- `requestHandled` { threadId, approved } — to requester
- `membershipChanged` { threadId, userId, username } — to thread room
- `threadCreated` { ...thread summary }
- `threadUpdated` { id, title, description, location, tags }
- `threadDeleted` { threadId, deletedBy }

## Auth Model (Session-Only in Browser)

- Token and user are stored in `sessionStorage` (not localStorage) so closing the tab logs you out automatically.
- Interceptors attach token from sessionStorage (fallback localStorage for legacy).
- On 401 responses, both session and local storage are cleared and the app reloads.

## UI Behavior

- Non-members cannot open a thread’s chat
  - The “View Chat” action is blocked for non-members, with a toast explaining access control.
  - If access changes (approval), chat unlocks in realtime without refresh.

- Realtime updates
  - New threads appear immediately in All Threads.
  - Thread edits reflect live across views.
  - Approvals/rejections, join requests, deletion: all push updates and toasts.

- Delete inside chat
  - Creator/Admin can delete from the chat header — all users are notified and kicked back to All Threads.

## Scripts

Frontend

- `npm run dev` — start Vite dev server at 5173
- `npm run build` — production build
- `npm run preview` — preview production build

Backend

- `npm start` — start server
- `npm run dev` — with nodemon (if configured)

## Troubleshooting

- “Port already in use” (EADDRINUSE):
  - Change backend `PORT` in `.env` (e.g., 5050), update frontend env accordingly, restart both.
- CORS/Socket issues:
  - Ensure backend `FRONTEND_URL` matches actual deployed frontend origin.
  - Ensure frontend env points to backend URL for both `VITE_API_URL` and `VITE_BACKEND_WS`.
- MongoDB connection failures:
  - Confirm local MongoDB service is running, or verify your Atlas URI.

## Contributing

- Open issues/PRs in the appropriate repo (frontend or backend).
- Keep small, focused changes and describe steps to validate.

## License

Add your license of choice (MIT recommended).
