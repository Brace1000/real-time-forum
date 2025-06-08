

document.addEventListener('DOMContentLoaded', function () {
  showPage('home');
  setupNavigation();
  setupForms(); 
  updateAuthUI();
  if (isLoggedIn()) {
    initializeChat();
}
});
function isLoggedIn() {
    return localStorage.getItem('isAuthenticated') === 'true';
}

// Add getUserId function
function getUserId() {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    return user.id || 0;
}
// Show specified page and hide others
function showPage(pageId) {
  document.querySelectorAll('.page-section').forEach(section => {
      section.classList.remove('active-section');
  });

  const page = document.getElementById(`${pageId}-page`);
  if (page) {
      page.classList.add('active-section');

      // Setup forms only if not initialized
      if (!page.dataset.initialized && ['register', 'login', 'create-post'].includes(pageId)) {
          setupForms();
          page.dataset.initialized = 'true';
      }
      if (pageId === 'home') {
        loadPosts();
    }

  } else {
      console.error(`Page with ID "${pageId}-page" not found!`);
  }

  const filtersSidebar = document.getElementById('filters-sidebar');
  if (filtersSidebar) {
      filtersSidebar.style.display = pageId === 'home' ? 'block' : 'none';
  }

  updateAuthUI();
}

// Set up navigation links
function setupNavigation() {
  document.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', function(e) {
          e.preventDefault();
          const page = this.getAttribute('data-page');
          showPage(page);
      });
  });

  const createPostBtn = document.getElementById('create-post-btn');
  if (createPostBtn) {
      createPostBtn.addEventListener('click', function() {
          showPage('create-post');
      });
  }

  const logoutForm = document.getElementById('logout-form');
  if (logoutForm) {
      logoutForm.addEventListener('submit', function(e) {
          e.preventDefault();
          handleLogout();
      });
  }

  const homeLoginBtn = document.getElementById('home-login-btn');
  if (homeLoginBtn) {
      homeLoginBtn.addEventListener('click', function() {
          showPage('login');
      });
  }

  const homeRegisterBtn = document.getElementById('home-register-btn');
  if (homeRegisterBtn) {
      homeRegisterBtn.addEventListener('click', function() {
          showPage('register');
      });
  }
}

// Set up form submissions
function setupForms() {
  const loginForm = document.getElementById('login-form');
  if (loginForm && !loginForm.dataset.listenerAdded) {
      loginForm.addEventListener('submit', function(e) {
          e.preventDefault();
          handleLogin();
      });
      loginForm.dataset.listenerAdded = 'true';
  }

  const registerForm = document.getElementById('register-form');
  if (registerForm && !registerForm.dataset.listenerAdded) {
      registerForm.addEventListener('submit', function(e) {
          e.preventDefault();
          handleRegister();
      });
      registerForm.dataset.listenerAdded = 'true';
  }

  const createPostForm = document.getElementById('create-post-form');
  if (createPostForm && !createPostForm.dataset.listenerAdded) {
      createPostForm.addEventListener('submit', function(e) {
          e.preventDefault();
          handleCreatePost();
      });
      createPostForm.dataset.listenerAdded = 'true';
  }
}

// Update UI based on authentication status
function updateAuthUI() {
  const isAuthenticated = localStorage.getItem('isAuthenticated') === 'true';

  const loginBtn = document.querySelector('#auth-buttons #login-btn');
  const registerBtn = document.querySelector('#auth-buttons #register-btn');
  const logoutForm = document.querySelector('#logout-form');

  if (loginBtn && registerBtn && logoutForm) {
      loginBtn.style.display = isAuthenticated ? 'none' : 'inline-block';
      registerBtn.style.display = isAuthenticated ? 'none' : 'inline-block';
      logoutForm.style.display = isAuthenticated ? 'inline-block' : 'none';
  }

  const authContainer = document.querySelector('.auth-center-container');
  const authenticatedContent = document.getElementById('authenticated-content');
  const chatSidebar = document.getElementById('chat-sidebar');

  if (authContainer && authenticatedContent && chatSidebar) {
      authContainer.style.display = isAuthenticated ? 'none' : 'flex';
      authenticatedContent.style.display = isAuthenticated ? 'block' : 'none';
      chatSidebar.style.display = isAuthenticated ? 'block' : 'none';
  }
}


// Handle login
function handleLogin() {
    const identifier = document.getElementById('identifier').value;
    const password = document.getElementById('password').value;

    // Clear previous errors
    document.querySelectorAll('.error-message').forEach(el => el.textContent = '');
    
    // Client-side validation
    if (!identifier) {
        document.getElementById('identifier-error').textContent = 'Please enter your username or email';
        return;
    }

    if (!password) {
        document.getElementById('password-error').textContent = 'Please enter your password';
        return;
    }

    // Show loading state
    const submitBtn = document.querySelector('#login-form button[type="submit"]');
    const originalBtnText = submitBtn.textContent;
    submitBtn.textContent = 'Logging in...';
    submitBtn.disabled = true;

    fetch('/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            identifier: identifier,
            password: password
        }),
        credentials: 'include' 
    })
    .then(async response => {
        // Reset button state
        submitBtn.textContent = originalBtnText;
        submitBtn.disabled = false;

        const data = await response.json();
        
        if (!response.ok) {
            // Handle validation errors
            if (data.errors) {
                for (const [field, message] of Object.entries(data.errors)) {
                    const errorElement = document.getElementById(`${field}-error`);
                    if (errorElement) errorElement.textContent = message;
                }
            }
            throw new Error(data.message || 'Login failed');
        }

        return data;
    })
    .then(data => {
        if (data.success && data.authenticated) {
            // Store authentication status and user data
            localStorage.setItem('isAuthenticated', 'true');
            
            // Store the token if provided in response
            if (data.token) {
                localStorage.setItem('auth_token', data.token);
            }
            
            if (data.user) {
                localStorage.setItem('user', JSON.stringify(data.user));
            }
            
            updateAuthUI();
            showPage('home');
            
            // Initialize chat after successful login
            initializeChat();
            loadPosts();
        } else {
            throw new Error('Authentication failed');
        }
    })
    .catch(error => {
        console.error('Login error:', error);
        document.getElementById('password-error').textContent = error.message || 'Login failed. Please try again.';
    });
}
// Handle registration
async function handleRegister() {
    console.log('handleRegister called');
console.trace(); 
    try {
        const form = document.getElementById('register-form');
        if (!form) {
            console.error('Register form not found!');
            return;
        }

        //
        const formData = new FormData(form);

        
        console.log("Form Data Entries:");
        for (let [key, value] of formData.entries()) {
            console.log(key, value);
        }

        // Clear previous errors
        document.querySelectorAll('.error-message').forEach(el => el.textContent = '');
        
        // Validate required fields
        const requiredFields = [
            'username', 'email', 'password', 'confirmpassword',
            'firstname', 'lastname', 'age', 'gender'
        ];

        let hasErrors = false;
        for (const field of requiredFields) {
            const value = formData.get(field);
            if (!value) {
                const errorElement = document.getElementById(`${field}-error`) ||
                    document.getElementById(`${field === 'password' ? 'reg-password' : field}-error`);
                if (errorElement) {
                    errorElement.textContent = 'This field is required';
                    hasErrors = true;
                }
            }
        }

        // Validate password match
        const password = formData.get('password');
        const confirmPassword = formData.get('confirmpassword');
        if (password !== confirmPassword) {
            const errorElement = document.getElementById('confirmpassword-error');
            if (errorElement) {
                errorElement.textContent = 'Passwords do not match';
                hasErrors = true;
            }
        }

        if (hasErrors) return;

        // Submit to server
        const response = await fetch('/register', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (!response.ok) {
            if (data.errors) {
                for (const [field, message] of Object.entries(data.errors)) {
                    const errorElement = document.getElementById(`${field}-error`);
                    if (errorElement) errorElement.textContent = message;
                }
            }
            throw new Error(data.error || 'Registration failed');
        }

        if (data.success) {
            alert(data.message || 'Registration successful!');
            showPage('login');
        }
    } catch (error) {
        console.error('Registration error:', error);
        // Show generic error to user
        alert('Registration failed. Please try again.');
    }
}
// Handle creating a post
async function loadCategories() {
    try {
        const response = await fetch('/api/categories', {
            credentials: 'include' // Include cookies
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            throw new Error("Response is not JSON");
        }
        
        const categories = await response.json();
        console.log('Loaded categories:', categories); // Debug log
        
        const container = document.getElementById('categories-container');
        if (container) {
            container.innerHTML = categories.map(cat => `
                <div class="category-option">
                    <input type="checkbox" 
                           id="category-${cat.category_id}" 
                           name="category" 
                           value="${cat.category_id}">
                    <label for="category-${cat.category_id}">
                        ${cat.name}${cat.description ? ` - ${cat.description}` : ''}
                    </label>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Error loading categories:', error);
        const container = document.getElementById('categories-container');
        if (container) {
            container.innerHTML = `
                <div class="error">
                    Failed to load categories. 
                    <button onclick="loadCategories()">Retry</button>
                </div>
            `;
        }
    }
}
// Enhanced handleCreatePost function
async function handleCreatePost() {
    // Check authentication more thoroughly
    const isAuthenticated = localStorage.getItem('isAuthenticated') === 'true';
    const user = JSON.parse(localStorage.getItem('user')  || {});
    
    if (!isAuthenticated || !user.id) {
        alert('Please login to create posts');
        showPage('login');
        return;
    }

    const form = document.getElementById('create-post-form');
    if (!form) return;

    const formData = new FormData(form);
    const title = formData.get('title');
    const content = formData.get('content');
    const categories = formData.getAll('category');

    // Validate inputs
    if (!title || !content) {
        alert('Title and content are required');
        return;
    }

    if (categories.length === 0) {
        alert('Please select at least one category');
        return;
    }

    // Show loading state
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Posting...';

    try {
        const response = await fetch('/post/create', {
            method: 'POST',
            body: formData,
            credentials: 'include', // This sends cookies with the request
            headers: {
               'Authorization': `Bearer ${localStorage.getItem('auth_token')}`, // If using JWT
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || 'Failed to create post');
        }

        const data = await response.json();
        if (data.success) {
            form.reset();
            alert('Post created successfully!');
            showPage('home');
            // Reload posts to show the new one
            loadPosts();
        } else {
            throw new Error(data.message || 'Post creation failed');
        }
    } catch (error) {
        console.error('Post creation error:', error);
        alert(error.message || 'Failed to create post. Please try again.');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
    }
}

async function loadPosts(filters = {}) {
    try {
        const queryParams = new URLSearchParams();
        if (filters.category) queryParams.append('category', filters.category);
        if (filters.myPostsOnly) queryParams.append('my_posts_only', 'true');
        if (filters.likedPostsOnly) queryParams.append('liked_posts_only', 'true');
        
        const response = await fetch(`/api/posts?${queryParams.toString()}`, {
            credentials: 'include',
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            throw new Error("Response is not JSON");
        }

        const posts = await response.json();
        displayPosts(posts);
        
    } catch (error) {
        console.error('Error loading posts:', error);
        const container = document.getElementById('posts-container');
        if (container) {
            container.innerHTML = `
                <div class="error">
                    Failed to load posts. 
                    <button onclick="loadPosts()">Retry</button>
                </div>
            `;
        }
    }
}
// NEW FUNCTION: Display posts in the UI
function displayPosts(posts) {
    const container = document.getElementById('posts-container');
    if (!container) return;
    {posts.image_url ? `<img src="${post.image_url}" alt="Post image" class="post-image" />` : ''}

    if (!posts || posts.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-comments"></i>
                <h3>No posts yet</h3>
                <p>Be the first to start a discussion!</p>
                <button onclick="showPage('create-post')" class="primary-btn">Create Post</button>
            </div>
        `;
        return;
    }

    container.innerHTML = posts.map(post => `
        <article class="post-card" data-post-id="${post.post_id}">
            <div class="post-header">
                <div class="post-author">
                    <div class="author-avatar">${post.first_name ? post.first_name[0].toUpperCase() : 'U'}</div>
                    <div class="author-info">
                        <h4>${post.first_name || 'Unknown'} ${post.last_name || 'User'}</h4>
                        <span class="post-time">${formatDate(post.created_at)}</span>
                    </div>
                </div>
                ${isOwnPost(post.user_id) ? `
                    <div class="post-actions">
                        <button class="action-btn edit-post" onclick="editPost(${post.post_id})">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="action-btn delete-post" onclick="deletePost(${post.post_id})">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                ` : ''}
            </div>
            
            <div class="post-content">
                <h3 class="post-title">${escapeHtml(post.title)}</h3>
                <p class="post-text">${escapeHtml(post.content)}</p>
                ${post.image_url ? `<img src="${post.image_url}" alt="Post image" class="post-image" />` : ''}
            </div>
            
            <div class="post-categories">
                ${post.categories ? post.categories.split(',').map(cat => 
                    `<span class="category-tag">${escapeHtml(cat.trim())}</span>`
                ).join('') : ''}
            </div>
            
            <div class="post-footer">
                <div class="post-stats">
                    <button class="stat-btn like-btn ${post.user_liked ? 'liked' : ''}" 
                            onclick="toggleLike(${post.post_id})">
                        <i class="fas fa-heart"></i>
                        <span>${post.like_count || 0}</span>
                    </button>
                    <button class="stat-btn comment-btn" onclick="showComments(${post.post_id})">
                        <i class="fas fa-comment"></i>
                        <span>${post.comment_count || 0}</span>
                    </button>
                </div>
            </div>
        </article>
    `).join('');
}

// Helper function to check if post belongs to current user
function isOwnPost(postUserId) {
    const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
    return currentUser.id && currentUser.id === postUserId;
}

// Helper function to format dates
function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);
    
    if (diffInSeconds < 60) return 'Just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;
    
    return date.toLocaleDateString();
}

// Helper function to escape HTML
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// NEW FUNCTION: Toggle like on a post
async function toggleLike(postId) {
    if (!isLoggedIn()) {
        alert('Please login to like posts');
        return;
    }

    try {
        const response = await fetch(`/api/posts/${postId}/like`, {
            method: 'POST',
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error('Failed to toggle like');
        }

        const data = await response.json();
        
        // Update the like button and count in the UI
        const likeBtn = document.querySelector(`[data-post-id="${postId}"] .like-btn`);
        if (likeBtn) {
            likeBtn.classList.toggle('liked', data.liked);
            const countSpan = likeBtn.querySelector('span');
            if (countSpan) {
                countSpan.textContent = data.like_count || 0;
            }
        }
        
    } catch (error) {
        console.error('Error toggling like:', error);
        alert('Failed to update like. Please try again.');
    }
}


// Update your DOMContentLoaded event listener
document.addEventListener('DOMContentLoaded', function() {
    showPage('home');
    setupNavigation();
    setupForms();
    updateAuthUI();
    loadCategories(); 
    loadPosts();
    
    
    // Add this to your existing setupForms function
    const createPostForm = document.getElementById('create-post-form');
    if (createPostForm && !createPostForm.dataset.listenerAdded) {
        createPostForm.addEventListener('submit', function(e) {
            e.preventDefault();
            handleCreatePost();
        });
        createPostForm.dataset.listenerAdded = 'true';
    }
});
// Handle logout
function handleLogout() {
    cleanupChat(); // Add this line
    localStorage.removeItem('isAuthenticated');
    localStorage.removeItem('auth_token');
    localStorage.removeUser('user');
    updateAuthUI();
    showPage('home');
}
console.log("After login - isAuthenticated:", localStorage.getItem('isAuthenticated'));
console.log("After login - auth_token:", localStorage.getItem('auth_token'));
console.log("After login - user:", localStorage.getItem('user'));

