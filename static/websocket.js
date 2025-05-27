// Enhanced WebSocket Chat System
let socket;
let currentChatUserId = null;
let currentUserId = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
let isConnected = false;
let messageQueue = [];

// Initialize current user ID properly
function initializeCurrentUser() {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    currentUserId = parseInt(user.id) || null;
    console.log("[DEBUG] Current user ID initialized:", currentUserId);
    return currentUserId;
}

function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

function getAuthToken() {
    return localStorage.getItem('auth_token') || 
           localStorage.getItem('token') ||
           getCookie('auth_token') ||
           getCookie('token');
}

function connectWebSocket() {
    console.log("[WebSocket] Initializing connection...");
    
    // Close existing connection if any
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.close(1000, "Reconnecting");
    }
    
    const token = getAuthToken();
    console.log("Retrieved token:", token);
    
    if (!token) {
        console.error("[WebSocket] No authentication token found");
        showErrorMessage('Please login to use chat');
        return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const wsUrl = `${protocol}${window.location.host}/ws?token=${encodeURIComponent(token)}`;
    console.log("[WebSocket] Connecting to:", wsUrl);
    
    socket = new WebSocket(wsUrl);
    
    
    socket.onopen = () => {
        console.log("[WebSocket] Connection established");
        isConnected = true;
        reconnectAttempts = 0;
        
        // Send authentication message
        const authMessage = {
            type: "auth",
            userId: currentUserId,
            token: token
        };
        console.log("[WebSocket] Sending auth message:", authMessage);
        socket.send(JSON.stringify(authMessage));
        
        // Process any queued messages
        while (messageQueue.length > 0) {
            const queuedMessage = messageQueue.shift();
            socket.send(JSON.stringify(queuedMessage));
        }
        
        // Load online users after successful connection
        setTimeout(() => {
            loadOnlineUsers();
        }, 1000);
    };

    socket.onmessage = (event) => {
        console.log("[WebSocket] Received raw message:", event.data);
        
        try {
            const data = JSON.parse(event.data);
            console.log("[WebSocket] Parsed message:", data);
            
            handleWebSocketMessage(data);
        } catch (error) {
            console.error('[WebSocket] Error processing message:', error);
        }
    };
    
    socket.onclose = (event) => {
        console.log(`[WebSocket] Connection closed. Code: ${event.code}, Reason: ${event.reason}`);
        isConnected = false;
        
        if (event.code !== 1000 && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            const delay = Math.min(1000 * (2 ** reconnectAttempts), 30000);
            console.log(`[WebSocket] Will attempt reconnect in ${delay}ms (attempt ${reconnectAttempts + 1})`);
            setTimeout(() => {
                reconnectAttempts++;
                connectWebSocket();
            }, delay);
        } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            showReconnectMessage();
        }
    };
    
    socket.onerror = (error) => {
        console.error('[WebSocket] Error:', error);
        isConnected = false;
    };
}

function handleWebSocketMessage(data) {
    switch(data.type) {
        case 'auth_success':
            console.log('[WebSocket] Authentication successful');
            showSuccessMessage('Connected to chat server');
            break;
            
        case 'auth_error':
            console.error('[WebSocket] Authentication failed:', data.message);
            showErrorMessage('Authentication failed: ' + data.message);
            handleLogout();
            break;
            
        case 'message':
            console.log(`[WebSocket] New message from user ${data.from} to ${data.to}`);
            handleIncomingMessage(data);
            break;
            
        case 'user_status':
            console.log(`[WebSocket] User ${data.userId} is now ${data.isOnline ? 'online' : 'offline'}`);
            updateUserStatus(data.userId, data.isOnline);
            break;
            
        case 'users_list':
            console.log('[WebSocket] Received users list:', data.users);
            updateUsersList(data.users);
            break;
            
        case 'error':
            console.error('[WebSocket] Server error:', data.message);
            showErrorMessage('Server error: ' + data.message);
            break;
            
        default:
            console.log('[WebSocket] Unknown message type:', data.type);
    }
}

function handleIncomingMessage(data) {
    const senderId = parseInt(data.from);
    const recipientId = parseInt(data.to);
    
    // Only process messages meant for current user or sent by current user
    if (recipientId === currentUserId || senderId === currentUserId) {
        appendMessage(senderId, data.content, data.timestamp || new Date().toISOString());
        
        // If message is not from current user, show notification
        if (senderId !== currentUserId) {
            notifyNewMessage(senderId, data.content);
        }
    }
}

function sendPrivateMessage(toUserId, content) {
     // Validate recipient
     toUserId = parseInt(toUserId);
     if (!toUserId || isNaN(toUserId)) {
         console.error("[WebSocket] Invalid recipient ID:", toUserId);
         return false;
     }

    const message = {
        type: 'message',
        to: parseInt(toUserId),
        content: content.trim(),
        from: currentUserId,
        timestamp: new Date().toISOString()
    };

    if (!socket || socket.readyState !== WebSocket.OPEN) {
        console.error('[WebSocket] Connection not ready. State:', socket ? socket.readyState : 'no socket');
        
        // Queue message and try to reconnect
        messageQueue.push(message);
        if (!socket || socket.readyState === WebSocket.CLOSED) {
            connectWebSocket();
        }
        return false;
    }

    try {
        socket.send(JSON.stringify(message));
        console.log("[WebSocket] Message sent successfully");
        appendMessage(currentUserId, content, message.timestamp);
        return true;
    } catch (error) {
        console.error("[WebSocket] Error sending message:", error);
        showErrorMessage('Failed to send message');
        return false;
    }
}

function appendMessage(userId, content, timestamp) {
    console.log(`[DEBUG] Appending message from ${userId} to UI`);
    
    const chatContainer = document.getElementById('chat-messages');
    if (!chatContainer) {
        console.error('[DEBUG] chat-messages container not found');
        return;
    }
    
    // Clear empty state if present
    const emptyState = chatContainer.querySelector('.empty-state');
    if (emptyState) {
        emptyState.remove();
    }
    
    const isCurrentUser = parseInt(userId) === currentUserId;
    console.log(`[DEBUG] Message from ${isCurrentUser ? 'current user' : 'other user'} (${userId} vs ${currentUserId})`);
    
    const messageElement = document.createElement('div');
    messageElement.className = `message ${isCurrentUser ? 'sent' : 'received'}`;
    messageElement.innerHTML = `
        <div class="message-header">
            <span class="username">${getUsername(userId) || 'User ' + userId}</span>
            <span class="timestamp">${formatTimestamp(timestamp)}</span>
        </div>
        <div class="message-content">${escapeHTML(content)}</div>
    `;
    
    chatContainer.appendChild(messageElement);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    
    console.log("[DEBUG] Message appended to UI");
}

function loadOnlineUsers() {
    console.log("[DEBUG] Loading online users list");
    
    const token = getAuthToken();
    if (!token) {
        console.error("[DEBUG] No auth token for loading users");
        return;
    }
    
    fetch('/api/users/online', {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        credentials: 'include' // Important for session cookies
    })
    .then(response => {
        console.log(`[DEBUG] Online users response status: ${response.status}`);
        if (!response.ok) {
            if (response.status === 401) {
                // Token might be expired - try to refresh
                return handleTokenRefresh().then(() => loadOnlineUsers());
            }
            throw new Error(`Failed to fetch online users: ${response.status}`);
        }
        return response.json();
    })
    .then(users => {
        console.log("[DEBUG] Received users:", users);
        updateUsersList(users);
    })
    .catch(error => {
        console.error('[DEBUG] Error loading online users:', error);
        showErrorMessage('Failed to load users. Please try again later.');
    });
}

function updateUsersList(users) {
    const userList = document.getElementById('user-list');
    if (!userList) {
        console.error("[DEBUG] user-list element not found");
        return;
    }
    
    userList.innerHTML = '';
    
    // Filter out current user from the list
    const otherUsers = users.filter(user => parseInt(user.id) !== currentUserId);
    
    if (otherUsers.length === 0) {
        userList.innerHTML = '<li class="no-users">No other users online</li>';
        return;
    }
    
    // Sort users: online first, then by username
    otherUsers.sort((a, b) => {
        if (a.isOnline !== b.isOnline) {
            return a.isOnline ? -1 : 1;
        }
        return a.username.localeCompare(b.username);
    });
    
    otherUsers.forEach(user => {
        const userElement = document.createElement('li');
        userElement.className = `user-item ${user.isOnline ? 'online' : 'offline'}`;
        userElement.dataset.userId = user.id;
        userElement.innerHTML = `
            <div class="user-avatar">
                <div class="status-indicator"></div>
            </div>
            <div class="user-info">
                <span class="username">${escapeHTML(user.username)}</span>
                <span class="last-activity">${user.isOnline ? 'Online' : 'Offline'}</span>
            </div>
        `;
        
        userElement.addEventListener('click', () => {
            openChat(user.id, user.username);
        });
        
        userList.appendChild(userElement);
    });
}

function updateUserStatus(userId, isOnline) {
    userId = parseInt(userId);
    
    const userElement = document.querySelector(`.user-item[data-user-id="${userId}"]`);
    if (userElement) {
        userElement.className = `user-item ${isOnline ? 'online' : 'offline'}`;
        
        const lastActivity = userElement.querySelector('.last-activity');
        if (lastActivity) {
            lastActivity.textContent = isOnline ? 'Online' : 'Offline';
        }
        
        // Update chat header if we're chatting with this user
        if (currentChatUserId === userId) {
            const statusIndicator = document.querySelector('#chat-header .user-status');
            if (statusIndicator) {
                statusIndicator.textContent = isOnline ? 'Online' : 'Offline';
                statusIndicator.className = `user-status ${isOnline ? 'online' : 'offline'}`;
            }
        }
    }
}

function openChat(userId, username) {
   
    userId = parseInt(userId);
    if (!userId || isNaN(userId)) {
        console.error("[DEBUG] Invalid user ID:", userId);
        return;
    }

    currentChatUserId = userId;
    console.log(`[DEBUG] Opening chat with user ${userId} (${username})`);

    
    // Update chat header
    const headerEl = document.getElementById('chat-header');
    if (headerEl) {
        const userElement = document.querySelector(`.user-item[data-user-id="${userId}"]`);
        const isOnline = userElement ? userElement.classList.contains('online') : false;
        
        headerEl.innerHTML = `
            <div class="user-info">
                <div class="user-avatar"></div>
                <div>
                    <h4>${escapeHTML(username || 'User ' + userId)}</h4>
                    <p class="user-status ${isOnline ? 'online' : 'offline'}">${isOnline ? 'Online' : 'Offline'}</p>
                </div>
            </div>
        `;
    }
    
    // Clear messages and show loading
    const chatContainer = document.getElementById('chat-messages');
    if (chatContainer) {
        chatContainer.innerHTML = '<div class="loading-messages">Loading messages...</div>';
    }
    
    // Show chat window
    const chatWindow = document.getElementById('chat-window');
    if (chatWindow) {
        chatWindow.classList.add('active');
    }
    
    // Focus input
    const inputField = document.getElementById('message-input');
    if (inputField) {
        inputField.focus();
    }
    
    // Load message history
    loadMessageHistory(userId);
    
    // Handle mobile view
    handleMobileView();
}

function loadMessageHistory(userId, offset = 0) {
    console.log(`[DEBUG] Loading message history for user ${userId}, offset ${offset}`);
    userId = parseInt(userId);
    
    const token = getAuthToken();
    if (!token) {
        console.error("[DEBUG] No auth token for loading messages");
        return;
    }
    
    fetch(`/api/messages/${userId}?offset=${offset}`, {
        method: 'GET',
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json'
        },
        credentials: 'include'
    })
    .then(response => {
        console.log(`[DEBUG] Messages response status: ${response.status}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch messages: ${response.status}`);
        }
        return response.json();
    })
    .then(messages => {
        console.log(`[DEBUG] Retrieved ${messages.length} messages`);
        displayMessageHistory(messages, offset);
    })
    .catch(error => {
        console.error('[DEBUG] Error loading messages:', error);
        const chatContainer = document.getElementById('chat-messages');
        if (chatContainer && offset === 0) {
            chatContainer.innerHTML = `
                <div class="error-state">
                    <i class="fas fa-exclamation-circle"></i>
                    <p>Failed to load messages. <button onclick="loadMessageHistory(${userId})">Try again</button></p>
                </div>
            `;
        }
    });
}

function displayMessageHistory(messages, offset) {
    const chatContainer = document.getElementById('chat-messages');
    if (!chatContainer) return;
    
    if (offset === 0) {
        chatContainer.innerHTML = '';
        
        if (messages.length === 0) {
            chatContainer.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-comment-dots"></i>
                    <p>No messages yet. Start the conversation!</p>
                </div>
            `;
            return;
        }
        
        // Display messages in chronological order
        messages.forEach(msg => {
            appendMessage(msg.senderId || msg.sender_id, msg.content, msg.createdAt || msg.created_at);
        });
        
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
}

function initializeChat() {
    console.log("[DEBUG] Initializing chat system...");
    
    // Prevent multiple initializations
    if (window.chatInitialized) return;
    window.chatInitialized = true;
    
    // Initialize current user
    if (!initializeCurrentUser()) {
        console.error("[DEBUG] Failed to initialize current user");
        return;
    }
    
    if (isLoggedIn()) {
        console.log("[DEBUG] User is logged in - checking token");
        const token = getAuthToken();
        if (!token) {
            console.error("[DEBUG] User marked as logged in but no token found");
            showErrorMessage('Authentication error - please login again');
            handleLogout();
            return;
        }
        
        // Only connect if not already connected
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            console.log("[DEBUG] Token found - connecting WebSocket");
            connectWebSocket();
        }
        
        setupChatUI();
    }
}

function setupChatUI() {
    console.log("[DEBUG] Setting up chat UI elements");
    
    // Send button
    const sendButton = document.getElementById('send-button');
    if (sendButton) {
        sendButton.addEventListener('click', (e) => {
            e.preventDefault();
            sendMessage();
        });
    } else {
        console.error("[DEBUG] Send button not found");
    }
    
    // Message input
    const inputField = document.getElementById('message-input');
    if (inputField) {
        inputField.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        
        // Ensure input is enabled when chat is open
        inputField.disabled = !currentChatUserId;
    } else {
        console.error("[DEBUG] Message input not found");
    }
}
// Check if elements exist
console.log("Message input exists:", !!document.getElementById('message-input'));
console.log("Send button exists:", !!document.getElementById('send-button'));
console.log("Current chat user ID:", currentChatUserId);

// Verify event listeners
const inputField = document.getElementById('message-input');
if (inputField) {
    console.log("Input field event listeners:", 
        getEventListeners(inputField));
}

function sendMessage() {
    if (!isConnected) {
        showErrorMessage('Not connected to chat server');
        return;
    }
    const inputField = document.getElementById('message-input');
    if (!inputField) {
        console.error("[DEBUG] Message input field not found");
        showErrorMessage('Message input not available');
        return;
    }

    if (!currentChatUserId) {
        console.error("[DEBUG] No chat user selected");
        showErrorMessage('Please select a user to chat with');
        return;
    }

    const message = inputField.value.trim();
    if (!message) {
        console.log("[DEBUG] Empty message, not sending");
        return;
    }

    if (sendPrivateMessage(currentChatUserId, message)) {
        inputField.value = '';
    }
}

function handleMobileView() {
    const userListContainer = document.getElementById('user-list-container');
    const chatWindow = document.getElementById('chat-window');
    
    if (window.innerWidth < 768) {
        // Mobile view
        if (currentChatUserId) {
            if (userListContainer) userListContainer.style.display = 'none';
            if (chatWindow) chatWindow.style.display = 'flex';
        } else {
            if (userListContainer) userListContainer.style.display = 'block';
            if (chatWindow) chatWindow.style.display = 'none';
        }
    } else {
        // Desktop view
        if (userListContainer) userListContainer.style.display = 'block';
        if (chatWindow) chatWindow.style.display = 'flex';
    }
}

// Utility functions
function isLoggedIn() {
    return localStorage.getItem('isAuthenticated') === 'true';
}

function getUsername(userId) {
    const userElement = document.querySelector(`.user-item[data-user-id="${userId}"]`);
    if (userElement) {
        const usernameEl = userElement.querySelector('.username');
        return usernameEl ? usernameEl.textContent : null;
    }
    
    // Fallback to stored user data if it's current user
    if (parseInt(userId) === currentUserId) {
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        return user.username;
    }
    
    return null;
}

function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    
    if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    
    if (date.getFullYear() === now.getFullYear()) {
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + 
               ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    
    return date.toLocaleDateString() + ' ' + 
           date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeHTML(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function showErrorMessage(message) {
    console.error("[UI] Error:", message);
    
    const errorEl = document.createElement('div');
    errorEl.className = 'system-message error';
    errorEl.textContent = message;
    
    const chatContainer = document.getElementById('chat-messages');
    if (chatContainer) {
        chatContainer.appendChild(errorEl);
        chatContainer.scrollTop = chatContainer.scrollHeight;
        
        setTimeout(() => {
            if (errorEl.parentNode === chatContainer) {
                chatContainer.removeChild(errorEl);
            }
        }, 5000);
    } else {
        // Fallback to alert if no chat container
        alert(message);
    }
}

function showSuccessMessage(message) {
    console.log("[UI] Success:", message);
    
    const successEl = document.createElement('div');
    successEl.className = 'system-message success';
    successEl.textContent = message;
    
    const chatContainer = document.getElementById('chat-messages');
    if (chatContainer) {
        chatContainer.appendChild(successEl);
        chatContainer.scrollTop = chatContainer.scrollHeight;
        
        setTimeout(() => {
            if (successEl.parentNode === chatContainer) {
                chatContainer.removeChild(successEl);
            }
        }, 3000);
    }
}

function showReconnectMessage() {
    const msgEl = document.createElement('div');
    msgEl.className = 'system-message warning';
    msgEl.innerHTML = 'Connection lost. <a href="#" class="reconnect-link">Click here to reconnect</a>';
    
    msgEl.querySelector('.reconnect-link').addEventListener('click', (e) => {
        e.preventDefault();
        reconnectAttempts = 0;
        connectWebSocket();
        if (msgEl.parentNode) {
            msgEl.parentNode.removeChild(msgEl);
        }
    });
    
    const chatContainer = document.getElementById('chat-messages');
    if (chatContainer) {
        chatContainer.appendChild(msgEl);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
}

function notifyNewMessage(fromUserId, content) {
    // Only notify if not currently chatting with this user
    if (parseInt(fromUserId) !== currentChatUserId) {
        const userElement = document.querySelector(`.user-item[data-user-id="${fromUserId}"]`);
        if (userElement) {
            userElement.classList.add('new-message');
        }
    }
}

// Cleanup function for logout
function cleanupChat() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.close(1000, 'User logged out');
    }
    socket = null;
    currentChatUserId = null;
    currentUserId = null;
    isConnected = false;
    messageQueue = [];
    reconnectAttempts = 0;
}

// Export functions for global access
window.initializeChat = initializeChat;
window.cleanupChat = cleanupChat;
window.loadOnlineUsers = loadOnlineUsers;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    console.log("[DEBUG] DOM loaded, initializing chat...");
    
    // Small delay to ensure other scripts have loaded
    setTimeout(() => {
        initializeChat();
    }, 500);
});

console.log("[DEBUG] WebSocket chat module loaded")

function handleTokenRefresh() {
    return fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include'
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Token refresh failed');
        }
        return response.json();
    })
    .then(data => {
        if (data.token) {
            localStorage.setItem('auth_token', data.token);
            return true;
        }
        throw new Error('No token in refresh response');
    })
    .catch(error => {
        console.error('Token refresh failed:', error);
        handleLogout();
        return false;
    });
};