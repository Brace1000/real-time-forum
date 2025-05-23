// main.js

document.addEventListener('DOMContentLoaded', function () {
  showPage('home');
  setupNavigation();
  setupForms(); // Call once initially
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
        })
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
            localStorage.setItem('isAuthenticated', 'true');
            if (data.user) {
                localStorage.setItem('user', JSON.stringify(data.user));
            }
            updateAuthUI();
            showPage('home');
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
console.trace(); // This will show where the function was called from
    try {
        const form = document.getElementById('register-form');
        if (!form) {
            console.error('Register form not found!');
            return;
        }

        // This MUST come first - before any usage of formData
        const formData = new FormData(form);

        // Debugging: Log form data
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
    const user = JSON.parse(localStorage.getItem('user') )
    
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
        // Get session cookie
        const cookies = document.cookie;
        const sessionCookie = cookies.split('; ')
            .find(row => row.startsWith('session_id='));
        
        const response = await fetch('/post/create', {
            method: 'POST',
            body: formData,
            credentials: 'include', // This sends cookies with the request
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`, // If using JWT
                'Cookie': sessionCookie // Send session cookie explicitly
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

// Update your DOMContentLoaded event listener
document.addEventListener('DOMContentLoaded', function() {
    showPage('home');
    setupNavigation();
    setupForms();
    updateAuthUI();
    loadCategories(); // Load categories when page loads
    
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
  console.log('User logged out');
  localStorage.removeItem('isAuthenticated');
  updateAuthUI();
  showPage('home');
}