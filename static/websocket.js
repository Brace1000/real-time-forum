


let socket;
let currentChatUserId = null;
let currentUserId = getUserId();
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;


function connectWebSocket() {
    console.log("[WebSocket] Initializing connection...");
    
    const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const token = localStorage.getItem('auth_token') || getCookie('auth_token');
    
    if (!token) {
        console.error("[WebSocket] No authentication token found");
        return;
    }

    socket = new WebSocket(`${protocol}${window.location.host}/ws?token=${encodeURIComponent(token)}`);
    
    socket.onopen = () => {
        console.log("[WebSocket] Connection established");
        reconnectAttempts = 0;
        
        // Send initial handshake
        const handshake = {
            type: "handshake",
            userId: currentUserId
        };
        socket.send(JSON.stringify(handshake));
        console.log("[WebSocket] Sent handshake", handshake);
    };
    
    socket.onmessage = (event) => {
        console.log("[WebSocket] Received message:", event.data);
        
        try {
            const data = JSON.parse(event.data);
            console.log("[WebSocket] Parsed message:", data);
            
            // Handle different message types
            switch(data.type) {
                case 'message':
                    console.log(`[WebSocket] New message from ${data.from}`);
                    appendMessage(data.from, data.content, data.timestamp);
                    break;
                    
                case 'user_status':
                    console.log(`[WebSocket] User ${data.userId} is now ${data.isOnline ? 'online' : 'offline'}`);
                    updateUserStatus(data.userId, data.isOnline);
                    break;
                    
                default:
                    console.log('[WebSocket] Unknown message type:', data.type);
            }
        } catch (error) {
            console.error('[WebSocket] Error processing message:', error);
        }
    };
    
    socket.onclose = (event) => {
        console.log(`[WebSocket] Connection closed. Code: ${event.code}, Reason: ${event.reason}`);
        
        if (event.code !== 1000) { // 1000 is normal closure
            const delay = Math.min(1000 * (2 ** reconnectAttempts), 30000);
            console.log(`[WebSocket] Will attempt reconnect in ${delay}ms`);
            setTimeout(connectWebSocket, delay);
            reconnectAttempts++;
        }
    };
    
    socket.onerror = (error) => {
        console.error('[WebSocket] Error:', error);
    };
}

function sendPrivateMessage(toUserId, content) {
    console.log(`[WebSocket] Attempting to send message to ${toUserId}: ${content}`);
    
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        console.error('[WebSocket] Connection not ready. State:', socket ? socket.readyState : 'no socket');
        showErrorMessage('Not connected to chat server');
        return false;
    }

    const message = {
        type: 'message',
        to: parseInt(toUserId),
        content: content.trim(),
        from: currentUserId  // Make sure to include sender ID
    };
    
    console.log("[WebSocket] Sending message:", message);
    socket.send(JSON.stringify(message));
    
    // Optimistically display the message
    appendMessage(currentUserId, content, new Date().toISOString());
    return true;
}
function appendMessage(userId, content, timestamp) {
    console.log(`[DEBUG] Appending message from ${userId} to UI`);
    
    const chatContainer = document.getElementById('chat-messages');
    if (!chatContainer) {
        console.error('[DEBUG] chat-messages container not found');
        return;
    }
    
    const isCurrentUser = parseInt(userId) === currentUserId;
    console.log(`[DEBUG] Message from ${isCurrentUser ? 'current user' : 'other user'}`);
    
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
// User list functions
function loadOnlineUsers() {
    console.log("[DEBUG] Loading online users list");
    fetch('/api/users/online', {
        headers: {
            'Authorization': 'Bearer ' + (localStorage.getItem('auth_token') || getCookie('auth_token'))
        }
    })
    .then(response => {
        console.log(`[DEBUG] Online users response status: ${response.status}`);
        if (!response.ok) {
            throw new Error('Failed to fetch online users');
        }
        return response.json();
    })
    .then(users => {
        const userList = document.getElementById('user-list');
        if (!userList) return;
        
        userList.innerHTML = '';
        
        // Sort users: online first, then by last message time, then alphabetically
        users.sort((a, b) => {
            // Online users come first
            if (a.isOnline !== b.isOnline) {
                return a.isOnline ? -1 : 1;
            }
            
            // Then sort by last message time
            if (a.lastMessage && b.lastMessage) {
                return new Date(b.lastMessage) - new Date(a.lastMessage);
            } else if (a.lastMessage) {
                return -1;
            } else if (b.lastMessage) {
                return 1;
            }
            
            // Finally sort alphabetically
            return a.username.localeCompare(b.username);
        });
        
        // Add users to the list
        users.forEach(user => {
            const userElement = document.createElement('li');
            userElement.className = `user-item ${user.isOnline ? 'online' : 'offline'}`;
            userElement.dataset.userId = user.id;
            userElement.innerHTML = `
                <div class="user-avatar">
                    <div class="status-indicator"></div>
                </div>
                <div class="user-info">
                    <span class="username">${escapeHTML(user.username)}</span>
                    <span class="last-activity">${user.lastMessage ? formatLastSeen(user.lastMessage) : 'No messages yet'}</span>
                </div>
            `;
            userElement.addEventListener('click', () => openChat(user.id, user.username));
            userList.appendChild(userElement);
        });
    })
    .catch(error => {
        console.error('[DEBUG] Error loading online users:', error);
        console.error('Error loading online users:', error);
        showErrorMessage('Failed to load users. Please try again later.');
    });
}

function updateUserStatus(userId, isOnline) {
    // Convert userId to number for safe comparison
    userId = parseInt(userId);
    
    const userElement = document.querySelector(`.user-item[data-user-id="${userId}"]`);
    if (userElement) {
        if (isOnline) {
            userElement.classList.remove('offline');
            userElement.classList.add('online');
        } else {
            userElement.classList.remove('online');
            userElement.classList.add('offline');
        }
        
        // Also update the chat header if we're chatting with this user
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
    // Convert userId to number for safe comparison
    userId = parseInt(userId);
    currentChatUserId = userId;
    
    // Update UI to show the selected chat
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
    
    // Remove notification badge when opening chat
    const userElement = document.querySelector(`.user-item[data-user-id="${userId}"]`);
    if (userElement) {
        userElement.classList.remove('new-message');
        const badge = userElement.querySelector('.notification-badge');
        if (badge) {
            badge.remove();
        }
    }
    
    // Clear and load the message history
    const chatContainer = document.getElementById('chat-messages');
    if (chatContainer) {
        chatContainer.innerHTML = '<div class="loading-messages">Loading messages...</div>';
        loadMessageHistory(userId);
    }
    
    // Show the chat container
    const chatWindow = document.getElementById('chat-window');
    if (chatWindow) {
        chatWindow.classList.add('active');
    }
    
    // Focus the input field
    const inputField = document.getElementById('message-input');
    if (inputField) {
        inputField.focus();
    }
    
    // In mobile view, show the conversation and hide the user list
    if (window.innerWidth < 768) {
        const userListContainer = document.getElementById('user-list-container');
        if (userListContainer) {
            userListContainer.style.display = 'none';
        }
        
        const chatConversation = document.getElementById('chat-window');
        if (chatConversation) {
            chatConversation.style.display = 'flex';
        }
    }
}

function loadMessageHistory(userId, offset = 0) {
    console.log(`[DEBUG] Loading message history for user ${userId}, offset ${offset}`);
    // Convert userId to number for consistent handling
    userId = parseInt(userId);
    
    fetch(`/api/messages/${userId}?offset=${offset}`, {
        headers: {
            'Authorization': 'Bearer ' + (localStorage.getItem('auth_token') || getCookie('auth_token'))
        }
    })
    .then(response => {
        console.log(`[DEBUG] Received response status: ${response.status}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch messages: ${response.status}`);
        }
        return response.json();
    })
    .then(messages => {
        console.log(`[DEBUG] Retrieved ${messages.length} messages`);
        const chatContainer = document.getElementById('chat-messages');
        if (!chatContainer) return;
        
        // Clear the container if this is the initial load
        if (offset === 0) {
            chatContainer.innerHTML = '';
            
            // If no messages, show empty state
            if (messages.length === 0) {
                chatContainer.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-comment-dots"></i>
                        <p>No messages yet. Start the conversation!</p>
                    </div>
                `;
                return;
            }
        } else {
            // Remove loading indicator if present
            const loadingEl = chatContainer.querySelector('.loading-earlier');
            if (loadingEl) {
                chatContainer.removeChild(loadingEl);
            }
        }
        
        // Keep track of scroll position for prepending messages
        const scrollHeight = chatContainer.scrollHeight;
        const scrollTop = chatContainer.scrollTop;
        
        // Process messages based on whether this is initial load or "load more"
        if (offset > 0) {
            const fragment = document.createDocumentFragment();
            
            messages.forEach(msg => {
                const messageEl = createMessageElement(msg.senderId, msg.content, msg.createdAt);
                fragment.appendChild(messageEl);
            });
            
            if (messages.length > 0) {
                chatContainer.prepend(fragment);
                // Maintain scroll position
                chatContainer.scrollTop = chatContainer.scrollHeight - scrollHeight + scrollTop;
            }
        } else {
            // Append messages in normal order for initial load
            messages.forEach(msg => {
                appendMessage(msg.senderId, msg.content, msg.createdAt);
            });
            
            // Scroll to bottom
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
        
        // Add load more button if there might be more messages
        if (messages.length >= 10) {
            const loadMoreEl = document.createElement('div');
            loadMoreEl.className = 'load-more-messages';
            loadMoreEl.innerHTML = '<button>Load earlier messages</button>';
            loadMoreEl.addEventListener('click', function() {
                this.innerHTML = '<div class="loading-earlier">Loading...</div>';
                loadMessageHistory(userId, offset + messages.length);
            });
            chatContainer.prepend(loadMoreEl);
        }
    })
    .catch(error => {
        console.error('[DEBUG] Error loading messages:', error);
        console.error('Error loading messages:', error);
        const chatContainer = document.getElementById('chat-messages');
        if (chatContainer) {
            if (offset === 0) {
                chatContainer.innerHTML = `
                    <div class="error-state">
                        <i class="fas fa-exclamation-circle"></i>
                        <p>Failed to load messages. Please try again.</p>
                    </div>
                `;
            } else {
                const loadingEl = chatContainer.querySelector('.loading-earlier');
                if (loadingEl) {
                    loadingEl.innerHTML = 'Failed to load. <a href="#">Try again</a>';
                    loadingEl.querySelector('a').addEventListener('click', (e) => {
                        e.preventDefault();
                        loadMessageHistory(userId, offset);
                    });
                }
            }
        }
    });
}

// Continue from previous implementation
function createMessageElement(userId, content, timestamp) {
    const isCurrentUser = parseInt(userId) === currentUserId;
    
    const messageElement = document.createElement('div');
    messageElement.className = `message ${isCurrentUser ? 'sent' : 'received'}`;
    messageElement.innerHTML = `
        <div class="message-header">
            <span class="username">${getUsername(userId) || 'User ' + userId}</span>
            <span class="timestamp">${formatTimestamp(timestamp)}</span>
        </div>
        <div class="message-content">${escapeHTML(content)}</div>
    `;
    return messageElement;
}

// Set up chat UI functionality
function initializeChat() {
    console.log("[DEBUG] Initializing chat system...");
    
    if (isLoggedIn()) {
        console.log("[DEBUG] User is logged in - connecting WebSocket");
        connectWebSocket();
        setupChatUI();
    } else {
        console.log("[DEBUG] User not logged in - chat not initialized");
    }
}

function setupChatUI() {
    console.log("[DEBUG] Setting up chat UI elements");
    
    // Send button functionality
    const sendButton = document.getElementById('send-button');
    if (sendButton) {
        console.log("[DEBUG] Found send button - adding event listener");
        sendButton.addEventListener('click', function(e) {
            e.preventDefault();
            sendMessage();
        });
    } else {
        console.error("[DEBUG] Send button not found");
    }
    
    // Input field
    const inputField = document.getElementById('message-input');
    if (inputField) {
        console.log("[DEBUG] Found message input - adding event listener");
        inputField.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    } else {
        console.error("[DEBUG] Message input not found");
    }
    
    // Check if chat elements exist
    if (!document.getElementById('chat-messages')) {
        console.error("[DEBUG] chat-messages element not found");
    }
    if (!document.getElementById('user-list')) {
        console.error("[DEBUG] user-list element not found");
    }
    
    console.log("[DEBUG] Chat UI setup complete");
}

function handleResize() {
    const userListContainer = document.getElementById('user-list-container');
    const chatWindow = document.getElementById('chat-window');
    const chatHeader = document.getElementById('chat-header');
    
    if (window.innerWidth >= 768) {
        // Desktop view
        if (userListContainer) userListContainer.style.display = 'block';
        if (chatWindow) chatWindow.style.display = 'flex';
        
        // Remove back button if it exists
        const backButton = chatHeader?.querySelector('.back-to-users');
        if (backButton) backButton.remove();
    } else {
        // Mobile view
        if (currentChatUserId) {
            // If in a chat, show only the chat
            if (userListContainer) userListContainer.style.display = 'none';
            if (chatWindow) chatWindow.style.display = 'flex';
        } else {
            // Otherwise show only the user list
            if (userListContainer) userListContainer.style.display = 'block';
            if (chatWindow) chatWindow.style.display = 'none';
        }
        
        // Add back button if it doesn't exist
        if (chatHeader && !chatHeader.querySelector('.back-to-users')) {
            const backButton = document.createElement('button');
            backButton.className = 'back-to-users';
            backButton.innerHTML = '<i class="fas fa-arrow-left"></i>';
            backButton.addEventListener('click', () => {
                if (userListContainer) userListContainer.style.display = 'block';
                if (chatWindow) chatWindow.style.display = 'none';
                currentChatUserId = null;
            });
            chatHeader.prepend(backButton);
        }
    }
}

// Helper function to send a message
function sendMessage() {
    const inputField = document.getElementById('message-input');
    if (!inputField || !currentChatUserId) return;
    
    const message = inputField.value.trim();
    if (message && sendPrivateMessage(currentChatUserId, message)) {
        inputField.value = '';
    }
}

// Show error message in chat
function showErrorMessage(message) {
    const errorEl = document.createElement('div');
    errorEl.className = 'system-message error';
    errorEl.textContent = message;
    
    const chatContainer = document.getElementById('chat-messages');
    if (chatContainer) {
        chatContainer.appendChild(errorEl);
        chatContainer.scrollTop = chatContainer.scrollHeight;
        
        // Remove after 5 seconds
        setTimeout(() => {
            if (errorEl.parentNode === chatContainer) {
                chatContainer.removeChild(errorEl);
            }
        }, 5000);
    }
}

// Show reconnect message when max reconnect attempts reached
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

// Notify user about new message
function notifyNewMessage(fromUserId, content) {
    // Highlight the user in the list
    const userElement = document.querySelector(`.user-item[data-user-id="${fromUserId}"]`);
    if (userElement) {
        userElement.classList.add('new-message');
        
        // Add notification count or update it
        let notificationBadge = userElement.querySelector('.notification-badge');
        if (!notificationBadge) {
            notificationBadge = document.createElement('span');
            notificationBadge.className = 'notification-badge';
            userElement.querySelector('.user-avatar').appendChild(notificationBadge);
        }
        
        const count = parseInt(notificationBadge.textContent || '0');
        notificationBadge.textContent = count + 1;
        
        // Update last message preview
        const lastActivity = userElement.querySelector('.last-activity');
        if (lastActivity) {
            lastActivity.textContent = truncateString(content, 20);
        }
    }
    
    // Browser notification if supported and permission granted
    if ('Notification' in window && Notification.permission === 'granted') {
        const username = getUsername(fromUserId) || 'User ' + fromUserId;
        const notification = new Notification('New message from ' + username, {
            body: truncateString(content, 50),
            icon: '/static/img/icon.png' // Replace with your app icon
        });
        
        notification.onclick = function() {
            window.focus();
            openChat(fromUserId, username);
            this.close();
        };
    }
    
    // Sound notification
    playNotificationSound();
}

// Utility functions
function getUsername(userId) {
    // This would ideally come from a cache or the users list
    const userElement = document.querySelector(`.user-item[data-user-id="${userId}"]`);
    return userElement ? userElement.querySelector('.username').textContent : null;
}

function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    
    // If today, show only time
    if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    
    // If this year, show month and day
    if (date.getFullYear() === now.getFullYear()) {
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + 
               ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    
    // Otherwise show full date
    return date.toLocaleDateString() + ' ' + 
           date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatLastSeen(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);
    
    if (diffSec < 60) {
        return 'Just now';
    } else if (diffMin < 60) {
        return `${diffMin}m ago`;
    } else if (diffHour < 24) {
        return `${diffHour}h ago`;
    } else if (diffDay < 7) {
        return `${diffDay}d ago`;
    } else {
        return date.toLocaleDateString();
    }
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

function truncateString(str, maxLength) {
    if (!str) return '';
    return str.length > maxLength ? str.substring(0, maxLength) + '...' : str;
}

function playNotificationSound() {
    const audio = new Audio('/static/sounds/notification.mp3');
    audio.play().catch(err => {
        // Autoplay may be blocked, that's OK
        console.log('Could not play notification sound:', err);
    });
}

// Request notification permission
function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        Notification.requestPermission();
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    initializeChat();
    requestNotificationPermission();
});