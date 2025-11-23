import React, { useEffect, useRef, useState } from "react";
import Client from "./Client";
import Editor from "./Editor";
import { initSocket } from "../Socket";
import { ACTIONS } from "../Actions";
import {
  useNavigate,
  useLocation,
  Navigate,
  useParams,
} from "react-router-dom";
import { toast } from "react-hot-toast";
import axios from "axios";

// List of supported languages
const LANGUAGES = [
  "python3",
  "java",
  "cpp",
  "c",
];

function EditorPage() {
  const [clients, setClients] = useState([]);
  const [output, setOutput] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiResponse, setAiResponse] = useState("");
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isCompileWindowOpen, setIsCompileWindowOpen] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState("python3");
  const [programInput, setProgramInput] = useState("");
  const [joinRequests, setJoinRequests] = useState([]);
  const [isWaitingForApproval, setIsWaitingForApproval] = useState(false);
  const codeRef = useRef(null);

  const Location = useLocation();
  const navigate = useNavigate();
  const { roomId } = useParams();

  const socketRef = useRef(null);

  useEffect(() => {
    const init = async () => {
      const handleErrors = (err) => {
        console.log("Error", err);
        toast.error("Socket connection failed, Try again later");
        navigate("/");
      };

      socketRef.current = await initSocket();
      socketRef.current.on("connect_error", (err) => handleErrors(err));
      socketRef.current.on("connect_failed", (err) => handleErrors(err));

      socketRef.current.emit(ACTIONS.JOIN, {
        roomId,
        username: Location.state?.username,
      });

      socketRef.current.on(
        ACTIONS.JOINED,
        ({ clients, username, socketId }) => {
          // When we successfully join, hide waiting screen
          setIsWaitingForApproval(false);
          
          if (username !== Location.state?.username) {
            toast.success(`${username} joined the room.`);
          }
          setClients(clients);
          socketRef.current.emit(ACTIONS.SYNC_CODE, {
            code: codeRef.current,
            socketId,
          });
        }
      );

      socketRef.current.on(ACTIONS.DISCONNECTED, ({ socketId, username }) => {
        toast.success(`${username} left the room`);
        setClients((prev) => {
          return prev.filter((client) => client.socketId !== socketId);
        });
      });

      // Handle join requests (for host only)
      socketRef.current.on(ACTIONS.JOIN_REQUEST, ({ socketId, username }) => {
        setJoinRequests((prev) => [...prev, { socketId, username }]);
      });

      // Handle waiting for approval (for non-host users)
      socketRef.current.on(ACTIONS.WAITING_FOR_APPROVAL, () => {
        setIsWaitingForApproval(true);
      });

      // Handle rejection (for users trying to join)
      socketRef.current.on(ACTIONS.JOIN_REJECTED, () => {
        toast.error("The host rejected your request to join the room");
        navigate("/");
      });

      // Handle host change (when current host leaves)
      socketRef.current.on(ACTIONS.HOST_CHANGED, ({ newHostSocketId, newHostUsername, clients }) => {
        setClients(clients);
        if (newHostSocketId === socketRef.current.id) {
          toast.success("You are now the host!");
        } else {
          toast.success(`${newHostUsername} is now the host`);
        }
      });
    };
    init();

    return () => {
      socketRef.current && socketRef.current.disconnect();
      socketRef.current.off(ACTIONS.JOINED);
      socketRef.current.off(ACTIONS.DISCONNECTED);
      socketRef.current.off(ACTIONS.JOIN_REQUEST);
      socketRef.current.off(ACTIONS.JOIN_REJECTED);
      socketRef.current.off(ACTIONS.WAITING_FOR_APPROVAL);
      socketRef.current.off(ACTIONS.HOST_CHANGED);
    };
  }, []);

  if (!Location.state) {
    return <Navigate to="/" />;
  }

  // Show waiting screen if user is pending approval
  if (isWaitingForApproval) {
    return (
      <div className="container-fluid vh-100 d-flex justify-content-center align-items-center bg-dark">
        <div className="text-center text-light">
          <div className="spinner-border text-primary mb-4" role="status" style={{ width: '3rem', height: '3rem' }}>
            <span className="visually-hidden">Loading...</span>
          </div>
          <h3>Waiting for host approval...</h3>
          <p className="text-muted">The host will review your request to join the room</p>
          <button className="btn btn-outline-danger mt-3" onClick={() => navigate("/")}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  const copyRoomId = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      toast.success(`Room ID is copied`);
    } catch (error) {
      console.log(error);
      toast.error("Unable to copy the room ID");
    }
  };

  const leaveRoom = async () => {
    navigate("/");
  };

  const handleApproveJoin = (socketId, username) => {
    socketRef.current.emit(ACTIONS.APPROVE_JOIN, { socketId, roomId });
    setJoinRequests((prev) => prev.filter((req) => req.socketId !== socketId));
    toast.success(`${username} has been approved to join`);
  };

  const handleRejectJoin = (socketId, username) => {
    socketRef.current.emit(ACTIONS.REJECT_JOIN, { socketId, roomId });
    setJoinRequests((prev) => prev.filter((req) => req.socketId !== socketId));
    toast.success(`${username}'s request has been rejected`);
  };

  const runCode = async () => {
    setIsCompiling(true);
    try {
      const response = await axios.post(`${process.env.REACT_APP_BACKEND_URL}/compile`, {
        code: codeRef.current,
        language: selectedLanguage,
        input: programInput, // Include program input
      });
      console.log("Backend response:", response.data);
      setOutput(response.data.output || JSON.stringify(response.data));
    } catch (error) {
      console.error("Error compiling code:", error);
      setOutput(error.response?.data?.error || "An error occurred");
    } finally {
      setIsCompiling(false);
    }
  };

  const sendAiPrompt = async () => {
    if (!aiPrompt.trim()) return;
    setIsAiLoading(true);
    setAiResponse("");
    try {
      const response = await axios.post(`${process.env.REACT_APP_BACKEND_URL}/ai`, {
        prompt: aiPrompt,
        code: codeRef.current || "",
        language: selectedLanguage,
      });
      setAiResponse(response.data.reply || JSON.stringify(response.data));
    } catch (err) {
      console.error("AI error", err);
      const errorDetails = err.response?.data?.details || err.response?.data?.error || err.message;
      setAiResponse(`Error: ${errorDetails}\n\nPlease check:\n1. Your Groq API key is valid (get free at https://console.groq.com)\n2. The key is added to server/.env\n3. The server is running`);
    } finally {
      setIsAiLoading(false);
    }
  };

  const toggleCompileWindow = () => {
    setIsCompileWindowOpen(!isCompileWindowOpen);
  };

  return (
    <div className="container-fluid vh-100 d-flex flex-column">
      {/* Join Requests Modal/Notification */}
      {joinRequests.length > 0 && (
        <div
          className="position-fixed top-0 start-50 translate-middle-x mt-3"
          style={{ zIndex: 2000, maxWidth: "500px", width: "90%" }}
        >
          <div className="card bg-dark border-primary shadow-lg">
            <div className="card-header bg-primary text-white d-flex justify-content-between align-items-center">
              <h6 className="mb-0">
                <i className="bi bi-bell-fill me-2"></i>
                Join Requests ({joinRequests.length})
              </h6>
            </div>
            <div className="card-body p-2" style={{ maxHeight: "300px", overflowY: "auto" }}>
              {joinRequests.map((request, index) => (
                <div
                  key={request.socketId}
                  className={`d-flex justify-content-between align-items-center p-3 ${
                    index !== joinRequests.length - 1 ? "border-bottom border-secondary" : ""
                  }`}
                  style={{ backgroundColor: "#1a1d29" }}
                >
                  <div className="text-light">
                    <strong className="fs-6">{request.username}</strong>
                    <small className="d-block text-muted">wants to join the room</small>
                  </div>
                  <div className="d-flex gap-2">
                    <button
                      className="btn btn-success btn-sm px-3"
                      onClick={() => handleApproveJoin(request.socketId, request.username)}
                      title="Approve"
                    >
                      <i className="bi bi-check-lg"></i> Allow
                    </button>
                    <button
                      className="btn btn-danger btn-sm px-3"
                      onClick={() => handleRejectJoin(request.socketId, request.username)}
                      title="Reject"
                    >
                      <i className="bi bi-x-lg"></i> Deny
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="row flex-grow-1">
        {/* Client panel */}
        <div className="col-md-2 bg-dark text-light d-flex flex-column">
          <img
            src="/images/LiveSyntaxRectangle.png"
            alt="Live Syntax Logo"
            className="img-fluid mx-auto d-block my-3"
            style={{ maxWidth: "140px" }}
          />
          <hr />

          {/* Client list container */}
          <div className="d-flex flex-column flex-grow-1 overflow-auto">
            <span className="mb-2">Members</span>
            {clients.map((client) => (
              <Client key={client.socketId} username={client.username} isHost={client.isHost} />
            ))}
          </div>

          <hr />
          {/* Buttons */}
          <div className="mt-auto mb-3">
            <button className="btn btn-outline-success w-100 mb-2" onClick={copyRoomId}>
              Copy Room ID
            </button>
            <button className="btn btn-outline-danger w-100" onClick={leaveRoom}>
              Leave Room
            </button>
          </div>
        </div>

        {/* Editor panel */}
        <div className="col-md-8 text-light d-flex flex-column">
          {/* Language selector */}
          <div className="bg-dark p-2 d-flex justify-content-end">
            <select
              className="form-select w-auto"
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
            >
              {LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>
                  {lang}
                </option>
              ))}
            </select>
          </div>

          <Editor
            socketRef={socketRef}
            roomId={roomId}
            onCodeChange={(code) => {
              codeRef.current = code;
            }}
          />
        </div>

        {/* AI Assistant panel */}
        <div className="col-md-2 bg-dark text-light border-start border-secondary d-flex flex-column" style={{ height: '100vh' }}>
          <div className="p-3 flex-grow-1 d-flex flex-column" style={{ overflow: 'hidden' }}>
            {/* Header */}
            <div className="mb-3">
              <h5 className="text-light mb-1 d-flex align-items-center">
                <i className="bi bi-robot me-2" style={{ fontSize: '1.3rem' }}></i>
                AI Assistant
              </h5>
              <small className="text-muted" style={{ fontSize: '0.8rem' }}>
                Get help with debugging, syntax, and code suggestions
              </small>
            </div>

            {/* Prompt Input */}
            <div className="mb-3">
              <textarea
                className="form-control bg-secondary text-light border-0 shadow-sm"
                rows={5}
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="e.g., What's the error here? Fix this code. Explain this function..."
                style={{ 
                  resize: 'none',
                  fontSize: '0.9rem',
                  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
                }}
              />
            </div>

            {/* Action Buttons */}
            <div className="d-flex gap-2 mb-3">
              <button 
                className="btn btn-primary flex-grow-1" 
                onClick={sendAiPrompt} 
                disabled={isAiLoading || !aiPrompt.trim()}
                style={{ fontWeight: '500' }}
              >
                {isAiLoading ? (
                  <>
                    <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                    Thinking...
                  </>
                ) : (
                  <>
                    <i className="bi bi-send me-2"></i>Ask AI
                  </>
                )}
              </button>
              <button 
                className="btn btn-secondary" 
                onClick={() => { setAiPrompt(''); setAiResponse(''); }}
                title="Clear conversation"
                style={{ minWidth: '80px' }}
              >
                Clear
              </button>
            </div>

            {/* Response Area */}
            <div className="flex-grow-1 d-flex flex-column" style={{ minHeight: 0, paddingBottom: '80px' }}>
              <h6 className="text-light mb-2 d-flex align-items-center">
                <i className="bi bi-chat-left-dots me-2"></i>Response
              </h6>
              <div 
                className="flex-grow-1 bg-black text-light p-3 rounded border border-secondary" 
                style={{ 
                  overflowY: 'auto',
                  fontSize: '0.85rem',
                  lineHeight: '1.6',
                  fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                  marginBottom: '10px'
                }}
              >
                {isAiLoading ? (
                  <div className="text-center text-muted py-4">
                    <div className="spinner-border spinner-border-sm mb-2" role="status">
                      <span className="visually-hidden">Loading...</span>
                    </div>
                    <p className="mb-0">Analyzing your request...</p>
                  </div>
                ) : aiResponse ? (
                  <pre className="mb-0 text-light" style={{ whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}>
                    {aiResponse}
                  </pre>
                ) : (
                  <div className="text-center text-muted py-4">
                    <i className="bi bi-lightbulb" style={{ fontSize: '2rem', opacity: 0.3 }}></i>
                    <p className="mt-2 mb-0" style={{ fontSize: '0.85rem' }}>
                      Ask me anything about your code!
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Compiler toggle button */}
      <button
        className="btn btn-outline-info position-fixed bottom-0 end-0 m-3"
        onClick={toggleCompileWindow}
        style={{ zIndex: 1050 }}
      >
        {isCompileWindowOpen ? "Close Compiler" : "Open Compiler"}
      </button>

      {/* Compiler section */}
      <div
        className={`bg-dark text-light p-3 ${
          isCompileWindowOpen ? "d-block" : "d-none"
        }`}
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          height: isCompileWindowOpen ? "30vh" : "0",
          transition: "height 0.3s ease-in-out",
          overflowY: "auto",
          zIndex: 1040,
        }}
      >
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h5 className="m-0">Compiler Output ({selectedLanguage})</h5>
          <div>
            <button
              className="btn btn-success me-2"
              onClick={runCode}
              disabled={isCompiling}
            >
              {isCompiling ? "Compiling..." : "Run Code"}
            </button>
            <button className="btn btn-secondary" onClick={toggleCompileWindow}>
              Close
            </button>
          </div>
        </div>

        {/* Program Input Section */}
        <div className="mb-3">
          <label className="form-label">
            <strong>Program Input:</strong> 
            <small className="text-muted ms-2">
              (For programs that require user input like cin, scanf, input(), etc.)
            </small>
          </label>
          <textarea
            className="form-control bg-dark text-light"
            rows="3"
            placeholder={`Enter input for your ${selectedLanguage} program here... `}
            value={programInput}
            onChange={(e) => setProgramInput(e.target.value)}
            style={{ 
              border: '1px solid #6c757d',
              fontSize: '14px',
              fontFamily: 'monospace'
            }}
          />
        </div>

        {/* Output Section */}
        <div>
          <label className="form-label"><strong>Output:</strong></label>
          <pre className="bg-secondary p-3 rounded" style={{ minHeight: '100px' }}>
            {output || "Output will appear here after compilation"}
          </pre>
        </div>
      </div>
    </div>
  );
}

export default EditorPage;
