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
  python3: { pistonLang: 'python' },
  java: { pistonLang: 'java' },
  cpp: { pistonLang: 'c++' },
  nodejs: { pistonLang: 'javascript' },
  c: { pistonLang: 'c' },
  ruby: { pistonLang: 'ruby' },
  go: { pistonLang: 'go' },
  scala: { pistonLang: 'scala' },
  bash: { pistonLang: 'bash' },
  csharp: { pistonLang: 'csharp' },
  php: { pistonLang: 'php' },
  swift: { pistonLang: 'swift' },
  rust: { pistonLang: 'rust' },
  r: { pistonLang: 'r' },
  // Judge0 IDs (for when subscription activates)
  judge0Id: {
    python3: 71, java: 62, cpp: 54, nodejs: 63, c: 50,
    ruby: 72, go: 60, scala: 81, bash: 46, csharp: 51,
    php: 68, swift: 83, rust: 73, r: 80
  }
};

// Enable CORS
app.use(cors());

// Parse JSON bodies
app.use(express.json());

const io = new Server(server, {
  cors: {
    origin: "http://localhost:5002",
    methods: ["GET", "POST"],
  },
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

io.on("connection", (socket) => {
  // console.log('Socket connected', socket.id);
  socket.on(ACTIONS.JOIN, ({ roomId, username }) => {
    userSocketMap[socket.id] = username;

    console.log(`[JOIN] User ${username} (${socket.id}) trying to join room ${roomId}`);
    console.log(`[JOIN] Current host for room ${roomId}:`, roomHosts[roomId]);

    // Check if room exists by checking if there's a host AND the host is still connected
    const currentHost = roomHosts[roomId];
    const hostSocket = currentHost ? io.sockets.sockets.get(currentHost) : null;
    const roomHasActiveHost = currentHost && hostSocket;

    console.log(`[JOIN] Room has active host:`, roomHasActiveHost);

    // If room doesn't exist or host is not connected, this user becomes the host and joins directly
    if (!roomHasActiveHost) {
      console.log(`[JOIN] ${username} is becoming the host of room ${roomId}`);
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
      console.log(`[JOIN] ${username} is requesting to join room ${roomId} (host: ${currentHost})`);
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

  // sync the code
  socket.on(ACTIONS.CODE_CHANGE, ({ roomId, code }) => {
    socket.in(roomId).emit(ACTIONS.CODE_CHANGE, { code });
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

app.post("/compile", async (req, res) => {
  const { code, language, input = "" } = req.body;

  // Debug logs
  console.log('Received compile request:', { code, language, input });
  console.log('Language config:', languageConfig[language]);

  try {
    // Try Judge0 first since you have a subscription
    console.log('Trying Judge0 API...');
    const submissionResponse = await axios.post("https://judge0-ce.p.rapidapi.com/submissions?base64_encoded=false&wait=true", {
      source_code: code,
      language_id: languageConfig.judge0Id[language],
      stdin: input, // Add input support
    }, {
      headers: {
        'Content-Type': 'application/json',
        'X-RapidAPI-Host': 'judge0-ce.p.rapidapi.com',
        'X-RapidAPI-Key': process.env.RAPIDAPI_KEY
      }
    });

    console.log('Judge0 response:', submissionResponse.data);
    const result = submissionResponse.data;
    res.json({
      output: result.stdout || result.stderr || "No output",
      error: result.stderr || null
    });

  } catch (judge0Error) {
    console.log('Judge0 failed, trying Piston API as fallback...');
    console.error('Judge0 error:', judge0Error.response?.data);
    
    try {
      // Fallback to Piston API
      const response = await axios.post("https://emkc.org/api/v2/piston/execute", {
        language: languageConfig[language]?.pistonLang || language,
        version: '*',
        files: [{
          name: 'main.' + (language === 'cpp' ? 'cpp' : language === 'java' ? 'java' : language === 'python3' ? 'py' : 'txt'),
          content: code
        }],
        stdin: input // Add input support for Piston too
      }, {
        headers: {
          'Content-Type': 'application/json',
        }
      });

      console.log('Piston API response:', response.data);
      const result = response.data;
      res.json({
        output: result.run?.stdout || "No output",
        error: result.run?.stderr || null
      });

    } catch (pistonError) {
      console.error('Both APIs failed:', pistonError.message);
      res.status(500).json({ error: "Failed to compile code" });
    }
  }
});

// AI assistant endpoint - uses Groq API (free and fast)
app.post("/ai", async (req, res) => {
  const { prompt = "", code = "", language = "" } = req.body;
  const apiKey = process.env.GROQ_API_KEY;

  console.log('[AI] Request received:', { prompt: prompt.substring(0, 50), language, codeLength: code.length });

  if (!apiKey || apiKey === 'your_groq_api_key_here') {
    console.error('[AI] No API key configured');
    return res.status(500).json({ 
      error: "Groq API key not configured. Get a free key from https://console.groq.com and add it to server/.env as GROQ_API_KEY" 
    });
  }

  // Build the message with context
  const systemMessage = "You are a helpful coding assistant. Provide clear, concise answers about code. When showing code examples, use proper formatting.";
  const userMessage = code 
    ? `${prompt}\n\nLanguage: ${language}\nCode:\n${code}`
    : prompt;

  try {
    console.log('[AI] Sending request to Groq...');
    
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
    console.log('[AI] Success! Reply length:', reply.length);
    return res.json({ reply });
    
  } catch (err) {
    console.error("[AI] Error:", {
      status: err?.response?.status,
      data: err?.response?.data,
      message: err.message
    });
    
    const errorMsg = err?.response?.data?.error?.message || err.message || "AI request failed";
    return res.status(500).json({ 
      error: errorMsg
    });
  }
});

const PORT = process.env.PORT || 5002;
server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
