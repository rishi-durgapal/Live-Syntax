import React, { useEffect, useRef } from "react";
import "codemirror/mode/javascript/javascript";
import "codemirror/theme/dracula.css";
import "codemirror/addon/edit/closetag";
import "codemirror/addon/edit/closebrackets";
import "codemirror/addon/selection/mark-selection";
import "codemirror/lib/codemirror.css";
import CodeMirror from "codemirror";
import { ACTIONS } from "../Actions";

// Helper function to generate consistent color from username
const getUserColor = (username) => {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = hash % 360;
  return `hsl(${hue}, 70%, 60%)`;
};

// Helper to convert HSL to RGBA with alpha
const getUserColorWithAlpha = (username, alpha = 0.3) => {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = hash % 360;
  // Convert HSL to RGB for better alpha support
  const l = 60;
  const s = 70;
  const c = (1 - Math.abs(2 * l / 100 - 1)) * s / 100;
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = l / 100 - c / 2;
  let r = 0, g = 0, b = 0;
  
  if (hue >= 0 && hue < 60) { r = c; g = x; b = 0; }
  else if (hue >= 60 && hue < 120) { r = x; g = c; b = 0; }
  else if (hue >= 120 && hue < 180) { r = 0; g = c; b = x; }
  else if (hue >= 180 && hue < 240) { r = 0; g = x; b = c; }
  else if (hue >= 240 && hue < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  
  r = Math.round((r + m) * 255);
  g = Math.round((g + m) * 255);
  b = Math.round((b + m) * 255);
  
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

function Editor({ socketRef, roomId, onCodeChange }) {
  const editorRef = useRef(null);
  const remoteCursorsRef = useRef({}); // Track remote cursor widgets
  const remoteSelectionsRef = useRef({}); // Track remote selections
  const suppressRemoteChangeRef = useRef(false); // Flag to prevent circular updates

  useEffect(() => {
    const init = async () => {
      const editor = CodeMirror.fromTextArea(
        document.getElementById("realtimeEditor"),
        {
          mode: { name: "javascript", json: true },
          theme: "dracula",
          autoCloseTags: true,
          autoCloseBrackets: true,
          lineNumbers: true,
        }
      );
      
      editorRef.current = editor;
      editor.setSize(null, "100%");

      // Send cursor position changes
      editor.on("cursorActivity", () => {
        if (!suppressRemoteChangeRef.current) {
          const cursor = editor.getCursor();
          const selection = editor.listSelections()[0];
          
          socketRef.current.emit(ACTIONS.CURSOR_CHANGE, {
            roomId,
            cursor,
            selection,
          });
        }
      });

      // Send code changes - send the actual change delta instead of full code
      editor.on("change", (instance, changeObj) => {
        const { origin } = changeObj;
        
        if (origin !== "setValue" && !suppressRemoteChangeRef.current) {
          const code = instance.getValue();
          onCodeChange(code);
          
          // Send the change delta for better collaboration
          socketRef.current.emit(ACTIONS.CODE_CHANGE, {
            roomId,
            code,
            change: {
              from: changeObj.from,
              to: changeObj.to,
              text: changeObj.text,
              origin: changeObj.origin
            }
          });
        }
      });
    };

    init();
  }, []);

  // Handle incoming code and cursor changes
  useEffect(() => {
    if (socketRef.current) {
      // Handle code changes - apply delta changes instead of replacing entire document
      socketRef.current.on(ACTIONS.CODE_CHANGE, ({ code, change }) => {
        if (editorRef.current) {
          suppressRemoteChangeRef.current = true;
          
          // If we have change delta, apply it; otherwise use full code sync
          if (change && change.from && change.to && change.text) {
            editorRef.current.replaceRange(
              change.text.join('\n'),
              change.from,
              change.to,
              '+input'
            );
          } else if (code !== null) {
            // Fallback to full sync (for initial sync)
            const cursor = editorRef.current.getCursor();
            const scrollInfo = editorRef.current.getScrollInfo();
            
            editorRef.current.setValue(code);
            editorRef.current.setCursor(cursor);
            editorRef.current.scrollTo(scrollInfo.left, scrollInfo.top);
          }
          
          setTimeout(() => {
            suppressRemoteChangeRef.current = false;
          }, 10);
        }
      });

      // Handle remote cursor changes
      socketRef.current.on(ACTIONS.CURSOR_CHANGE, ({ socketId, username, cursor, selection }) => {
        if (!editorRef.current) return;

        const color = getUserColor(username);
        const bgColor = getUserColorWithAlpha(username, 0.6);
        
        // Remove old cursor if exists
        if (remoteCursorsRef.current[socketId]) {
          remoteCursorsRef.current[socketId].clear();
        }
        if (remoteSelectionsRef.current[socketId]) {
          remoteSelectionsRef.current[socketId].clear();
        }

        // Create cursor widget
        const cursorCoords = editorRef.current.cursorCoords(cursor);
        const cursorElement = document.createElement("span");
        cursorElement.style.borderLeft = `2px solid ${color}`;
        cursorElement.style.height = `${cursorCoords.bottom - cursorCoords.top}px`;
        cursorElement.style.position = "absolute";
        cursorElement.style.zIndex = "10";
        
        // Add username label
        const label = document.createElement("span");
        label.textContent = username;
        label.style.position = "absolute";
        label.style.top = "-18px";
        label.style.left = "0";
        label.style.fontSize = "10px";
        label.style.backgroundColor = color;
        label.style.color = "white";
        label.style.padding = "2px 4px";
        label.style.borderRadius = "3px";
        label.style.whiteSpace = "nowrap";
        cursorElement.appendChild(label);

        remoteCursorsRef.current[socketId] = editorRef.current.setBookmark(cursor, {
          widget: cursorElement,
          insertLeft: true,
        });

        // Highlight selection if exists
        const hasSelection = selection && selection.anchor && selection.head &&
          (selection.anchor.line !== selection.head.line || 
           selection.anchor.ch !== selection.head.ch);
        
        if (hasSelection) {
          // Normalize selection order - ensure 'from' is before 'to'
          let from = selection.anchor;
          let to = selection.head;
          
          // Compare positions and swap if necessary
          if (from.line > to.line || (from.line === to.line && from.ch > to.ch)) {
            [from, to] = [to, from];
          }
          
          // Create unique class name for this user
          const selectionClass = `remote-selection-${socketId.replace(/[^a-zA-Z0-9]/g, '')}`;
          
          // Inject CSS for this selection
          const styleId = `style-${socketId.replace(/[^a-zA-Z0-9]/g, '')}`;
          let styleElement = document.getElementById(styleId);
          if (!styleElement) {
            styleElement = document.createElement('style');
            styleElement.id = styleId;
            document.head.appendChild(styleElement);
          }
          styleElement.textContent = `
            .${selectionClass} {
              background-color: ${bgColor} !important;
              background: ${bgColor} !important;
            }
          `;
          
          try {
            const mark = editorRef.current.markText(
              from,
              to,
              {
                className: selectionClass,
                inclusiveLeft: true,
                inclusiveRight: true,
              }
            );
            remoteSelectionsRef.current[socketId] = mark;
          } catch (err) {
            // Silent error handling
          }
        }
      });

      // Handle user disconnect - remove their cursor
      socketRef.current.on(ACTIONS.DISCONNECTED, ({ socketId }) => {
        if (remoteCursorsRef.current[socketId]) {
          remoteCursorsRef.current[socketId].clear();
          delete remoteCursorsRef.current[socketId];
        }
        if (remoteSelectionsRef.current[socketId]) {
          remoteSelectionsRef.current[socketId].clear();
          delete remoteSelectionsRef.current[socketId];
        }
        // Remove injected style
        const styleElement = document.getElementById(`style-${socketId}`);
        if (styleElement) {
          styleElement.remove();
        }
      });
    }

    return () => {
      if (socketRef.current) {
        socketRef.current.off(ACTIONS.CODE_CHANGE);
        socketRef.current.off(ACTIONS.CURSOR_CHANGE);
        socketRef.current.off(ACTIONS.DISCONNECTED);
      }
    };
  }, [socketRef.current]);

  return (
    <div style={{ height: "600px" }}>
      <textarea id="realtimeEditor"></textarea>
    </div>
  );
}

export default Editor;
