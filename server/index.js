const express = require("express");
const app = express();
const http = require("http");
const { Server } = require("socket.io");
const ACTIONS = require("./Actions");
const cors = require("cors");
const axios = require("axios");
const server = http.createServer(app);
require("dotenv").config();

const languageConfig = {
  // Piston API language mappings
  python3: { pistonLang: 'python', extension: 'py' },
  java: { pistonLang: 'java', extension: 'java' },
  cpp: { pistonLang: 'c++', extension: 'cpp' },
  c: { pistonLang: 'c', extension: 'c' },
};

// Enable CORS
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5002",
  "https://live-syntax.vercel.app",
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

// Parse JSON bodies
app.use(express.json());

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  },
  allowEIO3: true,
  transports: ['polling', 'websocket'],
  pingTimeout: 60000,
  pingInterval: 25000
});

const userSocketMap = {};
const roomHosts = {}; // Track the host (first user) of each room
const pendingJoinRequests = {}; // Track users waiting for approval

const getAllConnectedClients = (roomId) => {
  return Array.from(io.sockets.adapter.rooms.get(roomId) || []).map(
    (socketId) => {
      return {
        socketId,
        username: userSocketMap[socketId],
        isHost: roomHosts[roomId] === socketId, // Check if this user is the host
      };
    }
  );
};

console.log("Allowed origins for CORS/socket.io:", allowedOrigins);
console.log("FRONTEND_URL env:", process.env.FRONTEND_URL);

io.engine.on("connection_error", (err) => {
  console.error("Engine connection error:", err.message, {
    details: err,
    origin: err.req && err.req.headers && err.req.headers.origin,
  });
});

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id, "handshake origin:", socket.handshake.headers.origin);
  socket.on(ACTIONS.JOIN, ({ roomId, username }) => {
    userSocketMap[socket.id] = username;

    // Check if room exists by checking if there's a host AND the host is still connected
    const currentHost = roomHosts[roomId];
    const hostSocket = currentHost ? io.sockets.sockets.get(currentHost) : null;
    const roomHasActiveHost = currentHost && hostSocket;

    // If room doesn't exist or host is not connected, this user becomes the host and joins directly
    if (!roomHasActiveHost) {
      // Set as host immediately to prevent race conditions
      roomHosts[roomId] = socket.id;
      socket.join(roomId);
      const clients = getAllConnectedClients(roomId);
      // notify that new user has joined
      clients.forEach(({ socketId }) => {
        io.to(socketId).emit(ACTIONS.JOINED, {
          clients,
          username,
          socketId: socket.id,
        });
      });
    } else {
      // Room exists with a host - send join request to host
      if (!pendingJoinRequests[roomId]) {
        pendingJoinRequests[roomId] = [];
      }

      // Check if this user is already in pending requests (avoid duplicates)
      const alreadyPending = pendingJoinRequests[roomId].some(
        req => req.socketId === socket.id
      );

      if (!alreadyPending) {
        pendingJoinRequests[roomId].push({ socketId: socket.id, username });

        // Notify the user they're waiting for approval
        io.to(socket.id).emit(ACTIONS.WAITING_FOR_APPROVAL);

        // Notify the host about the join request
        io.to(roomHosts[roomId]).emit(ACTIONS.JOIN_REQUEST, {
          socketId: socket.id,
          username,
          roomId,
        });
      }
    }
  });

  // Handle host's approval of join request
  socket.on(ACTIONS.APPROVE_JOIN, ({ socketId, roomId }) => {
    // Verify the requester is the host
    if (roomHosts[roomId] !== socket.id) return;

    // Remove from pending requests
    if (pendingJoinRequests[roomId]) {
      pendingJoinRequests[roomId] = pendingJoinRequests[roomId].filter(
        (req) => req.socketId !== socketId
      );
    }

    // Get the socket and make them join
    const joiningSocket = io.sockets.sockets.get(socketId);
    if (joiningSocket) {
      joiningSocket.join(roomId);
      const clients = getAllConnectedClients(roomId);
      const username = userSocketMap[socketId];
      
      // Notify all clients including the newly joined user
      clients.forEach(({ socketId: clientSocketId }) => {
        io.to(clientSocketId).emit(ACTIONS.JOINED, {
          clients,
          username,
          socketId,
        });
      });
    }
  });

  // Handle host's rejection of join request
  socket.on(ACTIONS.REJECT_JOIN, ({ socketId, roomId }) => {
    // Verify the requester is the host
    if (roomHosts[roomId] !== socket.id) return;

    // Remove from pending requests
    if (pendingJoinRequests[roomId]) {
      pendingJoinRequests[roomId] = pendingJoinRequests[roomId].filter(
        (req) => req.socketId !== socketId
      );
    }

    // Notify the rejected user
    io.to(socketId).emit(ACTIONS.JOIN_REJECTED, { roomId });
  });

  // sync the code - broadcast changes to all other users in the room
  socket.on(ACTIONS.CODE_CHANGE, ({ roomId, code, change }) => {
    socket.in(roomId).emit(ACTIONS.CODE_CHANGE, { code, change });
  });
  
  // sync cursor positions
  socket.on(ACTIONS.CURSOR_CHANGE, ({ roomId, cursor, selection }) => {
    socket.in(roomId).emit(ACTIONS.CURSOR_CHANGE, {
      socketId: socket.id,
      username: userSocketMap[socket.id],
      cursor,
      selection,
    });
  });
  
  // when new user join the room all the code which are there are also shows on that persons editor
  socket.on(ACTIONS.SYNC_CODE, ({ socketId, code }) => {
    io.to(socketId).emit(ACTIONS.CODE_CHANGE, { code });
  });

  // leave room
  socket.on("disconnecting", () => {
    const rooms = [...socket.rooms];
    const leavingUsername = userSocketMap[socket.id];
    const leavingSocketId = socket.id;
    
    // leave all the room
    rooms.forEach((roomId) => {
      // Skip the socket's own room (every socket is in a room with its own ID)
      if (roomId === socket.id) return;
      
      // If the host leaves
      if (roomHosts[roomId] === socket.id) {
        const remainingClients = Array.from(io.sockets.adapter.rooms.get(roomId) || [])
          .filter(sid => sid !== socket.id)
          .map((socketId) => ({
            socketId,
            username: userSocketMap[socketId],
            isHost: false, // Will be updated for new host
          }));
        
        if (remainingClients.length === 0) {
          delete roomHosts[roomId];
          delete pendingJoinRequests[roomId];
        } else {
          // Transfer host to the next person (first remaining client)
          const newHost = remainingClients[0];
          roomHosts[roomId] = newHost.socketId;
          
          // Update isHost flag for new host
          const updatedClients = remainingClients.map(client => ({
            ...client,
            isHost: client.socketId === newHost.socketId,
          }));
          
          // Notify all remaining clients about the host change and updated client list
          remainingClients.forEach(({ socketId: clientSocketId }) => {
            io.to(clientSocketId).emit(ACTIONS.HOST_CHANGED, {
              newHostSocketId: newHost.socketId,
              newHostUsername: newHost.username,
              clients: updatedClients,
            });
          });
        }
      } else {
        // If a non-host leaves, just notify others
        socket.in(roomId).emit(ACTIONS.DISCONNECTED, {
          socketId: leavingSocketId,
          username: leavingUsername,
        });
      }
      
      // Remove from pending requests if disconnecting while waiting
      if (pendingJoinRequests[roomId]) {
        pendingJoinRequests[roomId] = pendingJoinRequests[roomId].filter(
          (req) => req.socketId !== socket.id
        );
      }
    });

    delete userSocketMap[socket.id];
    socket.leave();
  });
});

app.get("/health", async (req, res)=>{ res.json({
     status:"running",
    });
  });

app.post("/compile", async (req, res) => {
  const { code, language, input = "" } = req.body;

  if (!languageConfig[language]) {
    return res.status(400).json({ error: `Unsupported language: ${language}` });
  }

  try {
    const { pistonLang, extension } = languageConfig[language];
    
    const response = await axios.post("https://emkc.org/api/v2/piston/execute", {
      language: pistonLang,
      version: '*',
      files: [{
        name: `main.${extension}`,
        content: code
      }],
      stdin: input
    }, {
      headers: {
        'Content-Type': 'application/json',
      }
    });

    const result = response.data;
    
    res.json({
      output: result.run?.stdout || "No output",
      error: result.run?.stderr || null
    });

  } catch (error) {
    res.status(500).json({ 
      error: "Failed to compile code",
      details: error.response?.data || error.message
    });
  }
});

// AI assistant endpoint - uses Groq API (free and fast)
app.post("/ai", async (req, res) => {
  const { prompt = "", code = "", language = "" } = req.body;
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey || apiKey === 'your_groq_api_key_here') {
    return res.status(500).json({ 
      error: "Groq API key not configured. Get a free key from https://console.groq.com and add it to server/.env as GROQ_API_KEY" 
    });
  }

  // Build the message with context
  const systemMessage = `You are a concise coding assistant. When analyzing code:

Format your response EXACTLY like this:
Corrected Code:
[Show only the fixed code here]

Do not add any explanations, comments, or error descriptions. Only output "Corrected Code:" followed by the code on the next line.`;
  
  const userMessage = code 
    ? `${prompt}\n\nLanguage: ${language}\nCode:\n${code}\n\nProvide only the corrected code.`
    : prompt;

  try {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: systemMessage },
          { role: "user", content: userMessage }
        ],
        temperature: 0.7,
        max_tokens: 1024
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const reply = response.data?.choices?.[0]?.message?.content || "No response generated";
    return res.json({ reply });
    
  } catch (err) {
    const errorMsg = err?.response?.data?.error?.message || err.message || "AI request failed";
    return res.status(500).json({ 
      error: errorMsg
    });
  }
});

const PORT = process.env.PORT || 5002;
server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
