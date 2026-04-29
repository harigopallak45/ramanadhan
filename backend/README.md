# GHL Backend Service Documentation

This document covers the folder structure, API documentation, VentraIP deployment guide, and GoHighLevel integration examples for the Node.js + MySQL backend.

## 📂 Folder Structure

```
backend/
├── config/
│   └── db.js                 # Database configuration and initialization
├── controllers/
│   ├── adminController.js    # Logic for admin routes
│   ├── authController.js     # Logic for authentication (login, signup)
│   ├── ghlController.js      # Logic for GHL webhook processing
│   └── userController.js     # Logic for user profile management
├── middleware/
│   ├── authMiddleware.js     # JWT validation
│   ├── roleMiddleware.js     # Role-based access control
│   └── validateMiddleware.js # Input validation handling
├── models/
│   ├── logModel.js           # Database logging
│   └── userModel.js          # User data access methods
├── routes/
│   ├── adminRoutes.js        # Admin API endpoints
│   ├── authRoutes.js         # Auth API endpoints
│   ├── ghlRoutes.js          # GHL API endpoints
│   └── userRoutes.js         # User API endpoints
├── .env                      # Environment variables (create for production)
├── package.json              # Project dependencies
└── server.js                 # Express application entry point
```

---

## 🛠 API Documentation

### Authentication Endpoints

#### `POST /api/auth/signup`
- **Description:** Register a new user.
- **Body:** `{ "name": "John Doe", "email": "john@example.com", "password": "securepassword", "phone": "123456789", "role": "user" }`
- **Response (201):** `{ "message": "User created successfully", "userId": 1 }`

#### `POST /api/auth/login`
- **Description:** Authenticate user and get JWT.
- **Body:** `{ "email": "john@example.com", "password": "securepassword" }`
- **Response (200):** `{ "message": "Login successful", "token": "eyJhbG...", "user": { "id": 1, "name": "John Doe", "email": "john@example.com", "role": "user" } }`

#### `POST /api/auth/logout`
- **Description:** Logout user (Client handles token deletion).
- **Response (200):** `{ "message": "Logged out successfully" }`

### User Endpoints (Requires `Authorization: Bearer <token>`)

#### `GET /api/user/profile`
- **Description:** Get current logged-in user profile.
- **Response (200):** `{ "id": 1, "name": "John Doe", "email": "john@example.com", "phone": "123456789", "role": "user", "custom_fields": null, "created_at": "..." }`

#### `PUT /api/user/update`
- **Description:** Update current user's profile.
- **Body:** `{ "name": "John Updated", "phone": "987654321", "custom_fields": { "company": "Acme Corp" } }`
- **Response (200):** `{ "message": "Profile updated successfully" }`

### Admin Endpoints (Requires `Authorization: Bearer <token>` and `role: admin`)

#### `GET /api/admin/users`
- **Description:** Get a list of all users.
- **Response (200):** `[ { "id": 1, "name": "John Doe", ... } ]`

#### `DELETE /api/admin/user/:id`
- **Description:** Delete a user by ID.
- **Response (200):** `{ "message": "User deleted successfully" }`

### GoHighLevel Endpoints

#### `POST /api/ghl/webhook`
- **Description:** Receive data from GHL workflow webhooks.
- **Body:** `{ "name": "Jane Doe", "email": "jane@example.com", "phone": "555-5555", "custom_fields": { "lead_source": "Facebook" } }`
- **Response (200/201):** `{ "message": "User updated successfully" }` or `{ "message": "User created successfully", "userId": 2 }`

---

## 🚀 Deployment Guide (VentraIP VPS / cPanel with Node.js)

Assuming you are using a VentraIP VPS with a typical Linux OS (Ubuntu) or cPanel.

### 1. Database Setup
1. Log in to your VentraIP MySQL instance (via command line or phpMyAdmin).
2. Create a new database, e.g., `ghl_backend`.
3. Create a DB user and grant all privileges to `ghl_backend`.
4. Run Prisma database sync using: `npx prisma db push`
   (This will automatically build the `users` and `logs` tables according to `prisma/schema.prisma`)

### 2. Prepare the Code
1. Zip the `backend` folder on your local machine (exclude the `node_modules` folder).
2. Upload the zip file to your server (via SSH/SFTP or cPanel File Manager).
3. Unzip the folder into your desired directory (e.g., `/var/www/ghl_backend` or `/home/user/ghl_backend`).

### 3. Server Configuration
1. SSH into your VPS: `ssh user@your-server-ip`
2. Navigate to the folder: `cd /path/to/ghl_backend`
3. Install dependencies: `npm install --production`
4. Create the production `.env` file: `nano .env`
   ```env
   PORT=5000
   NODE_ENV=production
   DB_HOST=localhost
   DB_USER=your_db_user
   DB_PASSWORD=your_db_password
   DB_NAME=ghl_backend
   JWT_SECRET=generate_a_very_long_random_string_here
   JWT_EXPIRES_IN=7d
   ```

### 4. Process Management with PM2
1. Install PM2 globally if not already installed: `sudo npm install -g pm2`
2. Start the application: `pm2 start server.js --name "ghl-api"`
3. Ensure PM2 starts on server boot:
   `pm2 startup`
   *(Run the command PM2 outputs, then run)*
   `pm2 save`

### 5. Reverse Proxy Setup (Nginx)
To expose the app securely on port 443 (HTTPS) instead of port 5000:
1. Edit your Nginx configuration (e.g., `/etc/nginx/sites-available/api.yourdomain.com`)
2. Add the proxy block:
   ```nginx
   server {
       listen 80;
       server_name api.yourdomain.com;

       location / {
           proxy_pass http://localhost:5000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```
3. Restart Nginx: `sudo systemctl restart nginx`
4. Install SSL using Certbot: `sudo certbot --nginx -d api.yourdomain.com`

---

## 🔗 GoHighLevel Integration Examples

### 1. Webhook Setup in GHL Workflow
When a form is submitted or a tag is added in GHL, you can send the data to the backend.
1. Open a Workflow in GoHighLevel.
2. Add Action: **"Webhook"**.
3. **Method:** `POST`
4. **URL:** `https://api.yourdomain.com/api/ghl/webhook`
5. GHL automatically sends standard contact info in the payload. Your backend will catch the email, name, phone, etc., and create/update the user.

### 2. Login from GHL Page (Custom JS)
If you want users to log in directly from a GoHighLevel funnel/website page, you can add this script to the page tracking code or a custom HTML/JS block:

```javascript
<form id="ghl-login-form">
  <input type="email" id="login-email" placeholder="Email" required />
  <input type="password" id="login-password" placeholder="Password" required />
  <button type="submit">Login</button>
  <div id="login-error" style="color:red; display:none;"></div>
</form>

<script>
document.getElementById('ghl-login-form').addEventListener('submit', async function(e) {
  e.preventDefault();
  
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const errorDiv = document.getElementById('login-error');
  
  try {
    const response = await fetch('https://api.yourdomain.com/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      // Login successful, save token
      localStorage.setItem('auth_token', data.token);
      localStorage.setItem('user_info', JSON.stringify(data.user));
      
      // Redirect to a protected GHL page or show success state
      window.location.href = '/dashboard'; 
    } else {
      // Show error
      errorDiv.innerText = data.error || 'Login failed';
      errorDiv.style.display = 'block';
    }
  } catch (error) {
    errorDiv.innerText = 'Network error. Please try again.';
    errorDiv.style.display = 'block';
  }
});
</script>
```

### 3. Fetching Protected Data in GHL
To fetch user-specific data on a GHL page using the saved JWT:

```javascript
<script>
async function loadUserData() {
  const token = localStorage.getItem('auth_token');
  
  if (!token) {
    window.location.href = '/login'; // Redirect if not logged in
    return;
  }
  
  try {
    const response = await fetch('https://api.yourdomain.com/api/user/profile', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (response.ok) {
      const user = await response.json();
      console.log('User Data:', user);
      // Update UI with user data
      // document.getElementById('welcome-name').innerText = user.name;
    } else {
      // Token expired or invalid
      localStorage.removeItem('auth_token');
      window.location.href = '/login';
    }
  } catch (error) {
    console.error('Failed to fetch user data');
  }
}

// Call on page load
document.addEventListener('DOMContentLoaded', loadUserData);
</script>
```
